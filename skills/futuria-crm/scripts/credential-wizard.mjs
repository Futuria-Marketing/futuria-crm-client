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

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(SCRIPT_PATH);
const UI_DIR = join(SCRIPT_DIR, "credential-wizard");
const SERVICE = "com.futuriamarketing.futuria-crm.pit";
const ACCOUNT = "default";
const MAX_BODY_BYTES = 16 * 1024;
// La sessione resta aperta finché la pagina, in vista, dà segni di vita
// (battito ogni 60 secondi con il cookie di sessione) e si chiude dopo
// 45 minuti senza richieste autenticate. In ogni caso il server non resta in
// ascolto più di 3 ore: il limite assoluto non si rinnova con il battito.
const SESSION_IDLE_MS = 45 * 60 * 1000;
const SESSION_MAX_MS = 3 * 60 * 60 * 1000;
const CLOSE_AFTER_SUCCESS_MS = 3000;
// Tempo massimo che l’avvio staccato attende il configuratore in ascolto.
const DETACH_READY_TIMEOUT_MS = 10_000;
// Le uniche risorse esterne: poster e video della guida, caricati solo quando
// il cliente apre la finestra di aiuto della chiave.
const VIDEO_POSTER_URL = "https://futuriamarketing.com/assets/ai/futuria-crm/creare-token-pit-agents.webp";
const VIDEO_URL = "https://futuriamarketing.com/assets/ai/futuria-crm/creare-token-pit-agents.mp4";
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  `img-src 'self' ${VIDEO_POSTER_URL}`,
  `media-src ${VIDEO_URL}`,
  "style-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

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

export function parseArgs(argv) {
  const result = { preview: false, noOpen: false, detach: false, port: 0, resultFile: "" };
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
    } else if (arg === "--result-file") {
      const path = argv[index + 1];
      if (typeof path !== "string" || !path || path.startsWith("--")) {
        throw new Error("Indica il file in cui scrivere l’esito dell’avvio.");
      }
      result.resultFile = path;
      index += 1;
    } else {
      throw new Error(`Argomento non riconosciuto: ${arg}`);
    }
  }
  if (result.resultFile && !result.detach) {
    throw new Error("--result-file si usa soltanto con --detach.");
  }
  return result;
}

// Argomenti per il processo staccato: senza le opzioni che riguardano solo
// il processo che lo avvia.
function childArguments(argv) {
  const args = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--detach") continue;
    if (argv[index] === "--result-file") {
      index += 1;
      continue;
    }
    args.push(argv[index]);
  }
  return args;
}

