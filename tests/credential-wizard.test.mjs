import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
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
  parseArgs,
  parseLocationInput,
  runChild,
  startWizard,
  windowsPowerShellEnvironment,
} from "../skills/futuria-crm/scripts/credential-wizard.mjs";
import { APP_STORE_TEXT } from "./fixtures/state-config-cases.mjs";
import {
  assertPowerShellChildIsolated,
  createIsolatedState,
  POWERSHELL,
  SCRIPTS_DIR,
  snapshot,
} from "./helpers/isolated-state.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const WIZARD_SCRIPT = join(SCRIPTS_DIR, "credential-wizard.mjs");
const LAUNCHER_PS1 = join(SCRIPTS_DIR, "launch-credential-setup.ps1");
const APP_SCRIPT = join(SCRIPTS_DIR, "credential-wizard", "app.js");
const STYLES = join(SCRIPTS_DIR, "credential-wizard", "styles.css");
const PREVIEW_KEY = "pit-preview-key-1234567890";
const VIDEO_URL = "https://futuriamarketing.com/assets/ai/futuria-crm/creare-token-pit-agents.mp4";
const POSTER_URL = "https://futuriamarketing.com/assets/ai/futuria-crm/creare-token-pit-agents.webp";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

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

// Battito come quello della pagina: con il cookie di sessione.
async function statusOk(url, cookie) {
  try {
    const response = await fetch(new URL("status", url), {
      headers: cookie ? { Cookie: cookie.split(";", 1)[0] } : {},
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function pageOk(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// PID dei configuratori in esecuzione su Windows (node.exe con
// credential-wizard.mjs nella riga di comando).
function windowsWizardProcessIds() {
  const list = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*credential-wizard.mjs*' } | ForEach-Object { $_.ProcessId }",
    ],
    { encoding: "utf8", timeout: 30000 },
  );
  assert.equal(list.status, 0, list.stderr);
  return new Set(list.stdout.split(/\s+/).filter(Boolean).map(Number));
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
  // Solo i due file della guida video, non l’intero dominio.
  assert.match(csp, new RegExp(`img-src 'self' ${escapeRegExp(POSTER_URL)};`));
  assert.match(csp, new RegExp(`media-src ${escapeRegExp(VIDEO_URL)};`));
  assert.doesNotMatch(csp, /https:\/\/futuriamarketing\.com[;\s]/);
  assert.match(csp, /connect-src 'self';/);
  assert.match(csp, /script-src 'self';/);
  // Nessun invio nativo del modulo: senza app.js la chiave non finisce
  // nell’indirizzo né nella cronologia.
  assert.match(csp, /form-action 'none';/);
  assert.doesNotMatch(csp, /form-action 'self'/);
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

test("la pagina è solo il modulo, con un pulsante di aiuto accanto a ogni campo", async (t) => {
  const { server, url } = await startWizard({ preview: true, noOpen: true, port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { html } = await openSession(url);

  // La colonna della guida non c’è più.
  assert.doesNotMatch(html, /guide-panel|guide-accordion|<details/);
  assert.match(html, /<form id="credential-form" method="post" novalidate>/);

  // Sotto l’introduzione la pagina dice quale agente deve averla aperta.
  assert.match(html, /<p class="form-intro">[\s\S]*?<\/p>\s*<p class="runtime-note" id="runtime-note">L’agente che ha aperto questa pagina deve essere Claude Code o l’app ChatGPT per computer in modalità Work \(Codex\), non claude\.ai o chatgpt\.com\.<\/p>/);

  // Il campo della chiave è un campo password: nascosto in ogni browser e
  // non letto ad alta voce dai lettori di schermo. Nessun mascheramento CSS.
  const keyField = html.match(/<input\s+id="private-key"[^>]*>/)?.[0];
  assert.ok(keyField, "campo della chiave presente");
  assert.match(keyField, /type="password"/);
  assert.match(keyField, /autocomplete="new-password"/);
  assert.match(keyField, /autocapitalize="none"/);
  assert.match(keyField, /spellcheck="false"/);
  assert.doesNotMatch(keyField, /masked-input|type="text"/);
  assert.equal((html.match(/type="password"/g) ?? []).length, 1);
  // Senza attributo name un eventuale invio nativo non porta i valori.
  const accountField = html.match(/<input\s+id="account-link"[^>]*>/)?.[0];
  assert.ok(accountField, "campo del link presente");
  assert.doesNotMatch(accountField, /\sname=/);
  assert.doesNotMatch(keyField, /\sname=/);

  // I due pulsanti di aiuto stanno accanto all’etichetta del rispettivo campo.
  assert.match(html, /<label for="account-link">Link dell’account<\/label>\s*<button class="help-button" id="link-help-button" type="button" aria-haspopup="dialog" aria-controls="link-guide">/);
  assert.match(html, /<label for="private-key">Chiave privata di collegamento<\/label>\s*<button class="help-button" id="key-help-button" type="button" aria-haspopup="dialog" aria-controls="key-guide">/);
  assert.match(html, /<span>Dove trovo il link\?<\/span>/);
  assert.match(html, /<span>Scopri dove trovare questa chiave<\/span>/);
  assert.match(html, /<svg class="help-icon"[^>]*aria-hidden="true"/);

  // Le due finestre di guida sono <dialog> nativi con titolo e chiusura.
  assert.match(html, /<dialog class="guide-dialog" id="link-guide" aria-labelledby="link-guide-title"/);
  assert.match(html, /<dialog class="guide-dialog" id="key-guide" aria-labelledby="key-guide-title"/);
  assert.equal((html.match(/<dialog /g) ?? []).length, 2);
  assert.equal((html.match(/data-close-dialog aria-label="Chiudi la guida"/g) ?? []).length, 2);

  // Guida del link: passi brevi con l’esempio dell’indirizzo.
  const linkGuide = html.slice(html.indexOf('id="link-guide"'), html.indexOf('id="key-guide"'));
  assert.match(linkGuide, /Apri Futuria CRM/);
  assert.match(linkGuide, /Entra nel tuo account/);
  assert.match(linkGuide, /barra del browser/);
  assert.match(linkGuide, /https:\/\/app\.futuriamarketing\.com\/v2\/location\/\.\.\./);

  // Guida della chiave: spazio per il video in alto, poi i tre passi con le
  // immagini locali, il pulsante per aprire il CRM e la guida online.
  const keyGuide = html.slice(html.indexOf('id="key-guide"'));
  assert.match(keyGuide, /id="key-video-slot"/);
  assert.ok(keyGuide.indexOf('id="key-video-slot"') < keyGuide.indexOf("step-1-private-integrations.png"), "il video precede i passi");
  for (const image of ["step-1-private-integrations.png", "step-2-integration-details.png", "step-3-paste-here.png"]) {
    assert.match(keyGuide, new RegExp(`<img src="assets/${escapeRegExp(image)}"`));
  }
  assert.match(keyGuide, /seleziona <strong>tutti gli ambiti disponibili<\/strong>/);
  assert.match(keyGuide, /<a class="secondary-action" href="https:\/\/app\.futuriamarketing\.com\/"[^>]*>Apri Futuria CRM<\/a>/);
  assert.match(keyGuide, /href="https:\/\/futuriamarketing\.com\/supporto\/come-creare-token-pit-futuria-crm\/"[^>]*>Apri la guida online<\/a>/);
  assert.doesNotMatch(html, /campo protetto a destra/);

  // Nessuna risorsa esterna nel markup iniziale: il video nasce solo
  // all’apertura della finestra della chiave.
  assert.doesNotMatch(html, /<video/);
  assert.doesNotMatch(html, /creare-token-pit-agents/);
  assert.doesNotMatch(html, /\s(?:src|poster|srcset)="https?:/);

  assert.match(html, /href="https:\/\/futuriamarketing\.com\/supporto\/come-creare-token-pit-futuria-crm\/"[^>]*>Serve aiuto\?<\/a>/);
  assert.match(html, /Il configuratore si è chiuso: da questa pagina non è stata salvata nessuna chiave\./);
  assert.doesNotMatch(html, /La chiave non è stata salvata\./);

  const styles = readFileSync(STYLES, "utf8");
  assert.doesNotMatch(styles, /\.guide-panel|\.accordion|\.video-guide/);
  assert.match(styles, /\.guide-dialog::backdrop/);
  assert.match(styles, /\.dialog-body \{[^}]*overflow-y: auto/);
  // Nessun mascheramento CSS: lo fa il campo password.
  assert.doesNotMatch(styles, /-webkit-text-security|\.masked-input/);
  // Focus da tastiera ben visibile su pulsanti di aiuto e chiusura.
  const focusRule = styles.match(/\.help-button:focus-visible,[\s\S]*?\{([^}]*)\}/)?.[1] ?? "";
  assert.match(focusRule, /outline: 3px solid var\(--green-dark\);/);
});

test("lo script della pagina carica il video solo nella finestra della chiave", () => {
  const app = readFileSync(APP_SCRIPT, "utf8");
  assert.match(app, new RegExp(`const VIDEO_SRC = "${escapeRegExp(VIDEO_URL)}";`));
  assert.match(app, new RegExp(`const VIDEO_POSTER = "${escapeRegExp(POSTER_URL)}";`));
  assert.match(app, /video\.preload = "none";/);
  assert.match(app, /video\.controls = true;/);
  // Il video si monta all’apertura della finestra della chiave e si ferma
  // (e viene tolto) alla chiusura.
  assert.match(app, /dialog: document\.getElementById\("key-guide"\),\s*onOpen: mountVideo,\s*onClose: unmountVideo,/);
  assert.match(app, /video\.pause\(\);/);
  assert.match(app, /dialog\.showModal\(\);/);
  assert.match(app, /if \(event\.target === dialog\) dialog\.close\(\);/);
  // Alla chiusura della guida il focus va all’avviso se il configuratore si è
  // chiuso nel frattempo, altrimenti torna al pulsante di aiuto.
  assert.match(app, /dialog\.addEventListener\("close", \(\) => \{\s*if \(onClose\) onClose\(\);[\s\S]*?if \(serverClosed\) sessionClosed\.focus\(\);[\s\S]*?else button\.focus\(\);/);
  // Senza <dialog> ogni guida apre la propria pagina di riferimento.
  assert.match(app, /window\.open\(fallbackUrl, "_blank", "noreferrer"\)/);
  assert.match(app, /dialog: document\.getElementById\("link-guide"\),\s*fallbackUrl: CRM_URL,/);
  assert.match(app, /onClose: unmountVideo,\s*fallbackUrl: GUIDE_URL,/);

  // Nessun optional chaining: la pagina resta compatibile con i browser
  // meno recenti, che altrimenti non eseguirebbero lo script.
  assert.doesNotMatch(app, /\?\./);

  // «Mostra» alterna il tipo del campo tra password e text e resta visibile
  // in ogni browser.
  assert.match(app, /keyInput\.type = showing \? "password" : "text";/);
  assert.doesNotMatch(app, /visibilityToggle\.hidden/);
  assert.doesNotMatch(app, /CSS\.supports|classList\.toggle\("is-visible"\)/);

  // Battito solo con la scheda in vista.
  assert.match(app, /fetch\("status"/);
  assert.match(app, /HEARTBEAT_MS = 60 \* 1000/);
  assert.match(app, /document\.visibilityState !== "visible"\) return;/);
  // Un 403 vuol dire pagina senza sessione, non configuratore chiuso.
  assert.match(app, /response\.status === 403 \? "unlinked" : "closed"/);
  assert.match(app, /Questa pagina non è più collegata al configuratore\. Ricaricala/);

  // Prima di spedire la chiave la pagina controlla che il configuratore
  // risponda: se è chiuso la chiave non lascia la pagina.
  const submitHandler = app.slice(app.indexOf('form.addEventListener("submit"'), app.indexOf("function closeWindow"));
  const checkServerBody = app.slice(app.indexOf("async function checkServer()"), app.indexOf("async function heartbeat()"));
  assert.match(checkServerBody, /fetch\("status"/);
  const pingAt = submitHandler.indexOf("await checkServer()");
  assert.ok(pingAt > 0, "controllo di presenza nel gestore submit");
  assert.ok(pingAt < submitHandler.indexOf("JSON.stringify("), "il controllo precede la costruzione del corpo");
  assert.ok(pingAt < submitHandler.indexOf('fetch("connect"'), "il controllo precede l’invio");

  // Messaggi di chiusura veri in ogni caso.
  assert.match(app, /la chiave potrebbe essere stata salvata oppure no\. Chiedi all’agente di verificare/);
  assert.match(app, /showServerClosed\("uncertain"\)/);
  // In anteprima non si salva nulla: mai il messaggio di esito incerto.
  assert.match(app, /previewMode && reason === "uncertain" \? "closed" : reason/);
  // Con una guida aperta, l’avviso non resta sotto lo sfondo della finestra.
  assert.match(app, /if \(hadGuideOpen\) \{\s*closeGuides\(\);\s*sessionClosed\.focus\(\);/);
  assert.match(app, /new BroadcastChannel\(/);
  assert.match(app, /Collegamento completato in un’altra scheda/);
});

test("status richiede host, sessione e cookie validi", async (t) => {
  const { server, url } = await startWizard({ preview: true, noOpen: true, port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { cookie } = await openSession(url);

  const response = await fetch(new URL("status", url), { headers: { Cookie: cookie.split(";", 1)[0] } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.deepEqual(await response.json(), { ok: true });

  assert.equal((await fetch(new URL("status", url))).status, 403);
  assert.equal((await fetch(new URL("status", url), { headers: { Cookie: "futuria_setup=sbagliato" } })).status, 403);

  const origin = new URL(url).origin;
  assert.equal((await fetch(`${origin}/altra-sessione/status`)).status, 404);
  assert.equal(await getWithHost(new URL("status", url).href, `localhost:${new URL(url).port}`), 400);
});

test("due anteprime aperte insieme non si sovrascrivono il cookie", async (t) => {
  const first = await startWizard({ preview: true, noOpen: true, port: 0 });
  t.after(() => new Promise((resolve) => first.server.close(resolve)));
  const second = await startWizard({ preview: true, noOpen: true, port: 0 });
  t.after(() => new Promise((resolve) => second.server.close(resolve)));

  const cookieA = (await openSession(first.url)).cookie.split(";", 1)[0];
  const cookieB = (await openSession(second.url)).cookie.split(";", 1)[0];
  // Il browser li conserva entrambi per 127.0.0.1 e li invia insieme.
  assert.notEqual(cookieA.split("=")[0], cookieB.split("=")[0]);
  const jar = `${cookieA}; ${cookieB}`;
  const status = async (url, cookieHeader) => (await fetch(new URL("status", url), { headers: { Cookie: cookieHeader } })).status;
  assert.equal(await status(first.url, jar), 200);
  assert.equal(await status(second.url, jar), 200);
  assert.equal(await status(first.url, cookieB), 403);
});

test("la sessione si chiude dopo l’inattività e il battito con il cookie la rinnova", async (t) => {
  const { server, url } = await startWizard({ preview: true, noOpen: true, port: 0, idleTimeoutMs: 1000 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const closed = once(server, "close");
  const { cookie } = await openSession(url);

  await sleep(400);
  assert.equal(await statusOk(url, cookie), true);
  await sleep(700);
  // Senza il rinnovo la sessione sarebbe scaduta a 1000 ms.
  assert.equal(server.listening, true);

  const outcome = await Promise.race([closed.then(() => "closed"), sleep(5000).then(() => "timeout")]);
  assert.equal(outcome, "closed");
  assert.equal(await statusOk(url, cookie), false);
});

test("richieste senza cookie e file statici non rinnovano la sessione", async (t) => {
  const started = Date.now();
  const { server, url } = await startWizard({ preview: true, noOpen: true, port: 0, idleTimeoutMs: 2000 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const closed = once(server, "close").then(() => Date.now() - started);

  await sleep(1200);
  assert.equal((await fetch(new URL("status", url))).status, 403);
  const asset = await fetch(new URL("app.js", url));
  assert.equal(asset.status, 200);
  await asset.arrayBuffer();

  const elapsed = await Promise.race([closed, sleep(6000).then(() => Infinity)]);
  // Con il rinnovo si chiuderebbe intorno a 3200 ms.
  assert.ok(elapsed < 2900, `chiuso dopo ${elapsed} ms`);
});

test("il limite assoluto chiude il server anche con il battito attivo", async (t) => {
  const started = Date.now();
  const { server, url } = await startWizard({
    preview: true,
    noOpen: true,
    port: 0,
    idleTimeoutMs: 10_000,
    maxLifetimeMs: 1200,
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  let closedAt = 0;
  server.once("close", () => { closedAt = Date.now() - started; });
  const { cookie } = await openSession(url);

  const deadline = Date.now() + 6000;
  while (!closedAt && Date.now() < deadline) {
    await statusOk(url, cookie);
    await sleep(200);
  }
  assert.ok(closedAt > 0, "il server deve chiudersi");
  assert.ok(closedAt >= 1100 && closedAt < 4000, `chiuso dopo ${closedAt} ms`);
});

test("alla chiusura una connessione già aperta non accetta altre richieste", async (t) => {
  const { server, url } = await startWizard({
    preview: true,
    noOpen: true,
    port: 0,
    idleTimeoutMs: 60_000,
    maxLifetimeMs: 800,
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const target = new URL(url);
  const { cookie, csrf } = await openSession(url);
  const body = JSON.stringify({ accountLink: "demoAccount1234567890", privateKey: PREVIEW_KEY });
  const head = `POST ${target.pathname}connect HTTP/1.1\r\nHost: ${target.host}\r\nOrigin: ${target.origin}\r\n`
    + `Cookie: ${cookie.split(";", 1)[0]}\r\nX-Futuria-CSRF: ${csrf}\r\nContent-Type: application/json\r\n`
    + `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;

  const socket = netConnect(Number(target.port), "127.0.0.1");
  t.after(() => socket.destroy());
  let data = "";
  let socketClosed = false;
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => { data += chunk; });
  socket.on("close", () => { socketClosed = true; });
  socket.on("error", () => {});
  await once(socket, "connect");

  // Intestazioni prima del limite, corpo dopo: la richiesta è in corso
  // quando il configuratore si chiude.
  socket.write(head);
  assert.equal(await waitFor(() => !server.listening, 5000), true, "il limite assoluto chiude il server");
  socket.write(body);
  assert.equal(await waitFor(() => data.includes("\r\n\r\n"), 3000), true, "la richiesta in corso riceve risposta");
  assert.match(data, /^HTTP\/1\.1 200/);
  assert.match(data, /\r\nConnection: close\r\n/i);

  // Una seconda richiesta sullo stesso socket non deve passare.
  data = "";
  if (!socketClosed) socket.write(head + body);
  await waitFor(() => socketClosed || /\r\n\r\n/.test(data), 3000);
  assert.doesNotMatch(data, /^HTTP\/1\.1 200/);
  assert.equal(await waitFor(() => socketClosed, 3000), true, "il socket si chiude");
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

  const { cookie } = await openSession(url);
  assert.equal(await statusOk(url, cookie), true);
});

test("--result-file si accetta solo con --detach", () => {
  assert.equal(parseArgs(["--detach", "--result-file", "esito.json"]).resultFile, "esito.json");
  assert.throws(() => parseArgs(["--result-file", "esito.json"]), /soltanto con --detach/);
  assert.throws(() => parseArgs(["--detach", "--result-file"]), /file/);
});

test("runChild non cade se il processo chiude l’input in anticipo", async () => {
  await assert.rejects(
    runChild(process.execPath, ["-e", "process.exit(3)"], "x".repeat(8 * 1024 * 1024)),
    /Il salvataggio protetto non è riuscito \(codice 3\)\./,
  );
});

test("--detach attende il configuratore in ascolto, stampa l’indirizzo e il padre esce", async (t) => {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/preview/`;
  const directory = mkdtempSync(join(tmpdir(), "futuria-detach-test-"));
  const resultFile = join(directory, "esito.json");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const launch = spawnSync(
    process.execPath,
    [WIZARD_SCRIPT, "--detach", "--preview", "--no-open", "--port", String(port), "--result-file", resultFile],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(launch.error, undefined, "il padre non deve restare in attesa del figlio");
  assert.equal(launch.status, 0, launch.stderr);
  const pid = Number(launch.stdout.match(/PID (\d+)/)?.[1]);
  assert.ok(pid > 0, launch.stdout);
  t.after(() => {
    try { process.kill(pid); } catch { /* già chiuso */ }
  });
  assert.ok(launch.stdout.includes(`disponibile su ${url}`), launch.stdout);
  assert.deepEqual(JSON.parse(readFileSync(resultFile, "utf8")), { ok: true, pid, url });

  // Quando il padre esce il configuratore è già in ascolto: nessuna attesa.
  assert.equal(await pageOk(url), true, "il configuratore staccato risponde subito");

  const { cookie, csrf } = await openSession(url);
  assert.equal(await statusOk(url, cookie), true);
  const accepted = await previewConnect(url, cookie, csrf);
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).ok, true);

  assert.equal(await waitFor(async () => !(await pageOk(url)), 15000), true, "il configuratore si chiude dopo il collegamento");
  assert.equal(await waitFor(() => !processAlive(pid), 10000), true, "il processo staccato termina");
});

test("--detach esce con errore se il configuratore non può mettersi in ascolto", async (t) => {
  const blocker = createNetServer();
  await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => blocker.close(resolve)));
  const { port } = blocker.address();
  const directory = mkdtempSync(join(tmpdir(), "futuria-detach-test-"));
  const resultFile = join(directory, "esito.json");
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const launch = spawnSync(
    process.execPath,
    [WIZARD_SCRIPT, "--detach", "--preview", "--no-open", "--port", String(port), "--result-file", resultFile],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(launch.error, undefined);
  assert.equal(launch.status, 1, launch.stdout);
  assert.match(launch.stderr, /Impossibile avviare il configuratore: .*EADDRINUSE/);
  assert.doesNotMatch(launch.stdout, /disponibile|aperto nel browser/);
  const result = JSON.parse(readFileSync(resultFile, "utf8"));
  assert.equal(result.ok, false);
  assert.match(result.message, /EADDRINUSE/);
});

test("--detach non avvia nulla se il file d’esito non si può scrivere", async () => {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/preview/`;
  const resultFile = join(tmpdir(), `futuria-nonexist-${randomBytes(6).toString("hex")}`, "esito.json");

  const launch = spawnSync(
    process.execPath,
    [WIZARD_SCRIPT, "--detach", "--preview", "--no-open", "--port", String(port), "--result-file", resultFile],
    { encoding: "utf8", timeout: 15000 },
  );
  // Nessun configuratore rimasto in ascolto senza che qualcuno ne conosca
  // l’indirizzo; se ci fosse, lo si chiude con un collegamento di anteprima.
  const listening = await pageOk(url);
  if (listening) {
    const { cookie, csrf } = await openSession(url);
    await (await previewConnect(url, cookie, csrf)).arrayBuffer();
  }
  assert.equal(launch.error, undefined);
  assert.equal(listening, false);
  assert.equal(launch.status, 1, launch.stdout);
  assert.match(launch.stderr, /Impossibile avviare il configuratore/);
  assert.doesNotMatch(launch.stdout, /PID/);
});

test("il launcher Windows non avvia nulla se la cartella temporanea non è scrivibile", {
  skip: process.platform !== "win32",
}, (t) => {
  const directory = mkdtempSync(join(tmpdir(), "futuria-launcher-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  // TEMP e TMP puntano a un file: il file d’esito non si può creare.
  const notADirectory = join(directory, "non-una-cartella");
  writeFileSync(notADirectory, "");
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !["temp", "tmp"].includes(key.toLowerCase())),
  );
  environment.TEMP = notADirectory;
  environment.TMP = notADirectory;

  const before = windowsWizardProcessIds();
  const launch = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", LAUNCHER_PS1, "-Preview", "-NoOpen"],
    { encoding: "utf8", timeout: 60000, env: environment },
  );
  // Prima delle asserzioni: anche se il test fallisce non resta nulla in ascolto.
  const leaked = [...windowsWizardProcessIds()].filter((pid) => !before.has(pid));
  for (const pid of leaked) {
    try { process.kill(pid); } catch { /* già chiuso */ }
  }
  assert.equal(launch.error, undefined);
  assert.deepEqual(leaked, [], "nessun nuovo configuratore in esecuzione");
  assert.equal(launch.status, 1, launch.stdout + launch.stderr);
  assert.match(launch.stdout, /la cartella temporanea non e' scrivibile/);
});

test("il launcher Windows avvia il configuratore via WMI e ne comunica l’indirizzo", {
  skip: process.platform !== "win32",
}, async (t) => {
  const launch = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", LAUNCHER_PS1, "-Preview", "-NoOpen"],
    { encoding: "utf8", timeout: 60000 },
  );
  assert.equal(launch.error, undefined);
  assert.equal(launch.status, 0, launch.stderr);
  // Il ripiego su Start-Process va segnalato: qui WMI deve funzionare.
  assert.doesNotMatch(launch.stdout, /senza WMI/);
  const match = launch.stdout.match(/disponibile su (http:\/\/127\.0\.0\.1:\d+\/preview\/) \(processo separato, PID (\d+)\)/);
  assert.ok(match, launch.stdout);
  const [, url, pidText] = match;
  const pid = Number(pidText);
  t.after(() => {
    try { process.kill(pid); } catch { /* già chiuso */ }
  });

  const { cookie, csrf } = await openSession(url);
  assert.equal(await statusOk(url, cookie), true);
  const accepted = await previewConnect(url, cookie, csrf);
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).ok, true);
  assert.equal(await waitFor(() => !processAlive(pid), 15000), true, "il configuratore termina dopo il collegamento");
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
}, (t) => {
  // APPDATA, USERPROFILE e HOME temporanei: la cartella reale della skill e
  // quella dell’app desktop non vengono mai toccate.
  const state = createIsolatedState(t);
  assertPowerShellChildIsolated(state);
  const setupScript = join(SCRIPTS_DIR, "setup-credentials.ps1");
  const environment = windowsPowerShellEnvironment({
    ...state.env,
    PSModulePath: "C:\\Program Files\\PowerShell\\Modules",
  });
  assert.equal(
    Object.keys(environment).some((key) => key.toLowerCase() === "psmodulepath"),
    false,
  );
  // Lo store dell’app desktop nella sua cartella deve restare identico.
  mkdirSync(state.windows.legacyDir, { recursive: true });
  writeFileSync(join(state.windows.legacyDir, "config.json"), APP_STORE_TEXT);
  const appBefore = snapshot(state.windows.legacyDir);

  const store = spawnSync(
    POWERSHELL,
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
    POWERSHELL,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", setupScript, "-Status"],
    { encoding: "utf8", env: environment },
  );
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /Chiave privata protetta: presente/);
  assert.match(status.stdout, /ID account: presente/);
  assert.equal(status.stdout.includes("pit-preview"), false);

  const credentialPath = join(state.windows.stateDir, "credential.xml");
  const readEnvironment = { ...environment, FUTURIA_TEST_CREDENTIAL_PATH: credentialPath };
  const read = spawnSync(
    POWERSHELL,
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

  const config = JSON.parse(readFileSync(join(state.windows.stateDir, "config.json"), "utf8"));
  assert.equal(config.location, "demoAccount1234567890");
  assert.equal(config.storage, "windows-dpapi");
  assert.match(config.updated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/);
  assert.deepEqual(snapshot(state.windows.legacyDir), appBefore);
});

test("la schermata del passo 3 è quella nuova, esportata a 2×", () => {
  const image = readFileSync(join(SCRIPTS_DIR, "credential-wizard", "assets", "step-3-paste-here.png"));
  // Intestazione PNG e blocco IHDR: larghezza e altezza in big-endian.
  assert.equal(image.subarray(1, 4).toString("latin1"), "PNG");
  assert.equal(image.subarray(12, 16).toString("latin1"), "IHDR");
  assert.deepEqual([image.readUInt32BE(16), image.readUInt32BE(20)], [1400, 720]);
});
