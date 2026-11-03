// Ambiente isolato per i test della cartella di stato.
//
// Regola: nessun test tocca le cartelle reali dell’utente (né quella della
// skill né quella dell’app desktop Futuria CRM). Ogni processo figlio riceve
// un ambiente esplicito con APPDATA, LOCALAPPDATA, USERPROFILE e HOME dentro
// una cartella temporanea; prima di usarlo si controlla che le cartelle di
// stato calcolate stiano lì dentro e non coincidano con quelle reali.
// Il launcher non si usa mai fuori da -Preview: il processo creato via WMI
// riceverebbe l’ambiente reale del profilo, non quello del test.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  legacyStateDirectory,
  MAC_STATE_DIR_NAME,
  stateDirectory,
} from "../../skills/futuria-crm/scripts/credential-wizard.mjs";

const HELPERS_DIR = dirname(fileURLToPath(import.meta.url));
export const SCRIPTS_DIR = join(HELPERS_DIR, "..", "..", "skills", "futuria-crm", "scripts");
export const POWERSHELL = process.env.FUTURIA_TEST_POWERSHELL || "powershell.exe";
export const FAKE_PIT = "pit-preview-isolated-1234567890";

// Valori reali catturati all’avvio, solo per confrontarli.
const REAL = (() => {
  const values = {};
  for (const name of ["APPDATA", "LOCALAPPDATA", "USERPROFILE", "HOME"]) {
    const key = Object.keys(process.env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    values[name] = key === undefined ? undefined : process.env[key];
  }
  values.homedir = homedir();
  const dirs = [];
  for (const runtime of ["win32", "darwin"]) {
    for (const compute of [stateDirectory, legacyStateDirectory]) {
      try {
        const dir = compute({ platform: runtime, env: process.env, home: values.homedir });
        if (dir) dirs.push(dir);
      } catch {
        // Ambiente reale senza quel sistema: nulla da confrontare.
      }
    }
  }
  values.stateDirs = dirs;
  return values;
})();

function normalize(path) {
  let full = resolve(path);
  // Si risolvono i collegamenti della parte esistente (per esempio
  // /var → /private/var su macOS).
  let existing = full;
  let suffix = "";
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    suffix = suffix ? join(basename(existing), suffix) : basename(existing);
    existing = parent;
  }
  try {
    full = join(realpathSync.native(existing), suffix);
  } catch {
    // Percorso non risolvibile: resta quello calcolato.
  }
  return process.platform === "win32" ? full.toLowerCase() : full;
}

function isInside(child, parent) {
  const a = normalize(child);
  const b = normalize(parent);
  const separator = process.platform === "win32" ? "\\" : "/";
  return a === b || a.startsWith(b.endsWith(separator) ? b : `${b}${separator}`);
}

// Controlla che un percorso usato da un figlio stia nella radice del test e
// non sia una cartella reale.
export function assertIsolatedPath(path, root, label = "percorso") {
  assert.ok(isInside(path, root), `${label} fuori dalla cartella temporanea del test`);
  assert.ok(isInside(root, tmpdir()), "la radice del test deve stare sotto la cartella temporanea");
  if (REAL.APPDATA) {
    assert.ok(!isInside(path, REAL.APPDATA), `${label} dentro l’APPDATA reale`);
  }
  for (const real of REAL.stateDirs) {
    assert.ok(!isInside(path, real), `${label} dentro una cartella di stato reale`);
  }
}

