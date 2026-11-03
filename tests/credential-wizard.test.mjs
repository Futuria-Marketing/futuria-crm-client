import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { connect as netConnect, createServer as createNetServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

import {
  accountNameFromPayload,
  isValidPrivateKey,
  parseLocationInput,
  runChild,
  startWizard,
  windowsPowerShellEnvironment,
} from "../skills/futuria-crm/scripts/credential-wizard.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const WIZARD_SCRIPT = join(TEST_DIR, "..", "skills", "futuria-crm", "scripts", "credential-wizard.mjs");
const APP_SCRIPT = join(TEST_DIR, "..", "skills", "futuria-crm", "scripts", "credential-wizard", "app.js");
const PREVIEW_KEY = "pit-preview-key-1234567890";

async function openSession(url) {
  const response = await fetch(url);
  const cookie = response.headers.get("set-cookie");
  const html = await response.text();
  const csrf = html.match(/<meta name="csrf-token" content="([a-f0-9]+)">/)?.[1];
  return { response, cookie, html, csrf };
}

function previewConnect(url, cookie, csrf) {
  return fetch(new URL("connect", url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie.split(";", 1)[0],
      Origin: new URL(url).origin,
      "X-Futuria-CSRF": csrf,
    },
    body: JSON.stringify({ accountLink: "demoAccount1234567890", privateKey: PREVIEW_KEY }),
  });
}

function rawRequest(port, payload) {
  return new Promise((resolve, reject) => {
    const socket = netConnect(port, "127.0.0.1");
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { data += chunk; });
    socket.on("end", () => resolve(data));
    socket.on("close", () => resolve(data));
    socket.on("error", reject);
    socket.write(payload);
    setTimeout(() => socket.end(), 1000).unref();
  });
}

function getWithHost(url, host) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      headers: { Host: host },
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
    request.end();
  });
}

async function freePort() {
  const probe = createNetServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitFor(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(100);
  }
  return false;
}