// Percorso assoluto dei programmi di sistema di Windows: il processo creato
// via WMI riceve l’ambiente dal registro, con un PATH che può essere diverso.
function windowsSystemProgram(...parts) {
  const root = process.env.SystemRoot || process.env.windir;
  return root ? join(root, "System32", ...parts) : parts[parts.length - 1];
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
    windowsSystemProgram("WindowsPowerShell", "v1.0", "powershell.exe"),
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
    command = windowsSystemProgram("cmd.exe");
    args = ["/c", "start", "", url];
  } else if (runtime === "darwin") {
    command = "open";
    args = [url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  // Se il browser non si apre (programma assente, sandbox) il configuratore
  // resta in ascolto: l’indirizzo è già stato comunicato a chi lo ha avviato.
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Nessun browser: la pagina resta raggiungibile dall’indirizzo stampato.
  }
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
  const maxLifetimeMs = Number.isInteger(options.maxLifetimeMs) && options.maxLifetimeMs > 0
    ? options.maxLifetimeMs
    : SESSION_MAX_MS;
  const sessionId = preview ? "preview" : randomBytes(18).toString("hex");
  const csrfToken = randomBytes(24).toString("hex");
  const cookieToken = randomBytes(24).toString("hex");
  const sessionRoot = `/${sessionId}/`;
  let allowedOrigin = "";
  let cookieName = "futuria_setup";
  let attempts = [];
  let idleTimer;
  let lifetimeTimer;
  let successTimer;
  let closing = false;

  function hasSessionCookie(req) {
    return (req.headers.cookie ?? "").split(/;\s*/).some((item) => safeEqual(item, `${cookieName}=${cookieToken}`));
  }

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

    // Il timer di inattività si rinnova solo con richieste autenticate: la
    // pagina, il battito con il cookie di sessione, il collegamento.
    if (req.method === "GET" && relativePath === "") {
      touch();
      const template = readFileSync(join(UI_DIR, "index.html"), "utf8")
        .replaceAll("__CSRF_TOKEN__", csrfToken)
        .replaceAll("__PREVIEW_MODE__", preview ? "true" : "false");
      send(res, 200, template, "text/html; charset=utf-8", {
        "Content-Security-Policy": CONTENT_SECURITY_POLICY,
        "Set-Cookie": `${cookieName}=${cookieToken}; HttpOnly; SameSite=Strict; Path=${sessionRoot}`,
      });
      return;
    }

    if (req.method === "GET" && relativePath === "status") {
      if (!hasSessionCookie(req)) {
        sendJson(res, 403, { ok: false, message: "Sessione non valida. Riapri il configuratore." });
        return;
      }
      touch();
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
      const cookieOk = hasSessionCookie(req);
      if (!originOk || !csrfOk || !cookieOk || req.headers["content-type"]?.split(";")[0] !== "application/json") {
        sendJson(res, 403, { ok: false, message: "Sessione non valida. Riapri il configuratore." });
        return;
      }
      touch();

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
    clearTimeout(lifetimeTimer);
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
  // I cookie non distinguono le porte: con il nome legato alla porta due
  // configuratori aperti insieme (per esempio due anteprime, che condividono
  // il percorso /preview/) non si sovrascrivono il cookie a vicenda.
  cookieName = `futuria_setup_${address.port}`;
  const url = `${allowedOrigin}${sessionRoot}`;
  touch();
  // Limite assoluto: non si rinnova con il battito né con altre richieste.
  lifetimeTimer = setTimeout(shutdown, maxLifetimeMs);
  lifetimeTimer.unref();

  if (!noOpen) openBrowser(url);
  return { server, url, sessionRoot };
}

// Avvia il configuratore in un processo staccato: su macOS e Linux crea una
// nuova sessione (setsid), quindi sopravvive alla chiusura del gruppo di
// processi dell’agente; su Windows non ha console e non tiene aperte le pipe
// dell’agente. Il padre resta in attesa finché il figlio non è in ascolto
// (messaggio sul canale IPC) e poi esce; se il figlio non parte, lo segnala.
export function startDetached(args, { scriptPath = SCRIPT_PATH, timeoutMs = DETACH_READY_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(process.execPath, [scriptPath, ...args], {
        cwd: homedir(),
        detached: true,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        windowsHide: true,
      });
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      // Un figlio che non risponde non deve restare in ascolto senza che
      // nessuno conosca il suo indirizzo.
      try { child.kill(); } catch { /* già chiuso */ }
      settle(new Error(`il configuratore non è partito entro ${Math.round(timeoutMs / 1000)} secondi.`));
    }, timeoutMs);

    function settle(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Senza disconnect il canale IPC terrebbe vivo questo processo.
      try { if (child.connected) child.disconnect(); } catch { /* canale già chiuso */ }
      child.unref();
      if (error) reject(error);
      else resolve(value);
    }

    child.on("error", (error) => settle(error));
    child.on("exit", (code, signal) => {
      settle(new Error(`il configuratore si è chiuso durante l’avvio (codice ${code ?? signal}).`));
    });
    child.on("message", (message) => {
      if (message?.type === "ready" && typeof message.url === "string") {
        settle(null, { pid: child.pid, url: message.url });
      } else if (message?.type === "error") {
        settle(new Error(String(message.message || "avvio non riuscito.")));
      }
    });
  });
}

// Nel processo staccato: comunica l’esito dell’avvio al processo che lo ha
// creato, poi chiude il canale IPC così non resta nulla in sospeso.
function notifyParent(message) {
  if (typeof process.send !== "function" || !process.connected) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      try { process.disconnect(); } catch { /* canale già chiuso */ }
      resolve();
    };
    try {
      process.send(message, done);
    } catch {
      done();
    }
  });
}

function writeResultFile(path, payload) {
  if (!path) return;
  writeFileSync(path, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const args = parseArgs(rawArgs);

  if (args.detach) {
    let started;
    try {
      started = await startDetached(childArguments(rawArgs));
    } catch (error) {
      writeResultFile(args.resultFile, { ok: false, message: error.message });
      throw error;
    }
    const { pid, url } = started;
    writeResultFile(args.resultFile, { ok: true, pid, url });
    process.stdout.write(args.noOpen
      ? `Configuratore Futuria CRM disponibile su ${url} (processo separato, PID ${pid}).\n`
      : `Configuratore grafico Futuria CRM aperto nel browser (processo separato, PID ${pid}).\n`
        + `Se la pagina non si è aperta, apri questo indirizzo nel browser: ${url}\n`);
    return;
  }

  let url;
  try {
    ({ url } = await startWizard(args));
  } catch (error) {
    await notifyParent({ type: "error", message: error.message });
    throw error;
  }
  await notifyParent({ type: "ready", url });
  process.stdout.write(`Configuratore Futuria CRM disponibile su ${url}\n`);
}

if (process.argv[1] && SCRIPT_PATH === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`Impossibile avviare il configuratore: ${error.message}\n`);
    process.exitCode = 1;
  }
}
