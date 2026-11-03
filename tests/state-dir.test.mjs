// Cartella di stato separata dall’app desktop Futuria CRM (v1.3.3).
// Tutti i test girano in cartelle temporanee: vedi helpers/isolated-state.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";

import {
  classifyLegacyConfig,
  isValidPosixHome,
  isValidWindowsRoot,
  legacyStateDirectory,
  stateDirectory,
  storeMacCredential,
} from "../skills/futuria-crm/scripts/credential-wizard.mjs";
import { APP_STORE_TEXT, CONFIG_CASES, DEMO_ID } from "./fixtures/state-config-cases.mjs";
import {
  assertIsolatedPath,
  assertPowerShellChildIsolated,
  bashExecutable,
  createFakeTools,
  createIsolatedState,
  FAKE_PIT,
  listTemps,
  POWERSHELL,
  runBash,
  runPowerShellCommand,
  runPowerShellFile,
  SCRIPTS_DIR,
  snapshot,
  toBashPath,
  writeCredentialFixture,
} from "./helpers/isolated-state.mjs";

const isWindows = process.platform === "win32";
const BASH = bashExecutable();
const bashAvailable = Boolean(BASH) && spawnSync(BASH, ["-c", "exit 0"], { windowsHide: true }).status === 0;
const SKILL_CONFIG_WINDOWS = `{\r\n    "location":  "${DEMO_ID}",\r\n    "updated_at":  "2026-10-14T09:12:33.1234567Z",\r\n    "storage":  "windows-dpapi"\r\n}\r\n`;
const SKILL_CONFIG_MAC = `{\n  "location": "${DEMO_ID}",\n  "storage": "macos-keychain"\n}\n`;

function lines(text) {
  return text.replace(/\r/g, "").trim().split("\n").map((line) => line.trim()).filter(Boolean);
}