async function statusOk(url) {
  try {
    const response = await fetch(new URL("status", url), { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

test("estrae l’ID da un link Futuria CRM o da un ID diretto", () => {
  assert.equal(parseLocationInput("demoAccount1234567890"), "demoAccount1234567890");
  assert.equal(
    parseLocationInput("https://app.futuriamarketing.com/v2/location/demoAccount1234567890/dashboard"),
    "demoAccount1234567890",
  );
  assert.equal(
    parseLocationInput("https://app.futuriamarketing.com/location/demoAccount1234567890/settings"),
    "demoAccount1234567890",
  );
});

test("rifiuta host e percorsi non consentiti", () => {
  assert.throws(() => parseLocationInput("https://example.com/v2/location/demoAccount1234567890"));
  assert.throws(() => parseLocationInput("https://app.futuriamarketing.com/settings"));
  assert.throws(() => parseLocationInput("non è un link"));
});

test("valida il formato della chiave privata senza restituirla", () => {
  assert.equal(isValidPrivateKey("pit-preview-key-1234567890"), true);
  assert.equal(isValidPrivateKey("token-preview-key-1234567890"), false);
  assert.equal(isValidPrivateKey("pit-short"), false);
  assert.equal(isValidPrivateKey("pit-invalid value"), false);
});

test("ricava un nome account sicuro dalle forme API note", () => {
  assert.equal(accountNameFromPayload({ location: { name: "Azienda Demo" } }), "Azienda Demo");
  assert.equal(accountNameFromPayload({ company: { name: "Futuria Demo" } }), "Futuria Demo");
  assert.equal(accountNameFromPayload({}), "Account Futuria CRM");
});

test("il server locale usa sessione, cookie e CSRF e completa solo la preview", async (t) => {
  const { server, url } = await startWizard({ preview: true, noOpen: true, port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const pageResponse = await fetch(url);
  assert.equal(pageResponse.status, 200);
  const csp = pageResponse.headers.get("content-security-policy");
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /img-src 'self' https:\/\/futuriamarketing\.com;/);
  assert.match(csp, /media-src https:\/\/futuriamarketing\.com;/);
  assert.match(csp, /connect-src 'self';/);
  assert.match(csp, /script-src 'self';/);
  assert.match(pageResponse.headers.get("cache-control"), /no-store/);
  const cookie = pageResponse.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const html = await pageResponse.text();
  assert.match(html, /seleziona <strong>tutti gli ambiti disponibili<\/strong>/);
  assert.match(html, /Gli ambiti lasciati disattivati limiteranno le azioni/);
  const csrf = html.match(/<meta name="csrf-token" content="([a-f0-9]+)">/)?.[1];
  assert.ok(csrf);

  const connectUrl = new URL("connect", url);
  const rejected = await fetch(connectUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie.split(";", 1)[0],
      Origin: "https://example.com",
      "X-Futuria-CSRF": csrf,
    },
    body: JSON.stringify({
      accountLink: "demoAccount1234567890",
      privateKey: "pit-preview-key-1234567890",
    }),
  });
  assert.equal(rejected.status, 403);

  const accepted = await fetch(connectUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie.split(";", 1)[0],
      Origin: new URL(url).origin,
      "X-Futuria-CSRF": csrf,
    },
    body: JSON.stringify({
      accountLink: "https://app.futuriamarketing.com/v2/location/demoAccount1234567890/dashboard",
      privateKey: "pit-preview-key-1234567890",
    }),
  });
  assert.equal(accepted.status, 200);
  const result = await accepted.json();
  assert.deepEqual(result, { ok: true, accountName: "Esempio Azienda", preview: true });
  assert.equal(JSON.stringify(result).includes("pit-preview"), false);
});

test("la pagina mostra il video della guida prima dei passaggi e l’avviso di chiusura", async (t) => {
  const { server, url } = await startWizard({ preview: true, noOpen: true, port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { html } = await openSession(url);
  assert.match(html, /<video[^>]*\scontrols[\s>]/);
  assert.match(html, /<video[^>]*\spreload="none"/);
  assert.match(html, /<video[^>]*\splaysinline[\s>]/);
  assert.match(html, /poster="https:\/\/futuriamarketing\.com\/assets\/ai\/futuria-crm\/creare-token-pit-agents\.webp"/);
  assert.match(html, /<source src="https:\/\/futuriamarketing\.com\/assets\/ai\/futuria-crm\/creare-token-pit-agents\.mp4" type="video\/mp4">/);
  assert.ok(html.indexOf("<video") < html.indexOf('id="guide-accordion"'), "il video precede la guida a fisarmonica");
  assert.match(html, /href="https:\/\/futuriamarketing\.com\/supporto\/come-creare-token-pit-futuria-crm\/"[^>]*>Il video non parte\?/);
  assert.match(html, /href="https:\/\/futuriamarketing\.com\/supporto\/come-creare-token-pit-futuria-crm\/"[^>]*>Serve aiuto\?<\/a>/);
  assert.match(html, /Il configuratore si è chiuso\. La chiave non è stata salvata\. Chiedi all’agente di riaprirlo e incolla di nuovo la chiave\./);

  const app = readFileSync(APP_SCRIPT, "utf8");
  assert.match(app, /fetch\("status"/);
  assert.match(app, /HEARTBEAT_MS = 60 \* 1000/);
});

test("status risponde solo con host e sessione validi", async (t) => {
  const { server, url } = await startWizard({ preview: true, noOpen: true, port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(new URL("status", url));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.deepEqual(await response.json(), { ok: true });

  const origin = new URL(url).origin;
  assert.equal((await fetch(`${origin}/altra-sessione/status`)).status, 404);
  assert.equal(await getWithHost(new URL("status", url).href, `localhost:${new URL(url).port}`), 400);
});

test("la sessione si chiude dopo l’inattività e ogni richiesta valida la rinnova", async (t) => {
  const { server, url } = await startWizard({ preview: true, noOpen: true, port: 0, idleTimeoutMs: 1000 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const closed = once(server, "close");

  await sleep(400);
  assert.equal(await statusOk(url), true);
  await sleep(700);
  // Senza il rinnovo la sessione sarebbe scaduta a 1000 ms.
  assert.equal(server.listening, true);

  const outcome = await Promise.race([closed.then(() => "closed"), sleep(5000).then(() => "timeout")]);
  assert.equal(outcome, "closed");
  assert.equal(await statusOk(url), false);
});

test("dopo un collegamento riuscito il server si chiude da solo", async (t) => {
  const { server, url } = await startWizard({ preview: true, noOpen: true, port: 0, closeAfterSuccessMs: 50 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const closed = once(server, "close");

  const { cookie, csrf } = await openSession(url);
  const accepted = await previewConnect(url, cookie, csrf);
  assert.equal(accepted.status, 200);
  await accepted.json();

  const outcome = await Promise.race([closed.then(() => "closed"), sleep(5000).then(() => "timeout")]);
  assert.equal(outcome, "closed");
});

test("errori interni e richieste malformate non fanno cadere il server", async (t) => {
  const { server, url } = await startWizard({ preview: true, noOpen: true, port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = new URL(url);

  // Porta fuori intervallo: il parser HTTP accetta la riga, new URL() no.
  const internal = await rawRequest(port, `GET http://127.0.0.1:99999/ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
  assert.match(internal, /^HTTP\/1\.1 500/);
  assert.match(internal, /"message":"Errore interno del configuratore\. Riprova\."/);

  const malformed = await rawRequest(port, "QUESTA NON È UNA RICHIESTA HTTP\r\n\r\n");
  assert.match(malformed, /^HTTP\/1\.1 400/);

  assert.equal(await statusOk(url), true);
});

test("runChild non cade se il processo chiude l’input in anticipo", async () => {
  await assert.rejects(
    runChild(process.execPath, ["-e", "process.exit(3)"], "x".repeat(8 * 1024 * 1024)),
    /Il salvataggio protetto non è riuscito \(codice 3\)\./,
  );
});

test("--detach avvia un processo separato e il padre esce subito", async (t) => {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/preview/`;
  const launch = spawnSync(
    process.execPath,
    [WIZARD_SCRIPT, "--detach", "--preview", "--no-open", "--port", String(port)],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(launch.error, undefined, "il padre non deve restare in attesa del figlio");
  assert.equal(launch.status, 0, launch.stderr);
  const pid = Number(launch.stdout.match(/PID (\d+)/)?.[1]);
  assert.ok(pid > 0, launch.stdout);
  t.after(() => {
    try { process.kill(pid); } catch { /* già chiuso */ }
  });

  assert.equal(await waitFor(() => statusOk(url), 10000), true, "il configuratore staccato risponde");

  const { cookie, csrf } = await openSession(url);
  const accepted = await previewConnect(url, cookie, csrf);
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).ok, true);

  assert.equal(await waitFor(async () => !(await statusOk(url)), 15000), true, "il configuratore si chiude dopo il collegamento");
});

test("macOS accetta il salvataggio Keychain dalla pipe senza segreti negli argomenti", {
  skip: process.platform !== "darwin",
}, () => {
  const directory = mkdtempSync(join(tmpdir(), "futuria-keychain-test-"));
  const keychain = join(directory, "test.keychain-db");
  const password = "temporary-keychain-password";
  const service = "com.futuriamarketing.futuria-crm.test";
  const privateKey = "pit-preview-keychain-1234567890";

  try {
    assert.equal(spawnSync("/usr/bin/security", ["create-keychain", "-p", password, keychain]).status, 0);
    assert.equal(spawnSync("/usr/bin/security", ["unlock-keychain", "-p", password, keychain]).status, 0);

    const store = spawnSync("/usr/bin/security", ["-i"], {
      input: `add-generic-password -a default -s ${service} -w ${privateKey} ${keychain}\n`,
      encoding: "utf8",
    });
    assert.equal(store.status, 0, store.stderr);

    const read = spawnSync(
      "/usr/bin/security",
      ["find-generic-password", "-a", "default", "-s", service, "-w", keychain],
      { encoding: "utf8" },
    );
    assert.equal(read.status, 0, read.stderr);
    assert.equal(read.stdout.trim(), privateKey);
  } finally {
    spawnSync("/usr/bin/security", ["delete-keychain", keychain]);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Windows salva dalla pipe con DPAPI senza esporre la chiave", {
  skip: process.platform !== "win32",
}, () => {
  const directory = mkdtempSync(join(tmpdir(), "futuria-dpapi-test-"));
  const setupScript = join(
    process.cwd(),
    "skills",
    "futuria-crm",
    "scripts",
    "setup-credentials.ps1",
  );
  const environment = windowsPowerShellEnvironment({
    ...process.env,
    APPDATA: directory,
    PSModulePath: "C:\\Program Files\\PowerShell\\Modules",
  });
  assert.equal(
    Object.keys(environment).some((key) => key.toLowerCase() === "psmodulepath"),
    false,
  );

  try {
    const store = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", setupScript, "-FromStdin"],
      {
        input: "demoAccount1234567890\npit-preview-dpapi-1234567890\n",
        encoding: "utf8",
        env: environment,
      },
    );
    assert.equal(store.status, 0, store.stderr);
    assert.equal(store.stdout.includes("pit-preview"), false);

    const status = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", setupScript, "-Status"],
      { encoding: "utf8", env: environment },
    );
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /Chiave privata protetta: presente/);
    assert.equal(status.stdout.includes("pit-preview"), false);

    const credentialPath = join(directory, "Futuria CRM", "credential.xml");
    const readEnvironment = { ...environment, FUTURIA_TEST_CREDENTIAL_PATH: credentialPath };
    const read = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$c=Import-Clixml -LiteralPath $env:FUTURIA_TEST_CREDENTIAL_PATH; [Console]::Out.Write($c.GetNetworkCredential().Password)",
      ],
      { encoding: "utf8", env: readEnvironment },
    );
    assert.equal(read.status, 0, read.stderr);
    assert.equal(read.stdout, "pit-preview-dpapi-1234567890");

    const config = JSON.parse(readFileSync(join(directory, "Futuria CRM", "config.json"), "utf8"));
    assert.equal(config.location, "demoAccount1234567890");
    assert.equal(config.storage, "windows-dpapi");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
