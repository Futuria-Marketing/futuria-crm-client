#!/usr/bin/env node

import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(SCRIPT_PATH);
const UI_DIR = join(SCRIPT_DIR, "credential-wizard");
const SERVICE = "com.futuriamarketing.futuria-crm.pit";
const ACCOUNT = "default";
const MAX_BODY_BYTES = 16 * 1024;
// La sessione resta aperta finché la pagina dà segni di vita (battito ogni
// 60 secondi) e si chiude dopo 45 minuti senza richieste valide.
const SESSION_IDLE_MS = 45 * 60 * 1000;
const CLOSE_AFTER_SUCCESS_MS = 3000;
const MEDIA_ORIGIN = "https://futuriamarketing.com";

const STATIC_FILES = new Map([
  ["app.js", "application/javascript; charset=utf-8"],
  ["styles.css", "text/css; charset=utf-8"],
  ["assets/futuria-crm-logo.png", "image/png"],
  ["assets/step-1-private-integrations.png", "image/png"],
  ["assets/step-2-integration-details.png", "image/png"],
  ["assets/step-3-paste-here.png", "image/png"],
]);

export function parseLocationInput(value) {
  const input = String(value ?? "").trim();
  if (/^[A-Za-z0-9_-]{6,128}$/.test(input)) {
    return input;
  }

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("Incolla il link completo del tuo account Futuria CRM.");
  }

  if (parsed.protocol !== "https:" || parsed.hostname !== "app.futuriamarketing.com") {
    throw new Error("Il link deve appartenere a Futuria CRM.");
  }

  const match = parsed.pathname.match(/\/(?:v2\/)?location\/([A-Za-z0-9_-]{6,128})(?:\/|$)/);
  if (!match) {
    throw new Error("Non trovo l’account nel link. Apri il tuo account e copia di nuovo l’indirizzo.");
  }
  return match[1];
}

export function isValidPrivateKey(value) {
  return /^pit-[A-Za-z0-9._-]{6,2048}$/.test(String(value ?? ""));
}

export function accountNameFromPayload(payload) {
  const candidates = [
    payload?.location?.name,
    payload?.name,
    payload?.location?.companyName,
    payload?.company?.name,
  ];
  const found = candidates.find((value) => typeof value === "string" && value.trim());
  return found ? found.trim().slice(0, 160) : "Account Futuria CRM";
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseArgs(argv) {
  const result = { preview: false, noOpen: false, detach: false, port: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--preview") result.preview = true;
    else if (arg === "--no-open") result.noOpen = true;
    else if (arg === "--detach") result.detach = true;
    else if (arg === "--port") {
      const port = Number.parseInt(argv[index + 1], 10);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error("Porta non valida.");
      }
      result.port = port;
      index += 1;
    } else {
      throw new Error(`Argomento non riconosciuto: ${arg}`);
    }
  }
  return result;
}

export function windowsPowerShellEnvironment(source = process.env) {
  const environment = { ...source };
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase() === "psmodulepath") delete environment[key];
  }
  return environment;
}

export function runChild(command, args, input = "", options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      windowsHide: true,
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 4096) stderr += chunk.toString("utf8");
    });
    // Se il processo esce prima di leggere l’input la pipe si rompe (EPIPE):
    // senza questo gestore l’errore farebbe cadere l’intero configuratore.
    // L’esito resta deciso dal codice di uscita in "close".
    child.stdin.on("error", () => {});
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Il salvataggio protetto non è riuscito (codice ${code}).`));
    });
    child.stdin.end(input, "utf8");
  });
}

async function storeWindowsCredential(location, privateKey) {
  const setupScript = join(SCRIPT_DIR, "setup-credentials.ps1");
  await runChild(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", setupScript, "-FromStdin"],
    `${location}\n${privateKey}\n`,
    { env: windowsPowerShellEnvironment() },
  );
}

async function storeMacCredential(location, privateKey) {
  const configDir = join(homedir(), "Library", "Application Support", "Futuria CRM");
  const configPath = join(configDir, "config.json");
  const tempPath = join(configDir, `.config-${randomBytes(8).toString("hex")}.tmp`);

  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  chmodSync(configDir, 0o700);
  writeFileSync(
    tempPath,
    `${JSON.stringify({
      location,
      storage: "macos-keychain",
      updated_at: new Date().toISOString(),
    }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );

  try {
    // `security -i` riceve il comando dalla pipe: la chiave non compare negli
    // argomenti di processo, nella cronologia della shell o nei log del wizard.
    await runChild(
      "/usr/bin/security",
      ["-i"],
      `add-generic-password -U -a ${ACCOUNT} -s ${SERVICE} -w ${privateKey}\n`,
    );
    renameSync(tempPath, configPath);
    chmodSync(configPath, 0o600);
  } catch (error) {
    try { unlinkSync(tempPath); } catch { /* already absent */ }
    throw error;
  }
}