// Il testo di un errore PowerShell va a capo alla larghezza della console; pwsh 7
// aggiunge i colori ANSI e il margine «|» della vista concisa degli errori.
function flat(text) {
  return text
    .replace(/\x1B\[[0-9;]*m/g, "")
    .replace(/(^|\s)\|(?=\s)/gm, " ")
    .replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Percorsi
// ---------------------------------------------------------------------------

test("cartelle di stato per Windows, macOS e Linux con ambiente iniettato", () => {
  const winEnv = { USERPROFILE: "C:\\Users\\Mario Rossi", APPDATA: "C:\\Users\\Mario Rossi\\AppData\\Roaming" };
  assert.equal(stateDirectory({ platform: "win32", env: winEnv }), "C:\\Users\\Mario Rossi\\.futuria-crm-skill");
  assert.equal(legacyStateDirectory({ platform: "win32", env: winEnv }), "C:\\Users\\Mario Rossi\\AppData\\Roaming\\Futuria CRM");
  // Su Windows i nomi delle variabili non distinguono le maiuscole.
  assert.equal(
    stateDirectory({ platform: "win32", env: { userprofile: "D:\\Profili\\D'Angelo Nicolò" } }),
    "D:\\Profili\\D'Angelo Nicolò\\.futuria-crm-skill",
  );
  // Cartelle reindirizzate dalle aziende: UNC valido.
  assert.equal(
    stateDirectory({ platform: "win32", env: { USERPROFILE: "\\\\server\\profili\\mrossi" } }),
    "\\\\server\\profili\\mrossi\\.futuria-crm-skill",
  );

  const macEnv = { HOME: "/Users/mario" };
  assert.equal(
    stateDirectory({ platform: "darwin", env: macEnv }),
    "/Users/mario/Library/Application Support/com.futuriamarketing.futuria-crm-skill",
  );
  assert.equal(
    legacyStateDirectory({ platform: "darwin", env: macEnv }),
    "/Users/mario/Library/Application Support/Futuria CRM",
  );
  assert.equal(stateDirectory({ platform: "darwin", env: {}, home: "/Users/anna/" }),
    "/Users/anna/Library/Application Support/com.futuriamarketing.futuria-crm-skill");

  // Su Linux nessuna cartella: solo variabili d’ambiente.
  assert.equal(stateDirectory({ platform: "linux", env: macEnv }), null);
  assert.equal(legacyStateDirectory({ platform: "linux", env: macEnv }), null);
});

test("cartelle vuote, relative o anomale vengono rifiutate", () => {
  for (const value of ["", "C:foo", "\\foo", "relativo", "\\\\?\\C:\\Users\\x", "\\\\.\\pipe\\x", "C:\\Users\\..\\Windows", "C:\\Users\\a\u0007b", undefined]) {
    assert.equal(isValidWindowsRoot(value), false, String(value));
    assert.throws(() => stateDirectory({ platform: "win32", env: { USERPROFILE: value } }), /USERPROFILE non è valida/);
    assert.equal(legacyStateDirectory({ platform: "win32", env: { APPDATA: value } }), null);
  }
  for (const value of ["C:\\Users\\Mario Rossi", "C:/Users/mario", "\\\\server\\share\\profili", "D:\\Profili\\D'Angelo (2) [x] è"]) {
    assert.equal(isValidWindowsRoot(value), true, value);
  }
  for (const value of ["", "/", "relativo/home", "/Users/../etc", "/Users/a\nb"]) {
    assert.equal(isValidPosixHome(value), false, JSON.stringify(value));
    assert.throws(() => stateDirectory({ platform: "darwin", env: { HOME: value } }), /HOME non è valida/);
  }
  assert.equal(isValidPosixHome("/Users/D'Angelo Nicolò"), true);
});

// ---------------------------------------------------------------------------
// Riconoscimento del config.json della skill
// ---------------------------------------------------------------------------

test("classificazione del config.json in Node sulle fixture comuni", () => {
  for (const runtime of ["win32", "darwin"]) {
    for (const item of CONFIG_CASES) {
      const result = classifyLegacyConfig(item.text, { platform: runtime });
      assert.equal(result ? result.location : null, item[runtime], `${runtime}: ${item.name}`);
    }
  }
  assert.equal(classifyLegacyConfig(SKILL_CONFIG_MAC, { platform: "linux" }), null);
  // L’updated_at si conserva com’è, senza conversioni di data.
  assert.equal(classifyLegacyConfig(SKILL_CONFIG_WINDOWS, { platform: "win32" }).updated_at, "2026-10-14T09:12:33.1234567Z");
});

function writeCaseFiles(state) {
  const dir = join(state.root, "fixture");
  mkdirSync(dir, { recursive: true });
  return CONFIG_CASES.map((item, index) => {
    const path = join(dir, `caso-${index}.json`);
    writeFileSync(path, item.text, "utf8");
    return { ...item, path };
  });
}

test("classificazione in PowerShell sulle fixture comuni e sui file speciali", { skip: !isWindows }, (t) => {
  const state = createIsolatedState(t);
  const cases = writeCaseFiles(state);
  const dir = join(state.root, "fixture");
  const folder = join(dir, "una-cartella");
  mkdirSync(folder);
  const extra = [{ name: "cartella", path: folder, win32: null }];
  const target = join(dir, "bersaglio.json");
  writeFileSync(target, SKILL_CONFIG_WINDOWS);
  extra.push({ name: "file di riferimento", path: target, win32: DEMO_ID });
  try {
    const link = join(dir, "collegamento.json");
    symlinkSync(target, link, "file");
    extra.push({ name: "collegamento simbolico", path: link, win32: null });
  } catch (error) {
    t.diagnostic(`collegamento simbolico non creato (${error.code}): caso saltato`);
  }
  const all = [...cases, ...extra];
  const result = runPowerShellCommand(
    state,
    ". $env:FUTURIA_TEST_STATE_SCRIPT; foreach ($p in ($env:FUTURIA_TEST_FILES -split '\\|')) { $c = ConvertFrom-FuturiaConfigText (Read-FuturiaSmallText $p $FuturiaConfigMaxBytes); if ($null -eq $c) { Write-Output '<null>' } else { Write-Output $c.location } }",
    { FUTURIA_TEST_FILES: all.map((item) => item.path).join("|") },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = lines(result.stdout);
  assert.equal(output.length, all.length, result.stdout);
  all.forEach((item, index) => {
    assert.equal(output[index] === "<null>" ? null : output[index], item.win32, item.name);
  });
  // Nessun valore dello store dell’app nell’output.
  assert.doesNotMatch(result.stdout + result.stderr, /valore-fittizio/);
});

test("formati storici scritti dal vero PowerShell vengono riconosciuti", { skip: !isWindows }, (t) => {
  const state = createIsolatedState(t);
  const dir = join(state.root, "storici");
  mkdirSync(dir);
  const shells = [POWERSHELL];
  if (POWERSHELL !== "pwsh" && spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"], { windowsHide: true }).status === 0) {
    shells.push("pwsh");
  }
  const generated = [];
  for (const shell of shells) {
    const tag = shell.replace(/\W/g, "");
    const setContent = join(dir, `${tag}-set-content.json`);
    const writeAllText = join(dir, `${tag}-write-all-text.json`);
    // Righe esatte di a60ead7 (1.1.0) e di 27d7db6 (1.2.0-1.3.2).
    const command = [
      "@{ location = $env:FUTURIA_TEST_ID; updated_at = (Get-Date).ToUniversalTime().ToString('o'); storage = 'windows-dpapi' } | ConvertTo-Json | Set-Content -LiteralPath $env:FUTURIA_TEST_A -Encoding UTF8",
      "$configJson = @{ location = $env:FUTURIA_TEST_ID; updated_at = (Get-Date).ToUniversalTime().ToString('o'); storage = 'windows-dpapi' } | ConvertTo-Json",
      "$utf8NoBom = New-Object System.Text.UTF8Encoding($false)",
      "[System.IO.File]::WriteAllText($env:FUTURIA_TEST_B, $configJson + [Environment]::NewLine, $utf8NoBom)",
    ].join("; ");
    const result = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", command], {
      encoding: "utf8",
      env: { ...state.env, FUTURIA_TEST_ID: DEMO_ID, FUTURIA_TEST_A: setContent, FUTURIA_TEST_B: writeAllText },
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    generated.push(setContent, writeAllText);
  }
  for (const path of generated) {
    assert.equal(classifyLegacyConfig(readFileSync(path), { platform: "win32" })?.location, DEMO_ID, path);
  }
  const result = runPowerShellCommand(
    state,
    ". $env:FUTURIA_TEST_STATE_SCRIPT; foreach ($p in ($env:FUTURIA_TEST_FILES -split '\\|')) { $c = ConvertFrom-FuturiaConfigText (Read-FuturiaSmallText $p $FuturiaConfigMaxBytes); if ($null -eq $c) { Write-Output '<null>' } else { Write-Output $c.location } }",
    { FUTURIA_TEST_FILES: generated.join("|") },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(lines(result.stdout), generated.map(() => DEMO_ID));
});

test("classificazione in Bash sulle fixture comuni e sui file speciali", { skip: !bashAvailable }, (t) => {
  const state = createIsolatedState(t);
  const tools = createFakeTools(state);
  const cases = writeCaseFiles(state);
  const dir = join(state.root, "fixture");
  const folder = join(dir, "una-cartella");
  mkdirSync(folder);
  const extra = [{ name: "cartella", path: folder, darwin: null }];
  const target = join(dir, "bersaglio.json");
  writeFileSync(target, SKILL_CONFIG_MAC);
  extra.push({ name: "file di riferimento", path: target, darwin: DEMO_ID });
  if (!isWindows) {
    const link = join(dir, "collegamento.json");
    symlinkSync(target, link);
    extra.push({ name: "collegamento simbolico", path: link, darwin: null });
  }
  const all = [...cases, ...extra];
  const script = [
    "set -euo pipefail",
    '. "$FUTURIA_TEST_STATE_SH"',
    'while IFS= read -r f; do',
    '  if futuria_classify_config "$f"; then printf "%s\\n" "$FUTURIA_CFG_LOCATION"; else printf "<null>\\n"; fi',
    'done <<< "$FUTURIA_TEST_FILES"',
  ].join("\n");
  const result = runBash(state, tools, ["-c", script], {
    env: {
      FUTURIA_TEST_STATE_SH: toBashPath(join(SCRIPTS_DIR, "state-dir.sh")),
      FUTURIA_TEST_FILES: all.map((item) => toBashPath(item.path)).join("\n"),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const output = lines(result.stdout);
  assert.equal(output.length, all.length, result.stdout);
  all.forEach((item, index) => {
    assert.equal(output[index] === "<null>" ? null : output[index], item.darwin, item.name);
  });
});

// ---------------------------------------------------------------------------
// macOS: configuratore (Node) con Portachiavi finto
// ---------------------------------------------------------------------------

test("il configuratore macOS scrive solo nella cartella della skill", async (t) => {
  const state = createIsolatedState(t);
  mkdirSync(state.mac.legacyDir, { recursive: true });
  writeFileSync(join(state.mac.legacyDir, "config.json"), APP_STORE_TEXT);
  const legacyBefore = snapshot(state.mac.legacyDir);
  const stored = [];

  await storeMacCredential(DEMO_ID, FAKE_PIT, {
    configDir: state.mac.stateDir,
    writeKeychain: async (key) => { stored.push(key.length); },
  });
  assert.deepEqual(stored, [FAKE_PIT.length]);
  const config = readFileSync(join(state.mac.stateDir, "config.json"), "utf8");
  assert.equal(classifyLegacyConfig(config, { platform: "darwin" })?.location, DEMO_ID);
  assert.equal(config.includes(FAKE_PIT), false);
  assert.deepEqual(listTemps(state.mac.stateDir), []);
  assert.deepEqual(snapshot(state.mac.legacyDir), legacyBefore);
  if (!isWindows) {
    assert.equal(statSync(state.mac.stateDir).mode & 0o777, 0o700);
    assert.equal(statSync(join(state.mac.stateDir, "config.json")).mode & 0o777, 0o600);
  }

  // Un secondo collegamento sostituisce il primo. Mentre la chiave cambia
  // l’ID precedente non c’è già più.
  const configPath = join(state.mac.stateDir, "config.json");
  let idDuringKeychain = null;
  await storeMacCredential("otherAccount123456", FAKE_PIT, {
    configDir: state.mac.stateDir,
    writeKeychain: async () => { idDuringKeychain = existsSync(configPath); },
  });
  assert.equal(idDuringKeychain, false);
  assert.equal(
    classifyLegacyConfig(readFileSync(configPath), { platform: "darwin" })?.location,
    "otherAccount123456",
  );

  // Un ricollegamento interrotto mentre si salva la chiave lascia «chiave
  // presente, ID mancante», mai la chiave nuova con l’ID di prima.
  await assert.rejects(
    storeMacCredential("thirdAccount123456", FAKE_PIT, {
      configDir: state.mac.stateDir,
      writeKeychain: async () => { throw new Error("Portachiavi finto interrotto"); },
    }),
    /Portachiavi finto interrotto/,
  );
  assert.equal(existsSync(configPath), false);
  assert.deepEqual(listTemps(state.mac.stateDir), []);

  // Se il Portachiavi fallisce non resta nessuna configurazione nuova né temporaneo.
  const failing = join(state.root, "cartella-fallita");
  await assert.rejects(
    storeMacCredential(DEMO_ID, FAKE_PIT, {
      configDir: failing,
      writeKeychain: async () => { throw new Error("Portachiavi finto non disponibile"); },
    }),
    /Portachiavi finto/,
  );
  assert.equal(existsSync(join(failing, "config.json")), false);
  assert.deepEqual(listTemps(failing), []);
  assert.deepEqual(snapshot(state.mac.legacyDir), legacyBefore);
});

// Su Windows HOME non può essere un percorso POSIX assoluto dentro la cartella
// temporanea: il test gira su macOS e Linux (CI).
test("il configuratore macOS salva per impostazione nella cartella della skill", { skip: isWindows }, async (t) => {
  const state = createIsolatedState(t);
  const savedHome = process.env.HOME;
  process.env.HOME = state.profile;
  t.after(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
  });
  const expected = stateDirectory({ platform: "darwin", env: process.env, home: homedir() });
  assertIsolatedPath(expected, state.root, "cartella predefinita del configuratore");
  assert.equal(expected, state.mac.stateDir);
  mkdirSync(state.mac.legacyDir, { recursive: true });
  writeFileSync(join(state.mac.legacyDir, "config.json"), APP_STORE_TEXT);
  const legacyBefore = snapshot(state.mac.legacyDir);

  await storeMacCredential(DEMO_ID, FAKE_PIT, { writeKeychain: async () => {} });
  const config = readFileSync(join(state.mac.stateDir, "config.json"), "utf8");
  assert.equal(classifyLegacyConfig(config, { platform: "darwin" })?.location, DEMO_ID);
  assert.deepEqual(snapshot(state.mac.legacyDir), legacyBefore);
});

test("l’anteprima del configuratore non salva e non crea cartelle di stato", async (t) => {
  const state = createIsolatedState(t);
  const child = spawn(
    process.execPath,
    [join(SCRIPTS_DIR, "credential-wizard.mjs"), "--preview", "--no-open", "--port", "0"],
    { env: state.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  t.after(() => { try { child.kill(); } catch { /* già chiuso */ } });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  const deadline = Date.now() + 15000;
  while (!/disponibile su (http:\/\/127\.0\.0\.1:\d+\/preview\/)/.test(output) && Date.now() < deadline) {
    await sleep(100);
  }
  const url = output.match(/disponibile su (http:\/\/127\.0\.0\.1:\d+\/preview\/)/)?.[1];
  assert.ok(url, output);
  const page = await fetch(url);
  const cookie = page.headers.get("set-cookie").split(";", 1)[0];
  const csrf = (await page.text()).match(/<meta name="csrf-token" content="([a-f0-9]+)">/)?.[1];
  const response = await fetch(new URL("connect", url), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: new URL(url).origin, "X-Futuria-CSRF": csrf },
    body: JSON.stringify({ accountLink: DEMO_ID, privateKey: FAKE_PIT }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).preview, true);
  await once(child, "exit");
  for (const dir of [state.windows.stateDir, state.windows.legacyDir, state.mac.stateDir, state.mac.legacyDir]) {
    assert.equal(existsSync(dir), false, dir);
  }
});

// ---------------------------------------------------------------------------
// Windows: setup-credentials.ps1 e crm-api.ps1 con APPDATA e USERPROFILE temporanei
// ---------------------------------------------------------------------------

function windowsState(t) {
  const state = createIsolatedState(t);
  assertPowerShellChildIsolated(state);
  return state;
}

function legacyFiles(state) {
  return {
    credential: join(state.windows.legacyDir, "credential.xml"),
    config: join(state.windows.legacyDir, "config.json"),
  };
}

function newFiles(state) {
  return {
    credential: join(state.windows.stateDir, "credential.xml"),
    config: join(state.windows.stateDir, "config.json"),
  };
}

function windowsStatus(state) {
  const result = runPowerShellFile(state, "setup-credentials.ps1", ["-Status"]);
  assert.equal(result.stdout.includes(FAKE_PIT), false);
  assert.doesNotMatch(result.stdout + result.stderr, /valore-fittizio/);
  return result;
}

test("Windows: con lo store dell’app e la chiave della skill copia solo la chiave e chiede di ricollegare", { skip: !isWindows }, (t) => {
  const state = windowsState(t);
  const legacy = legacyFiles(state);
  writeCredentialFixture(state, legacy.credential);
  writeFileSync(legacy.config, APP_STORE_TEXT);
  const before = snapshot(state.windows.legacyDir);

  const status = windowsStatus(state);
  assert.equal(status.status, 1, status.stdout + status.stderr);
  assert.deepEqual(lines(status.stdout), [
    "Chiave privata protetta: presente",
    "ID account: mancante",
    "Chiave privata della versione precedente copiata nella nuova cartella, senza ID account.",
    "Serve ricollegare l'account: apri di nuovo il configuratore.",
  ]);
  assert.ok(existsSync(newFiles(state).credential));
  assert.equal(existsSync(newFiles(state).config), false);
  assert.deepEqual(listTemps(state.windows.stateDir), []);
  // Lo store dell’app resta identico: contenuto, data e permessi.
  assert.deepEqual(snapshot(state.windows.legacyDir), before);

  // Le chiamate successive non copiano lo store dell’app e non cambiano nulla.
  const afterCopy = snapshot(state.windows.stateDir);
  const again = windowsStatus(state);
  assert.equal(again.status, 1);
  assert.deepEqual(lines(again.stdout), [
    "Chiave privata protetta: presente",
    "ID account: mancante",
    "Serve ricollegare l'account: apri di nuovo il configuratore.",
  ]);
  assert.deepEqual(snapshot(state.windows.stateDir), afterCopy);
  assert.deepEqual(snapshot(state.windows.legacyDir), before);
});

test("Windows: la sola chiave della skill senza configurazione dà lo stesso esito", { skip: !isWindows }, (t) => {
  const state = windowsState(t);
  writeCredentialFixture(state, legacyFiles(state).credential);
  const before = snapshot(state.windows.legacyDir);
  const status = windowsStatus(state);
  assert.equal(status.status, 1);
  assert.match(status.stdout, /Chiave privata protetta: presente/);
  assert.match(status.stdout, /ID account: mancante/);
  assert.match(status.stdout, /Serve ricollegare l'account/);
  assert.deepEqual(snapshot(state.windows.legacyDir), before);
});

test("Windows: il vecchio formato della skill viene copiato e la vecchia cartella resta intatta", { skip: !isWindows }, (t) => {
  const state = windowsState(t);
  const legacy = legacyFiles(state);
  writeCredentialFixture(state, legacy.credential);
  writeFileSync(legacy.config, SKILL_CONFIG_WINDOWS);
  const before = snapshot(state.windows.legacyDir);

  const first = windowsStatus(state);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.deepEqual(lines(first.stdout), [
    "Chiave privata protetta: presente",
    "ID account: presente",
    "Configurazione della versione precedente copiata nella nuova cartella.",
  ]);
  const copied = classifyLegacyConfig(readFileSync(newFiles(state).config), { platform: "win32" });
  assert.equal(copied.location, DEMO_ID);
  assert.equal(copied.updated_at, "2026-10-14T09:12:33.1234567Z");
  // Copia, non spostamento: un’installazione 1.3.2 continua a funzionare.
  assert.deepEqual(snapshot(state.windows.legacyDir), before);

  // Dopo la copia, due Status di fila: stesso output e nessuna modifica.
  const afterCopy = snapshot(state.windows.stateDir);
  const second = windowsStatus(state);
  const third = windowsStatus(state);
  assert.equal(second.status, 0);
  assert.equal(second.stdout, third.stdout);
  assert.deepEqual(lines(second.stdout), ["Chiave privata protetta: presente", "ID account: presente"]);
  assert.deepEqual(snapshot(state.windows.stateDir), afterCopy);
  assert.deepEqual(snapshot(state.windows.legacyDir), before);

  // Un’installazione non aggiornata che ricollega l’account scrive nella
  // vecchia cartella: lo Status lo segnala.
  const future = new Date(Date.now() + 3600 * 1000);
  utimesSync(legacy.credential, future, future);
  const warned = windowsStatus(state);
  assert.match(warned.stdout, /Un'altra installazione del plugin non aggiornata usa ancora la vecchia cartella: aggiornala\./);
});

test("Windows: credential.xml non della skill resta intatto e non viene copiato", { skip: !isWindows }, (t) => {
  for (const variant of [{ kind: "altro" }, { userName: "altro-utente" }]) {
    const state = windowsState(t);
    const legacy = legacyFiles(state);
    writeCredentialFixture(state, legacy.credential, variant);
    const before = snapshot(state.windows.legacyDir);
    const status = windowsStatus(state);
    assert.equal(status.status, 1);
    assert.deepEqual(lines(status.stdout), ["Chiave privata protetta: mancante", "ID account: mancante"]);
    assert.equal(existsSync(state.windows.stateDir), false, "nessuna cartella nuova senza nulla da copiare");
    assert.deepEqual(snapshot(state.windows.legacyDir), before);
  }
});

test("Windows: con la chiave nuova presente la vecchia cartella non si usa più", { skip: !isWindows }, (t) => {
  const state = windowsState(t);
  writeCredentialFixture(state, newFiles(state).credential);
  const legacy = legacyFiles(state);
  writeCredentialFixture(state, legacy.credential, { pit: "pit-preview-other-account-123456" });
  writeFileSync(legacy.config, SKILL_CONFIG_WINDOWS);
  // La vecchia chiave è precedente alla nuova, come dopo un aggiornamento.
  const past = new Date(Date.now() - 3600 * 1000);
  utimesSync(legacy.credential, past, past);
  const before = snapshot(state.windows.legacyDir);
  const status = windowsStatus(state);
  // Mai la chiave di un account con l’ID di un altro.
  assert.equal(status.status, 1);
  assert.deepEqual(lines(status.stdout), [
    "Chiave privata protetta: presente",
    "ID account: mancante",
    "Serve ricollegare l'account: apri di nuovo il configuratore.",
  ]);
  assert.equal(existsSync(newFiles(state).config), false);
  assert.deepEqual(snapshot(state.windows.legacyDir), before);
});

// Set-Content sostituito solo dentro il processo di prova, dopo il
// dot-sourcing: simula il guasto durante la copia della configurazione.
function brokenSetContent(body) {
  return `function Set-Content { [CmdletBinding()] param($LiteralPath, $Value, $Encoding, [switch]$NoNewline) ${body} }`;
}

test("Windows: una copia rimasta a metà si completa alla chiamata successiva", { skip: !isWindows }, (t) => {
  const failures = [
    // Il salvataggio della configurazione fallisce: questa chiamata usa la
    // versione precedente in sola lettura.
    { name: "errore", body: "throw 'disco pieno simulato'", exit: 0, out: ["fallback", DEMO_ID] },
    // Il processo si chiude subito dopo lo spostamento della chiave.
    { name: "interruzione", body: "[Environment]::Exit(9)", exit: 9, out: [] },
  ];
  for (const failure of failures) {
    const state = windowsState(t);
    const legacy = legacyFiles(state);
    writeCredentialFixture(state, legacy.credential);
    writeFileSync(legacy.config, SKILL_CONFIG_WINDOWS);
    const before = snapshot(state.windows.legacyDir);

    const broken = runPowerShellCommand(state, [
      ". $env:FUTURIA_TEST_STATE_SCRIPT",
      brokenSetContent(failure.body),
      "$s = Resolve-FuturiaState",
      "Write-Output $s.Migration",
      "Write-Output $s.Config.location",
    ].join("; "));
    assert.equal(broken.status, failure.exit, `${failure.name}: ${broken.stderr}`);
    assert.deepEqual(lines(broken.stdout), failure.out, failure.name);
    if (failure.name === "errore") assert.match(flat(broken.stderr), /\[futuria-crm:copia-rimandata\]/);
    // Nella cartella nuova c’è soltanto la chiave.
    assert.deepEqual(Object.keys(snapshot(state.windows.stateDir).entries), ["credential.xml"], failure.name);

    // La chiamata successiva completa la copia invece di chiedere di ricollegare.
    const status = windowsStatus(state);
    assert.equal(status.status, 0, `${failure.name}: ${status.stdout}${status.stderr}`);
    assert.deepEqual(lines(status.stdout), [
      "Chiave privata protetta: presente",
      "ID account: presente",
      "Configurazione della versione precedente copiata nella nuova cartella.",
    ], failure.name);
    const copied = classifyLegacyConfig(readFileSync(newFiles(state).config), { platform: "win32" });
    assert.equal(copied.location, DEMO_ID);
    assert.equal(copied.updated_at, "2026-10-14T09:12:33.1234567Z");
    assert.deepEqual(lines(windowsStatus(state).stdout), ["Chiave privata protetta: presente", "ID account: presente"]);
    assert.deepEqual(listTemps(state.windows.stateDir), []);
    assert.deepEqual(snapshot(state.windows.legacyDir), before);
  }
});

test("Windows: uno Status durante la copia di un altro processo non chiede di ricollegare", { skip: !isWindows }, async (t) => {
  const state = windowsState(t);
  const legacy = legacyFiles(state);
  writeCredentialFixture(state, legacy.credential);
  writeFileSync(legacy.config, SKILL_CONFIG_WINDOWS);
  const before = snapshot(state.windows.legacyDir);

  // Il primo processo si ferma 4 secondi tra lo spostamento della chiave e
  // quello della configurazione: la finestra resa larga apposta.
  const slow = spawn(
    POWERSHELL,
    [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
      [
        ". $env:FUTURIA_TEST_STATE_SCRIPT",
        brokenSetContent("Start-Sleep -Seconds 4; Microsoft.PowerShell.Management\\Set-Content -LiteralPath $LiteralPath -Value $Value -Encoding $Encoding -NoNewline:$NoNewline -ErrorAction Stop"),
        "$s = Resolve-FuturiaState",
        "Write-Output $s.Migration",
        "Write-Output $s.Config.location",
      ].join("; "),
    ],
    { env: { ...state.env, FUTURIA_TEST_STATE_SCRIPT: join(SCRIPTS_DIR, "state-dir.ps1") }, windowsHide: true },
  );
  t.after(() => { try { slow.kill(); } catch { /* già chiuso */ } });
  let slowOut = "";
  slow.stdout.on("data", (chunk) => { slowOut += chunk; });
  const closed = once(slow, "close");
  const deadline = Date.now() + 30000;
  while (!existsSync(newFiles(state).credential) && Date.now() < deadline) await sleep(50);
  assert.ok(existsSync(newFiles(state).credential), "la chiave copiata dal primo processo");
  assert.equal(existsSync(newFiles(state).config), false, "configurazione non ancora copiata");

  const status = windowsStatus(state);
  assert.equal(status.status, 0, status.stdout + status.stderr);
  assert.deepEqual(lines(status.stdout), [
    "Chiave privata protetta: presente",
    "ID account: presente",
    "Configurazione della versione precedente copiata nella nuova cartella.",
  ]);

  const [code] = await closed;
  assert.equal(code, 0);
  // Il primo processo trova la configurazione già al suo posto e la accetta.
  assert.deepEqual(lines(slowOut), ["copied", DEMO_ID]);
  assert.deepEqual(Object.keys(snapshot(state.windows.stateDir).entries), ["config.json", "credential.xml"]);
  assert.deepEqual(lines(windowsStatus(state).stdout), ["Chiave privata protetta: presente", "ID account: presente"]);
  assert.deepEqual(snapshot(state.windows.legacyDir), before);
});

test("Windows: se la cartella nuova non si può creare legge in sola lettura la versione precedente", { skip: !isWindows }, (t) => {
  const state = windowsState(t);
  const legacy = legacyFiles(state);
  writeCredentialFixture(state, legacy.credential);
  writeFileSync(legacy.config, SKILL_CONFIG_WINDOWS);
  // Un file con il nome della cartella: la creazione fallisce come in una sandbox.
  writeFileSync(state.windows.stateDir, "");
  const before = snapshot(state.windows.legacyDir);

  const status = windowsStatus(state);
  assert.equal(status.status, 0, status.stdout + status.stderr);
  assert.deepEqual(lines(status.stdout), [
    "Chiave privata protetta: presente",
    "ID account: presente",
    "Configurazione letta in sola lettura dalla cartella della versione precedente: la copia nella nuova cartella e' rimandata.",
  ]);
  assert.match(flat(status.stderr), /\[futuria-crm:copia-rimandata\]/);
  assert.equal(statSync(state.windows.stateDir).isFile(), true);
  assert.deepEqual(snapshot(state.windows.legacyDir), before);

  const location = runPowerShellCommand(
    state,
    ". $env:FUTURIA_TEST_STATE_SCRIPT; $s = Resolve-FuturiaState 2>$null; Write-Output $s.Config.location; Write-Output $s.CredentialState",
  );
  assert.deepEqual(lines(location.stdout), [DEMO_ID, "presente"]);
});

test("Windows: -FromStdin scrive solo nella cartella nuova e sostituisce un collegamento precedente", { skip: !isWindows }, (t) => {
  const state = windowsState(t);
  const legacy = legacyFiles(state);
  writeCredentialFixture(state, legacy.credential);
  writeFileSync(legacy.config, APP_STORE_TEXT);
  const before = snapshot(state.windows.legacyDir);

  for (const [id, key] of [[DEMO_ID, FAKE_PIT], ["secondAccount98765", "pit-preview-second-1234567890"]]) {
    const store = runPowerShellFile(state, "setup-credentials.ps1", ["-FromStdin"], { input: `${id}\n${key}\n` });
    assert.equal(store.status, 0, store.stderr);
    assert.equal(store.stdout.includes(key), false);
  }
  const status = windowsStatus(state);
  assert.equal(status.status, 0, status.stdout);
  assert.deepEqual(lines(status.stdout), ["Chiave privata protetta: presente", "ID account: presente"]);
  assert.equal(classifyLegacyConfig(readFileSync(newFiles(state).config), { platform: "win32" }).location, "secondAccount98765");
  const read = runPowerShellCommand(
    state,
    "$c = Import-Clixml -LiteralPath $env:FUTURIA_TEST_PATH; Write-Output ($c.GetNetworkCredential().Password -ceq $env:FUTURIA_TEST_PIT)",
    { FUTURIA_TEST_PATH: newFiles(state).credential, FUTURIA_TEST_PIT: "pit-preview-second-1234567890" },
  );
  assert.deepEqual(lines(read.stdout), ["True"]);
  assert.deepEqual(listTemps(state.windows.stateDir), []);
  assert.deepEqual(snapshot(state.windows.legacyDir), before);
});

test("Windows: -Remove toglie solo i file della skill e mai lo store dell’app", { skip: !isWindows }, (t) => {
  const state = windowsState(t);
  const legacy = legacyFiles(state);
  writeCredentialFixture(state, legacy.credential);
  writeFileSync(legacy.config, APP_STORE_TEXT);
  writeFileSync(join(state.windows.legacyDir, "Preferences"), "{}");
  assert.equal(windowsStatus(state).status, 1);
  assert.ok(existsSync(newFiles(state).credential));
  const appStore = snapshot(state.windows.legacyDir).entries["config.json"];

  for (let round = 0; round < 2; round += 1) {
    const removal = runPowerShellFile(state, "setup-credentials.ps1", ["-Remove"]);
    assert.equal(removal.status, 0, removal.stdout + removal.stderr);
    assert.deepEqual(lines(removal.stdout), [
      "Credenziali locali Futuria CRM rimosse. La chiave privata remota non e' stata revocata.",
    ]);
  }
  assert.equal(existsSync(state.windows.stateDir), false);
  assert.equal(existsSync(legacy.credential), false);
  assert.ok(existsSync(state.windows.legacyDir), "la cartella dell’app resta");
  const after = snapshot(state.windows.legacyDir);
  assert.deepEqual(Object.keys(after.entries), ["Preferences", "config.json"]);
  assert.deepEqual(after.entries["config.json"], appStore);
});

test("Windows: -Remove toglie il vecchio config della skill solo con l’app desktop chiusa", { skip: !isWindows }, async (t) => {
  const appRunning = spawnSync(POWERSHELL, ["-NoProfile", "-Command", "if (Get-Process -Name 'Futuria CRM' -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"], { windowsHide: true }).status === 0;
  const state = windowsState(t);
  const legacy = legacyFiles(state);
  mkdirSync(state.windows.legacyDir, { recursive: true });

  writeFileSync(legacy.config, SKILL_CONFIG_WINDOWS);
  const first = runPowerShellFile(state, "setup-credentials.ps1", ["-Remove"]);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  if (appRunning) {
    t.diagnostic("app desktop in esecuzione su questo computer: si verifica solo che il file resti");
    assert.ok(existsSync(legacy.config));
  } else {
    assert.equal(existsSync(legacy.config), false);
  }

  // Processo finto con il nome dell’app desktop.
  writeFileSync(legacy.config, SKILL_CONFIG_WINDOWS);
  const fakeApp = join(state.root, "Futuria CRM.exe");
  copyFileSync(join(process.env.SystemRoot || "C:\\Windows", "System32", "PING.EXE"), fakeApp);
  const app = spawn(fakeApp, ["-n", "60", "127.0.0.1"], { stdio: "ignore", windowsHide: true });
  t.after(() => { try { app.kill(); } catch { /* già chiuso */ } });
  await sleep(500);
  const kept = runPowerShellFile(state, "setup-credentials.ps1", ["-Remove"]);
  app.kill();
  await once(app, "exit");
  assert.equal(kept.status, 0, kept.stdout + kept.stderr);
  assert.ok(existsSync(legacy.config));
  assert.match(kept.stdout, /Chiudi l'app desktop Futuria CRM e ripeti la rimozione/);
});

// Processo finto con il nome dell’app desktop, per tutta la durata del test.
async function startFakeDesktopApp(t, state) {
  const fakeApp = join(state.root, "Futuria CRM.exe");
  copyFileSync(join(process.env.SystemRoot || "C:\\Windows", "System32", "PING.EXE"), fakeApp);
  const app = spawn(fakeApp, ["-n", "60", "127.0.0.1"], { stdio: "ignore", windowsHide: true });
  t.after(() => { try { app.kill(); } catch { /* già chiuso */ } });
  await sleep(500);
  return async () => {
    app.kill();
    await once(app, "exit");
  };
}

// Un altro processo tiene aperto il file (in sola lettura, senza permettere la
// cancellazione) finché la funzione restituita non lo chiude.
async function holdFile(t, state, path, share = "Read") {
  const holder = spawn(
    POWERSHELL,
    [
      "-NoProfile", "-NonInteractive", "-Command",
      "$f = [System.IO.File]::Open($env:FUTURIA_TEST_PATH, 'Open', 'Read', $env:FUTURIA_TEST_SHARE); Write-Output pronto; Start-Sleep -Seconds 60",
    ],
    { env: { ...state.env, FUTURIA_TEST_PATH: path, FUTURIA_TEST_SHARE: share }, windowsHide: true },
  );
  t.after(() => { try { holder.kill(); } catch { /* già chiuso */ } });
  let out = "";
  holder.stdout.on("data", (chunk) => { out += chunk; });
  const deadline = Date.now() + 30000;
  while (!out.includes("pronto") && Date.now() < deadline) await sleep(50);
  assert.ok(out.includes("pronto"), "file tenuto aperto da un altro processo");
  return async () => {
    holder.kill();
    await once(holder, "exit");
  };
}

test("Windows: dopo la rimozione con l’app desktop aperta la vecchia copia dell’ID non torna", { skip: !isWindows }, async (t) => {
  const state = windowsState(t);
  const legacy = legacyFiles(state);
  writeCredentialFixture(state, legacy.credential);
  writeFileSync(legacy.config, SKILL_CONFIG_WINDOWS);
  assert.equal(windowsStatus(state).status, 0);

  const stopApp = await startFakeDesktopApp(t, state);
  const removal = runPowerShellFile(state, "setup-credentials.ps1", ["-Remove"]);
  await stopApp();
  assert.equal(removal.status, 0, removal.stdout + removal.stderr);
  assert.match(removal.stdout, /Chiudi l'app desktop Futuria CRM e ripeti la rimozione/);
  assert.equal(existsSync(state.windows.stateDir), false);
  assert.equal(existsSync(legacy.credential), false);
  assert.ok(existsSync(legacy.config), "la vecchia copia dell’ID resta finché l’app è aperta");

  // Senza la vecchia chiave la vecchia copia dell’ID non viene ricopiata.
  for (let round = 0; round < 2; round += 1) {
    const status = windowsStatus(state);
    assert.equal(status.status, 1);
    assert.deepEqual(lines(status.stdout), ["Chiave privata protetta: mancante", "ID account: mancante"]);
    assert.equal(existsSync(state.windows.stateDir), false);
  }
});

test("Windows: se la vecchia chiave non si può cancellare la rimozione è incompleta e non cambia nulla", { skip: !isWindows }, async (t) => {
  const state = windowsState(t);
  const legacy = legacyFiles(state);
  writeCredentialFixture(state, legacy.credential);
  writeFileSync(legacy.config, SKILL_CONFIG_WINDOWS);
  assert.equal(windowsStatus(state).status, 0);
  const newBefore = snapshot(state.windows.stateDir);

  const release = await holdFile(t, state, legacy.credential);
  const removal = runPowerShellFile(state, "setup-credentials.ps1", ["-Remove"]);
  await release();
  assert.equal(removal.status, 1, removal.stdout + removal.stderr);
  assert.deepEqual(lines(removal.stdout), [
    "[futuria-crm:rimozione-incompleta] Non e' stato possibile rimuovere tutti i file locali Futuria CRM: chiudi i programmi che li usano e ripeti la rimozione.",
  ]);
  assert.ok(existsSync(legacy.credential));
  // La cartella nuova resta com’era: lo stato non cambia finché non si ripete.
  assert.deepEqual(snapshot(state.windows.stateDir), newBefore);
  assert.deepEqual(lines(windowsStatus(state).stdout), ["Chiave privata protetta: presente", "ID account: presente"]);

  const again = runPowerShellFile(state, "setup-credentials.ps1", ["-Remove"]);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.equal(existsSync(legacy.credential), false);
  assert.equal(existsSync(state.windows.stateDir), false);
  const status = windowsStatus(state);
  assert.equal(status.status, 1);
  assert.deepEqual(lines(status.stdout), ["Chiave privata protetta: mancante", "ID account: mancante"]);
  assert.equal(existsSync(state.windows.stateDir), false);
});

test("Windows: un ricollegamento interrotto non lascia la chiave nuova con l’ID di prima", { skip: !isWindows }, async (t) => {
  const state = windowsState(t);
  const first = runPowerShellFile(state, "setup-credentials.ps1", ["-FromStdin"], { input: `${DEMO_ID}\n${FAKE_PIT}\n` });
  assert.equal(first.status, 0, first.stderr);
  const keyIs = (pit) => lines(runPowerShellCommand(
    state,
    "$c = Import-Clixml -LiteralPath $env:FUTURIA_TEST_PATH; Write-Output ($c.GetNetworkCredential().Password -ceq $env:FUTURIA_TEST_PIT)",
    { FUTURIA_TEST_PATH: newFiles(state).credential, FUTURIA_TEST_PIT: pit },
  ).stdout);
  const locationNow = () => classifyLegacyConfig(readFileSync(newFiles(state).config), { platform: "win32" })?.location;

  // L’ID precedente non si può togliere (un altro processo lo tiene aperto):
  // il salvataggio si ferma prima di toccare la chiave.
  const secondKey = "pit-preview-second-1234567890";
  const release = await holdFile(t, state, newFiles(state).config);
  const blocked = runPowerShellFile(state, "setup-credentials.ps1", ["-FromStdin"], { input: `secondAccount98765\n${secondKey}\n` });
  await release();
  assert.notEqual(blocked.status, 0);
  assert.equal((blocked.stdout + blocked.stderr).includes(secondKey), false);
  const status = windowsStatus(state);
  assert.equal(status.status, 0, status.stdout);
  assert.equal(locationNow(), DEMO_ID);
  assert.deepEqual(keyIs(FAKE_PIT), ["True"]);
  assert.deepEqual(listTemps(state.windows.stateDir), []);

  // Senza blocchi il ricollegamento riesce e sostituisce entrambi.
  const second = runPowerShellFile(state, "setup-credentials.ps1", ["-FromStdin"], { input: `secondAccount98765\n${secondKey}\n` });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(locationNow(), "secondAccount98765");
  assert.deepEqual(keyIs(secondKey), ["True"]);
});

test("Windows: crm-api.ps1 distingue i casi senza fare richieste", { skip: !isWindows }, (t) => {
  const call = (state) => {
    const result = runPowerShellFile(state, "crm-api.ps1", ["-Method", "GET", "-Path", "/locations/{location}"]);
    assert.notEqual(result.status, 0);
    assert.equal((result.stdout + result.stderr).includes(FAKE_PIT), false);
    return flat(result.stderr);
  };

  const empty = windowsState(t);
  assert.match(call(empty), /\[futuria-crm:credenziali-mancanti\] Credenziali Futuria CRM mancanti\. Avvia il configuratore con launch-credential-setup\.ps1\./);

  const onlyKey = windowsState(t);
  writeCredentialFixture(onlyKey, newFiles(onlyKey).credential);
  assert.match(call(onlyKey), /\[futuria-crm:id-mancante\] Configurazione Futuria CRM incompleta: chiave privata presente, ID account mancante\. Riapri il configuratore con launch-credential-setup\.ps1 e ricollega l'account\./);

  const onlyId = windowsState(t);
  mkdirSync(onlyId.windows.stateDir, { recursive: true });
  writeFileSync(newFiles(onlyId).config, SKILL_CONFIG_WINDOWS);
  assert.match(call(onlyId), /\[futuria-crm:chiave-mancante\] Configurazione Futuria CRM incompleta: ID account presente, chiave privata mancante\. Riapri il configuratore con launch-credential-setup\.ps1\./);

  const unreadable = windowsState(t);
  mkdirSync(unreadable.windows.stateDir, { recursive: true });
  writeFileSync(newFiles(unreadable).credential, "<Objs><non-valido");
  writeFileSync(newFiles(unreadable).config, SKILL_CONFIG_WINDOWS);
  assert.match(call(unreadable), /\[futuria-crm:chiave-non-leggibile\] Chiave privata presente ma non leggibile per questo utente Windows/);
  const status = windowsStatus(unreadable);
  assert.equal(status.status, 1);
  assert.match(status.stdout, /Chiave privata protetta: non leggibile/);
});

test("Windows: USERPROFILE non valido ferma con un messaggio chiaro, APPDATA non valido salta la copia", { skip: !isWindows }, (t) => {
  const state = windowsState(t);
  const invalid = runPowerShellFile(state, "setup-credentials.ps1", ["-Status"], { env: { USERPROFILE: "relativo" } });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stdout, /\[futuria-crm:cartella-non-valida\]/);

  writeCredentialFixture(state, legacyFiles(state).credential);
  const noLegacy = runPowerShellFile(state, "setup-credentials.ps1", ["-Status"], { env: { APPDATA: "C:relativo" } });
  assert.equal(noLegacy.status, 1);
  assert.deepEqual(lines(noLegacy.stdout), ["Chiave privata protetta: mancante", "ID account: mancante"]);
  assert.equal(existsSync(state.windows.stateDir), false);
});

test("Windows: stato, copia e chiave funzionano in Constrained Language Mode", { skip: !isWindows }, (t) => {
  const state = windowsState(t);
  const legacy = legacyFiles(state);
  writeCredentialFixture(state, legacy.credential);
  writeFileSync(legacy.config, SKILL_CONFIG_WINDOWS);
  const result = runPowerShellCommand(
    state,
    [
      "$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'",
      ". $env:FUTURIA_TEST_STATE_SCRIPT",
      "$s = Resolve-FuturiaState",
      "Write-Output $ExecutionContext.SessionState.LanguageMode",
      "Write-Output $s.Migration",
      "Write-Output $s.CredentialState",
      "Write-Output $s.Config.location",
      "Write-Output ($s.Credential.GetNetworkCredential().Password -ceq $env:FUTURIA_TEST_PIT)",
      "& $env:FUTURIA_TEST_SETUP -Status",
      "Write-Output \"exit=$LASTEXITCODE\"",
      // Copia rimasta a metà: la configurazione si completa anche qui.
      "Remove-Item -LiteralPath $s.Paths.ConfigPath",
      "$r = Resolve-FuturiaState",
      "Write-Output $r.Migration",
      "Write-Output $r.Config.location",
    ].join("; "),
    { FUTURIA_TEST_PIT: FAKE_PIT, FUTURIA_TEST_SETUP: join(SCRIPTS_DIR, "setup-credentials.ps1") },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(lines(result.stdout), [
    "ConstrainedLanguage",
    "copied",
    "presente",
    DEMO_ID,
    "True",
    "Chiave privata protetta: presente",
    "ID account: presente",
    "exit=0",
    "copied",
    DEMO_ID,
  ]);
  assert.deepEqual(listTemps(state.windows.stateDir), []);
});

test("Windows: quattro Status in parallelo al primo avvio riescono tutti senza errori", { skip: !isWindows }, async (t) => {
  const state = windowsState(t);
  const legacy = legacyFiles(state);
  writeCredentialFixture(state, legacy.credential);
  writeFileSync(legacy.config, SKILL_CONFIG_WINDOWS);
  const before = snapshot(state.windows.legacyDir);

  const runs = await Promise.all([0, 1, 2, 3].map(() => new Promise((resolve) => {
    const child = spawn(
      POWERSHELL,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(SCRIPTS_DIR, "setup-credentials.ps1"), "-Status"],
      { env: state.env, windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  })));
  for (const run of runs) {
    assert.equal(run.code, 0, run.stdout + run.stderr);
    assert.equal(run.stderr.trim(), "");
    assert.match(run.stdout, /Chiave privata protetta: presente/);
    assert.match(run.stdout, /ID account: presente/);
  }
  assert.deepEqual(Object.keys(snapshot(state.windows.stateDir).entries), ["config.json", "credential.xml"]);
  assert.equal(windowsStatus(state).status, 0);
  assert.deepEqual(snapshot(state.windows.legacyDir), before);
});

test("Windows: i temporanei propri più vecchi di 10 minuti vengono rimossi", { skip: !isWindows }, (t) => {
  const state = windowsState(t);
  writeCredentialFixture(state, newFiles(state).credential);
  const stale = join(state.windows.stateDir, ".config-0123456789abcdef.tmp");
  const fresh = join(state.windows.stateDir, ".credential-fedcba9876543210.tmp");
  const foreign = join(state.windows.stateDir, ".config-non-nostro.tmp");
  for (const path of [stale, fresh, foreign]) writeFileSync(path, "");
  const old = new Date(Date.now() - 20 * 60 * 1000);
  utimesSync(stale, old, old);
  utimesSync(foreign, old, old);
  windowsStatus(state);
  assert.equal(existsSync(stale), false);
  assert.equal(existsSync(fresh), true);
  assert.equal(existsSync(foreign), true);
});

test("Git Bash su Windows indica di usare PowerShell", { skip: !isWindows || !bashAvailable }, (t) => {
  const state = createIsolatedState(t);
  const tools = createFakeTools(state);
  for (const [script, args] of [["crm-api.sh", ["GET", "/locations/{location}"]], ["setup-credentials.sh", ["status"]]]) {
    const result = runBash(state, tools, [toBashPath(join(SCRIPTS_DIR, script)), ...args], { env: { FAKE_UNAME: "MINGW64_NT-10.0-26100" } });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /\[futuria-crm:usa-powershell\] Su Windows usa scripts\\crm-api\.ps1 \(o setup-credentials\.ps1\) con PowerShell\./);
  }
  assert.equal(existsSync(state.windows.stateDir), false);
});

// ---------------------------------------------------------------------------
// macOS: state-dir.sh, setup-credentials.sh e crm-api.sh con strumenti finti
// ---------------------------------------------------------------------------

function macStatus(state, tools, env = {}) {
  const result = runBash(state, tools, [toBashPath(join(SCRIPTS_DIR, "setup-credentials.sh")), "status"], { env });
  assert.doesNotMatch(result.stdout + result.stderr, /pit-preview|valore-fittizio/);
  return result;
}

function macApi(state, tools, env = {}) {
  const result = runBash(state, tools, [toBashPath(join(SCRIPTS_DIR, "crm-api.sh")), "GET", "/locations/{location}"], { env });
  assert.doesNotMatch(result.stdout + result.stderr, /pit-preview|valore-fittizio/);
  return result;
}

function toolLog(tools) {
  return readFileSync(tools.log, "utf8");
}

test("macOS: lo store dell’app nella vecchia cartella resta intatto e non nasce nessuna cartella", { skip: !bashAvailable }, (t) => {
  const state = createIsolatedState(t);
  const tools = createFakeTools(state);
  mkdirSync(state.mac.legacyDir, { recursive: true });
  writeFileSync(join(state.mac.legacyDir, "config.json"), APP_STORE_TEXT);
  const before = snapshot(state.mac.legacyDir);
  const status = macStatus(state, tools, { FAKE_SECURITY_FIND_RC: "0" });
  assert.equal(status.status, 1, status.stderr);
  assert.deepEqual(lines(status.stdout), [
    "Chiave privata protetta: presente",
    "ID account: mancante",
    "Serve ricollegare l'account: apri di nuovo il configuratore.",
  ]);
  assert.equal(existsSync(state.mac.stateDir), false);
  assert.deepEqual(snapshot(state.mac.legacyDir), before);
});

test("macOS: il vecchio formato della skill viene copiato, il resto resta com’è", { skip: !bashAvailable }, (t) => {
  const state = createIsolatedState(t);
  const tools = createFakeTools(state);
  mkdirSync(state.mac.legacyDir, { recursive: true });
  const legacyConfig = join(state.mac.legacyDir, "config.json");
  writeFileSync(legacyConfig, SKILL_CONFIG_MAC);
  const before = snapshot(state.mac.legacyDir);

  const first = macStatus(state, tools, { FAKE_SECURITY_FIND_RC: "0" });
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.deepEqual(lines(first.stdout), [
    "Chiave privata protetta: presente",
    "ID account: presente",
    "Configurazione della versione precedente copiata nella nuova cartella.",
  ]);
  const copied = readFileSync(join(state.mac.stateDir, "config.json"));
  assert.equal(classifyLegacyConfig(copied, { platform: "darwin" })?.location, DEMO_ID);
  assert.deepEqual(listTemps(state.mac.stateDir), []);
  assert.deepEqual(snapshot(state.mac.legacyDir), before);
  if (process.platform !== "win32") {
    assert.equal(statSync(state.mac.stateDir).mode & 0o777, 0o700);
    assert.equal(statSync(join(state.mac.stateDir, "config.json")).mode & 0o777, 0o600);
  }

  // Seconda esecuzione: nessuna modifica.
  const afterCopy = snapshot(state.mac.stateDir);
  const second = macStatus(state, tools, { FAKE_SECURITY_FIND_RC: "0" });
  assert.equal(second.status, 0);
  assert.deepEqual(lines(second.stdout), ["Chiave privata protetta: presente", "ID account: presente"]);
  assert.deepEqual(snapshot(state.mac.stateDir), afterCopy);
  assert.deepEqual(snapshot(state.mac.legacyDir), before);

  // Un’installazione non aggiornata riscrive la vecchia configurazione.
  const future = new Date(Date.now() + 3600 * 1000);
  utimesSync(legacyConfig, future, future);
  const warned = macStatus(state, tools, { FAKE_SECURITY_FIND_RC: "0" });
  assert.match(warned.stdout, /Un'altra installazione del plugin non aggiornata usa ancora la vecchia cartella: aggiornala\./);
});

test("macOS: file misto intatto, ID mancante; cartella nuova completa non tocca la vecchia", { skip: !bashAvailable }, (t) => {
  const mixedState = createIsolatedState(t);
  const tools = createFakeTools(mixedState);
  mkdirSync(mixedState.mac.legacyDir, { recursive: true });
  writeFileSync(
    join(mixedState.mac.legacyDir, "config.json"),
    JSON.stringify({ deviceId: "device-fittizio-0001", location: DEMO_ID, storage: "macos-keychain" }, null, 2),
  );
  const mixedBefore = snapshot(mixedState.mac.legacyDir);
  const mixed = macStatus(mixedState, tools, { FAKE_SECURITY_FIND_RC: "0" });
  assert.equal(mixed.status, 1);
  assert.match(mixed.stdout, /ID account: mancante/);
  assert.deepEqual(snapshot(mixedState.mac.legacyDir), mixedBefore);
  assert.equal(existsSync(mixedState.mac.stateDir), false);

  const completeState = createIsolatedState(t);
  const completeTools = createFakeTools(completeState);
  mkdirSync(completeState.mac.legacyDir, { recursive: true });
  writeFileSync(join(completeState.mac.legacyDir, "config.json"), SKILL_CONFIG_MAC);
  mkdirSync(completeState.mac.stateDir, { recursive: true });
  writeFileSync(join(completeState.mac.stateDir, "config.json"), SKILL_CONFIG_MAC.replace(DEMO_ID, "newerAccount12345"));
  const legacyBefore = snapshot(completeState.mac.legacyDir);
  const newBefore = snapshot(completeState.mac.stateDir);
  const complete = macStatus(completeState, completeTools, { FAKE_SECURITY_FIND_RC: "0" });
  assert.equal(complete.status, 0);
  assert.deepEqual(snapshot(completeState.mac.legacyDir), legacyBefore);
  assert.deepEqual(snapshot(completeState.mac.stateDir), newBefore);
});

test("macOS: se la cartella nuova non si può creare legge in sola lettura la versione precedente", { skip: !bashAvailable }, (t) => {
  const state = createIsolatedState(t);
  const tools = createFakeTools(state);
  mkdirSync(state.mac.legacyDir, { recursive: true });
  writeFileSync(join(state.mac.legacyDir, "config.json"), SKILL_CONFIG_MAC);
  writeFileSync(state.mac.stateDir, "");
  const before = snapshot(state.mac.legacyDir);
  const status = macStatus(state, tools, { FAKE_SECURITY_FIND_RC: "0" });
  assert.equal(status.status, 0, status.stdout + status.stderr);
  assert.deepEqual(lines(status.stdout), [
    "Chiave privata protetta: presente",
    "ID account: presente",
    "Configurazione letta in sola lettura dalla cartella della versione precedente: la copia nella nuova cartella e' rimandata.",
  ]);
  assert.match(status.stderr, /\[futuria-crm:copia-rimandata\]/);
  assert.equal(statSync(state.mac.stateDir).isFile(), true);
  assert.deepEqual(snapshot(state.mac.legacyDir), before);
});

test("macOS: stato del Portachiavi mancante o non accessibile", { skip: !bashAvailable }, (t) => {
  const state = createIsolatedState(t);
  const tools = createFakeTools(state);
  mkdirSync(state.mac.stateDir, { recursive: true });
  writeFileSync(join(state.mac.stateDir, "config.json"), SKILL_CONFIG_MAC);
  const missing = macStatus(state, tools, { FAKE_SECURITY_FIND_RC: "44" });
  assert.equal(missing.status, 1);
  assert.deepEqual(lines(missing.stdout), ["Chiave privata protetta: mancante", "ID account: presente"]);
  const locked = macStatus(state, tools, { FAKE_SECURITY_FIND_RC: "36" });
  assert.equal(locked.status, 1);
  assert.deepEqual(lines(locked.stdout), [
    "Chiave privata protetta: non accessibile",
    "ID account: presente",
    "Portachiavi non accessibile da questo processo: sbloccalo o esegui il comando fuori dalla sandbox.",
  ]);
});

test("macOS: crm-api.sh distingue i casi senza rete", { skip: !bashAvailable }, (t) => {
  const cases = [
    { name: "nulla", config: false, rc: "44", code: /\[futuria-crm:credenziali-mancanti\] Credenziali Futuria CRM mancanti\. Avvia il configuratore con launch-credential-setup\.sh\./ },
    { name: "solo chiave", config: false, rc: "0", code: /\[futuria-crm:id-mancante\] Configurazione Futuria CRM incompleta: chiave privata presente, ID account mancante\. Riapri il configuratore con launch-credential-setup\.sh e ricollega l'account\./ },
    { name: "solo ID", config: true, rc: "44", code: /\[futuria-crm:chiave-mancante\] Configurazione Futuria CRM incompleta: ID account presente, chiave privata mancante\. Riapri il configuratore con launch-credential-setup\.sh\./ },
    { name: "Portachiavi bloccato", config: true, rc: "36", code: /\[futuria-crm:portachiavi-non-accessibile\] Portachiavi non accessibile da questo processo/ },
  ];
  for (const item of cases) {
    const state = createIsolatedState(t);
    const tools = createFakeTools(state);
    if (item.config) {
      mkdirSync(state.mac.stateDir, { recursive: true });
      writeFileSync(join(state.mac.stateDir, "config.json"), SKILL_CONFIG_MAC);
    }
    const result = macApi(state, tools, { FAKE_SECURITY_FIND_RC: item.rc });
    assert.equal(result.status, 3, `${item.name}: ${result.stderr}`);
    assert.match(result.stderr, item.code, item.name);
    assert.doesNotMatch(toolLog(tools), /curl/, `${item.name}: nessuna richiesta`);
  }
});

test("Linux: crm-api.sh usa solo le variabili d’ambiente e non tocca file", { skip: !bashAvailable }, (t) => {
  const state = createIsolatedState(t);
  const tools = createFakeTools(state);
  mkdirSync(state.mac.legacyDir, { recursive: true });
  writeFileSync(join(state.mac.legacyDir, "config.json"), SKILL_CONFIG_MAC);
  const before = snapshot(state.mac.legacyDir);
  const result = macApi(state, tools, { FAKE_UNAME: "Linux", FAKE_SECURITY_FIND_RC: "0" });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /\[futuria-crm:credenziali-mancanti\] Credenziali Futuria CRM mancanti\. Su Linux imposta FUTURIA_CRM_TOKEN e FUTURIA_CRM_LOCATION/);
  assert.equal(toolLog(tools), "", "né Portachiavi né rete");
  assert.equal(existsSync(state.mac.stateDir), false);
  assert.deepEqual(snapshot(state.mac.legacyDir), before);
});

test("macOS: remove toglie solo i file della skill e lascia lo store dell’app", { skip: !bashAvailable }, (t) => {
  const state = createIsolatedState(t);
  const tools = createFakeTools(state);
  mkdirSync(state.mac.legacyDir, { recursive: true });
  mkdirSync(state.mac.stateDir, { recursive: true });
  writeFileSync(join(state.mac.stateDir, "config.json"), SKILL_CONFIG_MAC);
  writeFileSync(join(state.mac.stateDir, ".config-00112233445566ff.tmp"), "");
  writeFileSync(join(state.mac.legacyDir, "config.json"), APP_STORE_TEXT);
  // Temporanei lasciati dal configuratore 1.3.x nella vecchia cartella.
  writeFileSync(join(state.mac.legacyDir, ".config-0123456789abcdef.tmp"), SKILL_CONFIG_MAC);
  writeFileSync(join(state.mac.legacyDir, ".config-1111111111111111.tmp"), "");
  writeFileSync(join(state.mac.legacyDir, ".config-2222222222222222.tmp"), '{"location": "demoAcc');
  writeFileSync(join(state.mac.legacyDir, ".config-non-nostro.tmp"), "");
  const appStore = snapshot(state.mac.legacyDir).entries["config.json"];

  for (let round = 0; round < 2; round += 1) {
    const removal = runBash(state, tools, [toBashPath(join(SCRIPTS_DIR, "setup-credentials.sh")), "remove"]);
    assert.equal(removal.status, 0, removal.stdout + removal.stderr);
    assert.deepEqual(lines(removal.stdout), [
      "Credenziali locali Futuria CRM rimosse. La chiave privata remota non e' stata revocata.",
    ]);
  }
  assert.equal(existsSync(state.mac.stateDir), false);
  const after = snapshot(state.mac.legacyDir);
  assert.deepEqual(Object.keys(after.entries), [".config-2222222222222222.tmp", ".config-non-nostro.tmp", "config.json"]);
  assert.deepEqual(after.entries["config.json"], appStore);
  assert.match(toolLog(tools), /delete-generic-password/);
});

test("macOS: remove toglie il vecchio config della skill solo con l’app desktop chiusa", { skip: !bashAvailable }, (t) => {
  const state = createIsolatedState(t);
  const tools = createFakeTools(state);
  mkdirSync(state.mac.legacyDir, { recursive: true });
  const legacyConfig = join(state.mac.legacyDir, "config.json");

  writeFileSync(legacyConfig, SKILL_CONFIG_MAC);
  const open = runBash(state, tools, [toBashPath(join(SCRIPTS_DIR, "setup-credentials.sh")), "remove"], { env: { FAKE_PGREP_RC: "0" } });
  assert.equal(open.status, 0);
  assert.ok(existsSync(legacyConfig));
  assert.match(open.stdout, /Chiudi l'app desktop Futuria CRM e ripeti la rimozione/);
  assert.match(toolLog(tools), /pgrep -x Futuria CRM/);

  const closed = runBash(state, tools, [toBashPath(join(SCRIPTS_DIR, "setup-credentials.sh")), "remove"], { env: { FAKE_PGREP_RC: "1" } });
  assert.equal(closed.status, 0);
  assert.equal(existsSync(legacyConfig), false);
  assert.ok(existsSync(state.mac.legacyDir));
});

test("macOS: il collegamento nel terminale toglie l’ID precedente prima di salvare la chiave", { skip: !bashAvailable }, (t) => {
  const state = createIsolatedState(t);
  const tools = createFakeTools(state);
  mkdirSync(state.mac.stateDir, { recursive: true });
  const configPath = join(state.mac.stateDir, "config.json");
  const setup = (env) => {
    const result = runBash(state, tools, [toBashPath(join(SCRIPTS_DIR, "setup-credentials.sh"))], { env, input: "secondAccount98765\n" });
    assert.doesNotMatch(result.stdout + result.stderr, /pit-preview/);
    return result;
  };

  // Il Portachiavi non salva la chiave (finestra chiusa o Portachiavi
  // bloccato): resta al massimo la chiave precedente senza ID account.
  writeFileSync(configPath, SKILL_CONFIG_MAC);
  const failed = setup({ FAKE_SECURITY_ADD_RC: "1" });
  assert.notEqual(failed.status, 0);
  assert.equal(existsSync(configPath), false, failed.stdout + failed.stderr);
  assert.deepEqual(listTemps(state.mac.stateDir), []);

  // Il collegamento riuscito scrive il nuovo ID.
  writeFileSync(configPath, SKILL_CONFIG_MAC);
  const ok = setup({ FAKE_SECURITY_ADD_RC: "0", FAKE_SECURITY_FIND_RC: "0" });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(classifyLegacyConfig(readFileSync(configPath), { platform: "darwin" })?.location, "secondAccount98765");
  assert.deepEqual(listTemps(state.mac.stateDir), []);
});

test("macOS: dopo la rimozione con l’app desktop aperta la vecchia copia dell’ID non torna", { skip: !bashAvailable }, (t) => {
  const state = createIsolatedState(t);
  const tools = createFakeTools(state);
  mkdirSync(state.mac.legacyDir, { recursive: true });
  const legacyConfig = join(state.mac.legacyDir, "config.json");
  writeFileSync(legacyConfig, SKILL_CONFIG_MAC);
  assert.equal(macStatus(state, tools, { FAKE_SECURITY_FIND_RC: "0" }).status, 0);
  assert.ok(existsSync(join(state.mac.stateDir, "config.json")));

  const removal = runBash(state, tools, [toBashPath(join(SCRIPTS_DIR, "setup-credentials.sh")), "remove"], { env: { FAKE_PGREP_RC: "0" } });
  assert.equal(removal.status, 0, removal.stdout + removal.stderr);
  assert.match(removal.stdout, /Chiudi l'app desktop Futuria CRM e ripeti la rimozione/);
  assert.ok(existsSync(legacyConfig));
  assert.equal(existsSync(state.mac.stateDir), false);

  // La voce del Portachiavi non c’è più: la vecchia copia dell’ID resta dov’è.
  const status = macStatus(state, tools, { FAKE_SECURITY_FIND_RC: "44" });
  assert.equal(status.status, 1);
  assert.deepEqual(lines(status.stdout), ["Chiave privata protetta: mancante", "ID account: mancante"]);
  assert.equal(existsSync(state.mac.stateDir), false);
});

test("macOS: con il Portachiavi bloccato la rimozione è incompleta e non tocca i file", { skip: !bashAvailable }, (t) => {
  const state = createIsolatedState(t);
  const tools = createFakeTools(state);
  mkdirSync(state.mac.legacyDir, { recursive: true });
  mkdirSync(state.mac.stateDir, { recursive: true });
  writeFileSync(join(state.mac.legacyDir, "config.json"), SKILL_CONFIG_MAC);
  writeFileSync(join(state.mac.stateDir, "config.json"), SKILL_CONFIG_MAC);
  const legacyBefore = snapshot(state.mac.legacyDir);
  const newBefore = snapshot(state.mac.stateDir);
  const removal = runBash(state, tools, [toBashPath(join(SCRIPTS_DIR, "setup-credentials.sh")), "remove"], { env: { FAKE_SECURITY_DELETE_RC: "36", FAKE_PGREP_RC: "1" } });
  assert.equal(removal.status, 1, removal.stdout + removal.stderr);
  assert.deepEqual(lines(removal.stdout), [
    "[futuria-crm:rimozione-incompleta] Portachiavi non accessibile da questo processo: sbloccalo o esegui il comando fuori dalla sandbox, poi ripeti la rimozione.",
  ]);
  assert.deepEqual(snapshot(state.mac.stateDir), newBefore);
  assert.deepEqual(snapshot(state.mac.legacyDir), legacyBefore);
});

test("macOS: i temporanei propri più vecchi di 10 minuti vengono rimossi", { skip: !bashAvailable }, (t) => {
  const state = createIsolatedState(t);
  const tools = createFakeTools(state);
  mkdirSync(state.mac.stateDir, { recursive: true });
  writeFileSync(join(state.mac.stateDir, "config.json"), SKILL_CONFIG_MAC);
  const stale = join(state.mac.stateDir, ".config-0123456789abcdef.tmp");
  const fresh = join(state.mac.stateDir, ".config-fedcba9876543210.tmp");
  for (const path of [stale, fresh]) writeFileSync(path, "");
  const old = new Date(Date.now() - 20 * 60 * 1000);
  utimesSync(stale, old, old);
  macStatus(state, tools, { FAKE_SECURITY_FIND_RC: "0" });
  assert.equal(existsSync(stale), false);
  assert.equal(existsSync(fresh), true);
});