// Crea l’ambiente isolato. prefix contiene spazi, parentesi quadre, apostrofo
// e una lettera accentata: i percorsi devono funzionare anche così.
export function createIsolatedState(t, { prefix = "futuria [prova] D'Angelo è-" } = {}) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const profile = join(root, "profilo");
  const roaming = join(root, "Roaming");
  const local = join(root, "Local");
  for (const dir of [profile, roaming, local]) mkdirSync(dir, { recursive: true });

  const env = {};
  const strip = new Set(["appdata", "localappdata", "userprofile", "home", "psmodulepath"]);
  for (const [key, value] of Object.entries(process.env)) {
    if (!strip.has(key.toLowerCase())) env[key] = value;
  }
  env.APPDATA = roaming;
  env.LOCALAPPDATA = local;
  env.USERPROFILE = profile;
  env.HOME = profile;
  for (const variant of Object.keys(env)) {
    if (variant !== variant.toUpperCase() && strip.has(variant.toLowerCase())) {
      throw new Error("variabile duplicata nell’ambiente del test");
    }
  }

  const state = {
    root,
    profile,
    roaming,
    local,
    env,
    windows: {
      stateDir: join(profile, ".futuria-crm-skill"),
      legacyDir: join(roaming, "Futuria CRM"),
    },
    mac: {
      stateDir: join(profile, "Library", "Application Support", MAC_STATE_DIR_NAME),
      legacyDir: join(profile, "Library", "Application Support", "Futuria CRM"),
    },
  };
  for (const [label, path] of Object.entries({
    "APPDATA": roaming,
    "LOCALAPPDATA": local,
    "USERPROFILE": profile,
    "cartella Windows": state.windows.stateDir,
    "cartella Windows precedente": state.windows.legacyDir,
    "cartella macOS": state.mac.stateDir,
    "cartella macOS precedente": state.mac.legacyDir,
  })) {
    assertIsolatedPath(path, root, label);
  }
  // Le funzioni di produzione, con l’ambiente del test, puntano qui.
  assert.equal(
    normalize(stateDirectory({ platform: "win32", env })),
    normalize(state.windows.stateDir),
  );
  assert.equal(
    normalize(legacyStateDirectory({ platform: "win32", env })),
    normalize(state.windows.legacyDir),
  );
  return state;
}

// Fotografia di una cartella: nomi, dimensioni, impronte, date e permessi.
export function snapshot(dir) {
  if (!existsSync(dir)) return null;
  const entries = {};
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const info = lstatSync(path);
    entries[name] = info.isFile()
      ? {
        size: info.size,
        sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
        mtimeMs: info.mtimeMs,
        mode: info.mode,
      }
      : { type: info.isDirectory() ? "dir" : "altro", mode: info.mode };
  }
  return { mode: statSync(dir).mode, entries };
}

export function listTemps(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => /\.tmp$/.test(name));
}

// ---------- PowerShell ----------

export function runPowerShellFile(state, script, args = [], { input, env = {} } = {}) {
  return spawnSync(
    POWERSHELL,
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(SCRIPTS_DIR, script), ...args],
    { encoding: "utf8", env: { ...state.env, ...env }, input, timeout: 120000, windowsHide: true },
  );
}

// Esegue un comando PowerShell fisso; i percorsi arrivano solo come variabili
// d’ambiente, mai dentro il testo del comando.
export function runPowerShellCommand(state, command, env = {}) {
  return spawnSync(
    POWERSHELL,
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
    {
      encoding: "utf8",
      env: { ...state.env, FUTURIA_TEST_STATE_SCRIPT: join(SCRIPTS_DIR, "state-dir.ps1"), ...env },
      timeout: 120000,
      windowsHide: true,
    },
  );
}

// Percorsi calcolati dal figlio PowerShell con l’ambiente del test.
export function assertPowerShellChildIsolated(state) {
  // In base64: con l’output rediretto PowerShell 5.1 scrive nella code page
  // OEM e le lettere accentate del percorso di prova arriverebbero alterate.
  const result = runPowerShellCommand(
    state,
    ". $env:FUTURIA_TEST_STATE_SCRIPT; $p = Get-FuturiaStatePaths; foreach ($v in @($p.Dir, $p.LegacyDir)) { Write-Output ([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($v))) }",
  );
  assert.equal(result.status, 0, result.stderr);
  const [dir, legacy] = result.stdout.trim().split(/\r?\n/).map((line) => Buffer.from(line.trim(), "base64").toString("utf8"));
  assertIsolatedPath(dir, state.root, "cartella calcolata dal figlio");
  assertIsolatedPath(legacy, state.root, "cartella precedente calcolata dal figlio");
  assert.equal(normalize(dir), normalize(state.windows.stateDir));
  assert.equal(normalize(legacy), normalize(state.windows.legacyDir));
}