export async function storeCredential(location, privateKey, runtime = platform()) {
  if (runtime === "win32") return storeWindowsCredential(location, privateKey);
  if (runtime === "darwin") return storeMacCredential(location, privateKey);
  throw new Error("Il configuratore grafico è disponibile su Windows e macOS.");
}

export function verifyConnection(location, privateKey, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const request = httpsRequest({
      hostname: "services.leadconnectorhq.com",
      port: 443,
      path: `/locations/${encodeURIComponent(location)}`,
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${privateKey}`,
        Version: "2021-07-28",
      },
      timeout: timeoutMs,
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size <= 256 * 1024) chunks.push(chunk);
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error("Futuria CRM non ha accettato il collegamento.");
          error.statusCode = response.statusCode;
          reject(error);
          return;
        }
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          resolve({ accountName: accountNameFromPayload(payload) });
        } catch {
          reject(new Error("La risposta di Futuria CRM non è valida."));
        }
      });
    });

    request.on("timeout", () => request.destroy(new Error("Verifica scaduta.")));
    request.on("error", reject);
    request.end();
  });
}

function openBrowser(url) {
  const runtime = platform();
  let command;
  let args;
  if (runtime === "win32") {
    command = "cmd.exe";
    args = ["/c", "start", "", url];
  } else if (runtime === "darwin") {
    command = "open";
    args = [url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

function send(res, status, body, contentType, extraHeaders = {}) {
  res.writeHead(status, {
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": contentType,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    ...extraHeaders,
  });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Richiesta troppo grande."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Richiesta non valida."));
      }
    });
    req.on("error", reject);
  });
}

function friendlyConnectionError(error) {
  if (error?.statusCode === 401) {
    return "La chiave privata non è valida o non è più attiva. Creane una nuova e riprova.";
  }
  if (error?.statusCode === 403) {
    return "La chiave non ha il permesso di leggere i dati dell’account. Abilita l’ambito Account/Locations in lettura e riprova.";
  }
  if (error?.statusCode === 404) {
    return "L’account indicato non corrisponde alla chiave. Controlla il link e riprova.";
  }
  return "Non riesco a verificare il collegamento. Controlla la connessione e riprova tra poco.";
}

export async function startWizard(options = {}) {
  const preview = Boolean(options.preview);
  const noOpen = Boolean(options.noOpen);
  const requestedPort = Number.isInteger(options.port) ? options.port : 0;
  // Tempi regolabili soltanto dai test: la riga di comando non li espone.
  const idleTimeoutMs = Number.isInteger(options.idleTimeoutMs) && options.idleTimeoutMs > 0
    ? options.idleTimeoutMs
    : SESSION_IDLE_MS;
  const closeAfterSuccessMs = Number.isInteger(options.closeAfterSuccessMs) && options.closeAfterSuccessMs >= 0
    ? options.closeAfterSuccessMs
    : CLOSE_AFTER_SUCCESS_MS;
  const sessionId = preview ? "preview" : randomBytes(18).toString("hex");
  const csrfToken = randomBytes(24).toString("hex");
  const cookieToken = randomBytes(24).toString("hex");
  const sessionRoot = `/${sessionId}/`;
  let allowedOrigin = "";
  let attempts = [];
  let idleTimer;
  let successTimer;
  let closing = false;

  async function handleRequest(req, res) {
    const expectedHost = allowedOrigin.replace("http://", "");
    if (req.headers.host !== expectedHost) {
      sendJson(res, 400, { ok: false, message: "Richiesta locale non valida." });
      return;
    }

    const requestUrl = new URL(req.url, allowedOrigin);
    if (!requestUrl.pathname.startsWith(sessionRoot)) {
      sendJson(res, 404, { ok: false, message: "Sessione non trovata." });
      return;
    }
    const relativePath = requestUrl.pathname.slice(sessionRoot.length);
    touch();

    if (req.method === "GET" && relativePath === "") {
      const template = readFileSync(join(UI_DIR, "index.html"), "utf8")
        .replaceAll("__CSRF_TOKEN__", csrfToken)
        .replaceAll("__PREVIEW_MODE__", preview ? "true" : "false");
      send(res, 200, template, "text/html; charset=utf-8", {
        "Content-Security-Policy": `default-src 'none'; img-src 'self' ${MEDIA_ORIGIN}; media-src ${MEDIA_ORIGIN}; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'`,
        "Set-Cookie": `futuria_setup=${cookieToken}; HttpOnly; SameSite=Strict; Path=${sessionRoot}`,
      });
      return;
    }

    if (req.method === "GET" && relativePath === "status") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && STATIC_FILES.has(relativePath)) {
      const filePath = join(UI_DIR, ...relativePath.split("/"));
      send(res, 200, readFileSync(filePath), STATIC_FILES.get(relativePath));
      return;
    }

    if (req.method === "POST" && relativePath === "connect") {
      const now = Date.now();
      attempts = attempts.filter((timestamp) => now - timestamp < 60_000);
      if (attempts.length >= 5) {
        sendJson(res, 429, { ok: false, message: "Troppi tentativi ravvicinati. Attendi un minuto e riprova." });
        return;
      }
      attempts.push(now);

      const originOk = req.headers.origin === allowedOrigin;
      const csrfOk = safeEqual(req.headers["x-futuria-csrf"] ?? "", csrfToken);
      const cookieOk = (req.headers.cookie ?? "").split(/;\s*/).some((item) => safeEqual(item, `futuria_setup=${cookieToken}`));
      if (!originOk || !csrfOk || !cookieOk || req.headers["content-type"]?.split(";")[0] !== "application/json") {
        sendJson(res, 403, { ok: false, message: "Sessione non valida. Riapri il configuratore." });
        return;
      }

      let privateKey = "";
      let payload;
      try {
        payload = await readJsonBody(req);
        const location = parseLocationInput(payload.accountLink);
        privateKey = String(payload.privateKey ?? "").trim();
        payload.privateKey = "";
        if (!isValidPrivateKey(privateKey)) {
          sendJson(res, 400, { ok: false, message: "La chiave privata non ha il formato atteso. Copiala di nuovo per intero." });
          return;
        }

        let verification;
        if (preview) {
          verification = { accountName: "Esempio Azienda" };
        } else {
          try {
            verification = await verifyConnection(location, privateKey);
          } catch (error) {
            sendJson(res, 422, { ok: false, message: friendlyConnectionError(error) });
            return;
          }
          await storeCredential(location, privateKey);
        }

        sendJson(res, 200, {
          ok: true,
          accountName: verification.accountName,
          preview,
        });
        // Collegamento riuscito: la pagina ha già l’esito, il server si chiude.
        if (!successTimer) {
          successTimer = setTimeout(shutdown, closeAfterSuccessMs);
          successTimer.unref();
        }
      } catch (error) {
        sendJson(res, 400, { ok: false, message: error?.message || "Configurazione non riuscita." });
      } finally {
        privateKey = "";
        if (payload && typeof payload === "object") payload.privateKey = "";
      }
      return;
    }

    sendJson(res, 404, { ok: false, message: "Risorsa non trovata." });
  }

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res);
    } catch {
      // Nessun dettaglio tecnico verso la pagina: potrebbe contenere dati locali.
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, message: "Errore interno del configuratore. Riprova." });
      } else {
        res.destroy();
      }
    }
  });

  server.on("clientError", (error, socket) => {
    if (error?.code === "ECONNRESET" || !socket.writable) {
      socket.destroy();
      return;
    }
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  function shutdown() {
    if (closing) return;
    closing = true;
    clearTimeout(idleTimer);
    clearTimeout(successTimer);
    server.close();
    server.closeIdleConnections?.();
  }

  function touch() {
    if (closing) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(shutdown, idleTimeoutMs);
    idleTimer.unref();
  }

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, "127.0.0.1", resolve);
  });

  const address = server.address();
  allowedOrigin = `http://127.0.0.1:${address.port}`;
  const url = `${allowedOrigin}${sessionRoot}`;
  touch();

  if (!noOpen) openBrowser(url);
  return { server, url, sessionRoot };
}

// Avvia il configuratore in un processo staccato: su macOS e Linux crea una
// nuova sessione (setsid), quindi sopravvive alla chiusura del gruppo di
// processi dell’agente; su Windows non ha console e non tiene aperte le pipe
// dell’agente. Il padre attende solo l’avvio del figlio ed esce subito.
export async function startDetached(args, scriptPath = SCRIPT_PATH) {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd: homedir(),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  await once(child, "spawn");
  child.unref();
  return child.pid;
}

if (process.argv[1] && SCRIPT_PATH === process.argv[1]) {
  try {
    const rawArgs = process.argv.slice(2);
    const args = parseArgs(rawArgs);
    if (args.detach) {
      const pid = await startDetached(rawArgs.filter((arg) => arg !== "--detach"));
      process.stdout.write(`Configuratore Futuria CRM avviato in un processo separato (PID ${pid}).\n`);
    } else {
      const { url } = await startWizard(args);
      process.stdout.write(`Configuratore Futuria CRM disponibile su ${url}\n`);
    }
  } catch (error) {
    process.stderr.write(`Impossibile avviare il configuratore: ${error.message}\n`);
    process.exitCode = 1;
  }
}