// Crea credential.xml come lo scrive la skill (PSCredential «futuria-crm» con
// una chiave fittizia), oppure con un altro nome utente o non PSCredential.
export function writeCredentialFixture(state, path, { userName = "futuria-crm", pit = FAKE_PIT, kind = "credential" } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const command = kind === "credential"
    ? "$s = ConvertTo-SecureString $env:FUTURIA_TEST_PIT -AsPlainText -Force; [System.Management.Automation.PSCredential]::new($env:FUTURIA_TEST_USER, $s) | Export-Clixml -LiteralPath $env:FUTURIA_TEST_PATH"
    : "@{ nome = 'non una credenziale' } | Export-Clixml -LiteralPath $env:FUTURIA_TEST_PATH";
  const result = runPowerShellCommand(state, command, {
    FUTURIA_TEST_PIT: pit,
    FUTURIA_TEST_USER: userName,
    FUTURIA_TEST_PATH: path,
  });
  assert.equal(result.status, 0, result.stderr);
}

// ---------- Bash ----------

export function bashExecutable() {
  if (process.env.FUTURIA_TEST_BASH) return process.env.FUTURIA_TEST_BASH;
  if (process.platform === "darwin") return "/bin/bash";
  if (process.platform === "win32") {
    // Il bash di usr\bin, non il lanciatore di Git\bin che mette i propri
    // programmi davanti a quelli finti nel PATH.
    const candidate = "C:\\Program Files\\Git\\usr\\bin\\bash.exe";
    return existsSync(candidate) ? candidate : null;
  }
  return "bash";
}

// Percorso visto da Git Bash su Windows (/c/...), invariato altrove.
export function toBashPath(path) {
  if (process.platform !== "win32") return path;
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(path);
  return match ? `/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}` : path.replace(/\\/g, "/");
}

// Programmi finti messi per primi nel PATH del figlio: uname (sistema
// simulato), security (Portachiavi), pgrep (app desktop) e curl (rete).
// Nessuno usa il Portachiavi reale o la rete.
export function createFakeTools(state) {
  const bin = join(state.root, "bin-finti");
  mkdirSync(bin, { recursive: true });
  const tools = {
    uname: '#!/bin/sh\nprintf "%s\\n" "${FAKE_UNAME:-Darwin}"\n',
    security: [
      "#!/bin/sh",
      'printf "%s\\n" "$1" >> "$FAKE_LOG"',
      'case "$1" in',
      "  find-generic-password)",
      '    rc="${FAKE_SECURITY_FIND_RC:-44}"',
      '    if [ "$rc" = "0" ]; then',
      '      for arg in "$@"; do',
      '        if [ "$arg" = "-w" ]; then printf "%s\\n" "${FAKE_SECURITY_PIT:-pit-preview-keychain-1234567890}"; fi',
      "      done",
      "    fi",
      '    exit "$rc" ;;',
      '  delete-generic-password) exit "${FAKE_SECURITY_DELETE_RC:-0}" ;;',
      "  *) exit 1 ;;",
      "esac",
      "",
    ].join("\n"),
    pgrep: '#!/bin/sh\nprintf "pgrep %s\\n" "$*" >> "$FAKE_LOG"\nexit "${FAKE_PGREP_RC:-1}"\n',
    curl: '#!/bin/sh\nprintf "curl\\n" >> "$FAKE_LOG"\nexit 99\n',
  };
  for (const [name, content] of Object.entries(tools)) {
    const path = join(bin, name);
    writeFileSync(path, content, { encoding: "utf8" });
    chmodSync(path, 0o755);
  }
  const log = join(state.root, "strumenti-finti.log");
  writeFileSync(log, "");
  return { bin, log };
}

export function runBash(state, tools, args, { env = {}, input } = {}) {
  const bash = bashExecutable();
  const childEnv = { ...state.env };
  const pathKey = Object.keys(childEnv).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const basePath = childEnv[pathKey] ?? "";
  delete childEnv[pathKey];
  // Su Windows i programmi di Git Bash (od, head, find…) subito dopo quelli finti.
  const bashTools = process.platform === "win32" ? `${dirname(bash)}${delimiter}` : "";
  childEnv.PATH = `${tools.bin}${delimiter}${bashTools}${basePath}`;
  childEnv.HOME = toBashPath(state.profile);
  childEnv.FAKE_LOG = toBashPath(tools.log);
  return spawnSync(bash, args, {
    encoding: "utf8",
    env: { ...childEnv, ...env },
    input,
    timeout: 60000,
    windowsHide: true,
  });
}
