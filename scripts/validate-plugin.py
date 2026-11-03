#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Validator del plugin futuria-crm-client. Eseguito in CI e prima di ogni release.

Controlli:
  1. White-label: nessun nome del vendor fuori dal file di terminologia controllato;
     l'host tecnico solo nei file dove e' inevitabile.
  2. JSON del repo tutti validi.
  3. SKILL.md: frontmatter con name (= cartella) e description; niente doppi apici
     nella description (il parser frontmatter di alcuni runtime scarta la skill).
  4. Ogni skill ha agents/openai.yaml e un command wrapper commands/<name>.md.
  5. I path `references/...` citati nelle skill esistono davvero.
  6. Niente placeholder TODO/FIXME nei contenuti distribuiti.
  7. Cartella di stato: nome identico nei tre file, nessun uso della cartella
     dell'app desktop, codifiche dei PowerShell, -LiteralPath, Bash 3.2, LF, CI.

Uso:  python scripts/validate-plugin.py
Exit 0 = tutto ok; exit 1 = violazioni (elencate).
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ERRORS = []

TEXT_EXT = {".md", ".json", ".yaml", ".yml", ".py", ".ps1", ".sh", ".html", ".css", ".js", ".mjs", ".txt"}
SKIP_DIRS = {".git", ".github", "node_modules", "__pycache__"}
SELF = Path(__file__).resolve()

# Nomi del vendor: MAI nel repo, tranne la tabella di riconoscimento nella
# reference di terminologia. Pattern composti a runtime per non auto-matcharsi.
BRAND_PAT = re.compile("|".join(["go" + "highlevel", "high" + "level", r"\bg" + r"hl\b"]),
                       re.IGNORECASE)
BRAND_ALLOW = {"skills/futuria-crm/references/terminology-and-voice.md"}

# Host tecnico: tollerato solo dove e' parte di endpoint reali.
HOST_PAT = re.compile("lead" + "connector", re.IGNORECASE)
HOST_ALLOW = BRAND_ALLOW | {
    "skills/futuria-crm/references/api-and-troubleshooting.md",
    "skills/futuria-crm/scripts/crm-api.ps1",
    "skills/futuria-crm/scripts/crm-api.sh",
    "skills/futuria-crm/scripts/credential-wizard.mjs",
}

PLACEHOLDER_PAT = re.compile(r"\bTODO\b|\bFIXME\b|\bXXX\b")


def rel(p: Path) -> str:
    return p.relative_to(ROOT).as_posix()


def iter_files():
    for p in sorted(ROOT.rglob("*")):
        if not p.is_file() or p.resolve() == SELF:
            continue
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        if p.suffix.lower() in TEXT_EXT:
            yield p


def check_branding():
    for p in iter_files():
        text = p.read_text(encoding="utf-8", errors="replace")
        r = rel(p)
        for i, line in enumerate(text.splitlines(), 1):
            if BRAND_PAT.search(line) and r not in BRAND_ALLOW:
                ERRORS.append(f"[brand] {r}:{i} contiene un nome vendor: {line.strip()[:90]}")
            if HOST_PAT.search(line) and r not in HOST_ALLOW:
                ERRORS.append(f"[host]  {r}:{i} espone l'host tecnico fuori dai file consentiti")


def check_json():
    for p in iter_files():
        if p.suffix.lower() != ".json":
            continue
        try:
            json.loads(p.read_text(encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            ERRORS.append(f"[json]  {rel(p)} non valido: {e}")


def check_packaging():
    required = [
        ROOT / ".claude-plugin" / "plugin.json",
        ROOT / ".claude-plugin" / "marketplace.json",
        ROOT / ".codex-plugin" / "plugin.json",
        ROOT / ".agents" / "plugins" / "marketplace.json",
        ROOT / "INSTALL.md",
        ROOT / "PRIVACY.md",
        ROOT / "SECURITY.md",
    ]
    for path in required:
        if not path.exists():
            ERRORS.append(f"[pack]  manca {rel(path)}")
    if any(not p.exists() for p in required[:3]):
        return

    claude = json.loads(required[0].read_text(encoding="utf-8"))
    claude_market = json.loads(required[1].read_text(encoding="utf-8"))
    codex = json.loads(required[2].read_text(encoding="utf-8"))
    market_plugins = claude_market.get("plugins") or []
    market_version = market_plugins[0].get("version") if market_plugins else None
    versions = {claude.get("version"), codex.get("version"), market_version}
    if len(versions) != 1 or None in versions:
        ERRORS.append(f"[pack]  versioni divergenti: Claude={claude.get('version')}, "
                      f"Codex={codex.get('version')}, marketplace={market_version}")
    if claude.get("name") != "futuria-crm" or codex.get("name") != "futuria-crm":
        ERRORS.append("[pack]  il nome plugin deve essere futuria-crm in entrambi i runtime")

    manifest_version = claude.get("version")
    for version_path in [
        ROOT / "skills" / "futuria-crm" / "VERSION",
    ]:
        if not version_path.exists():
            ERRORS.append(f"[pack]  manca {rel(version_path)}")
            continue
        skill_version = version_path.read_text(encoding="utf-8").strip()
        if skill_version != manifest_version:
            ERRORS.append(f"[pack]  {rel(version_path)}={skill_version} ma manifest={manifest_version}")

    privacy_url = (codex.get("interface") or {}).get("privacyPolicyURL", "")
    if not privacy_url.endswith("/PRIVACY.md"):
        ERRORS.append("[pack]  privacyPolicyURL Codex mancante o non canonico")


def check_credential_contract():
    distributed_docs = [ROOT / "README.md", ROOT / "INSTALL.md"]
    unsafe = [
        re.compile(r"\bsetx\s+FUTURIA_CRM_TOKEN", re.IGNORECASE),
        re.compile(r"\bexport\s+FUTURIA_CRM_TOKEN\s*=", re.IGNORECASE),
        re.compile(r"i dati (?:del tuo account )?viaggiano solo", re.IGNORECASE),
    ]
    for path in distributed_docs:
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for pattern in unsafe:
            if pattern.search(text):
                ERRORS.append(f"[cred]  {rel(path)} contiene onboarding o promessa privacy non sicuri")

    scripts = [
        ROOT / "skills" / "futuria-crm" / "scripts" / "setup-credentials.ps1",
        ROOT / "skills" / "futuria-crm" / "scripts" / "setup-credentials.sh",
        ROOT / "skills" / "futuria-crm" / "scripts" / "crm-api.ps1",
        ROOT / "skills" / "futuria-crm" / "scripts" / "crm-api.sh",
        ROOT / "skills" / "futuria-crm" / "scripts" / "state-dir.ps1",
        ROOT / "skills" / "futuria-crm" / "scripts" / "state-dir.sh",
        ROOT / "skills" / "futuria-crm" / "scripts" / "launch-credential-setup.ps1",
        ROOT / "skills" / "futuria-crm" / "scripts" / "launch-credential-setup.sh",
        ROOT / "skills" / "futuria-crm" / "scripts" / "credential-wizard.mjs",
        ROOT / "skills" / "futuria-crm" / "scripts" / "credential-wizard" / "index.html",
        ROOT / "skills" / "futuria-crm" / "scripts" / "credential-wizard" / "styles.css",
        ROOT / "skills" / "futuria-crm" / "scripts" / "credential-wizard" / "app.js",
        ROOT / "skills" / "futuria-crm" / "scripts" / "credential-wizard" / "assets" / "futuria-crm-logo.png",
        ROOT / "skills" / "futuria-crm" / "scripts" / "credential-wizard" / "assets" / "step-1-private-integrations.png",
        ROOT / "skills" / "futuria-crm" / "scripts" / "credential-wizard" / "assets" / "step-2-integration-details.png",
        ROOT / "skills" / "futuria-crm" / "scripts" / "credential-wizard" / "assets" / "step-3-paste-here.png",
    ]
    for path in scripts:
        if not path.exists():
            ERRORS.append(f"[cred]  helper credenziali mancante: {rel(path)}")

    mac_setup = scripts[1]
    if mac_setup.exists():
        text = mac_setup.read_text(encoding="utf-8", errors="replace")
        if re.search(r"-w\s+[\"']?\$\{?pit\b", text, re.IGNORECASE):
            ERRORS.append("[cred]  setup macOS passa il PIT come argomento di processo")

    wizard = ROOT / "skills" / "futuria-crm" / "scripts" / "credential-wizard.mjs"
    if wizard.exists():
        text = wizard.read_text(encoding="utf-8", errors="replace")
        lower_text = text.lower()
        if not all(marker in lower_text for marker in ["127.0.0.1", "samesite=strict", "x-futuria-csrf", "cache-control"]):
            ERRORS.append("[cred]  il configuratore locale non dichiara tutte le protezioni richieste")
        unsafe_mac_args = re.search(
            r'runChild\(\s*"/usr/bin/security"\s*,\s*\[[^\]]*privateKey',
            text,
            re.DOTALL,
        )
        if unsafe_mac_args:
            ERRORS.append("[cred]  il configuratore macOS passa la chiave negli argomenti di processo")


SCRIPTS_DIR = ROOT / "skills" / "futuria-crm" / "scripts"
STATE_FILES = {"state-dir.ps1", "state-dir.sh", "credential-wizard.mjs"}
# Percorso della cartella usata fino alla 1.3.2, che e' quella dell'app desktop
# Futuria CRM: ammesso solo nei tre file che la riconoscono (e nei test).
LEGACY_PATH_PATS = [
    re.compile(r"APPDATA[^\n]{0,40}Futuria CRM", re.IGNORECASE),
    re.compile(r"Application Support/Futuria CRM"),
    re.compile(r"[\"']Application Support[\"']\s*,\s*[\"']Futuria CRM[\"']"),
]
ASCII_ONLY = ["crm-api.ps1", "state-dir.ps1", "launch-credential-setup.ps1"]
AGENT_OUTPUT_PAT = re.compile(r"\b(Write-Output|Write-Error|Write-Warning|Write-FuturiaNotice|throw)\b")
LITERAL_PATH_CMDLETS = re.compile(
    r"\b(Test-Path|Get-Item|Get-ChildItem|Get-Content|Set-Content|Remove-Item|Move-Item|Copy-Item|Import-Clixml|Export-Clixml)\b"
)
BASH32_FORBIDDEN = [
    (re.compile(r"\bdeclare\s+-A\b"), "declare -A"),
    (re.compile(r"\b(mapfile|readarray)\b"), "mapfile/readarray"),
    (re.compile(r"\$\{[^}]*(,,|\^\^)[^}]*\}"), "${x,,} o ${x^^}"),
    (re.compile(r"\[\[\s+-v\b"), "[[ -v ]]"),
]


def git_bytes(spec):
    """Contenuto di un file nell'indice (":path") o in HEAD ("HEAD:path"); None senza git."""
    try:
        return subprocess.run(["git", "show", spec], cwd=ROOT, capture_output=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return None


def strip_ps_comment(line):
    return line.split("#", 1)[0] if not line.lstrip().startswith("#") else ""


def check_state_dir():
    # 1. Nome della cartella di stato identico nei tre file.
    ps1 = (SCRIPTS_DIR / "state-dir.ps1").read_text(encoding="utf-8", errors="replace") if (SCRIPTS_DIR / "state-dir.ps1").exists() else ""
    sh = (SCRIPTS_DIR / "state-dir.sh").read_text(encoding="utf-8", errors="replace") if (SCRIPTS_DIR / "state-dir.sh").exists() else ""
    mjs = (SCRIPTS_DIR / "credential-wizard.mjs").read_text(encoding="utf-8", errors="replace")
    win_ps1 = re.search(r"^\$FuturiaStateDirName\s*=\s*'([^']+)'", ps1, re.MULTILINE)
    mac_sh = re.search(r'^FUTURIA_STATE_DIR_NAME="([^"]+)"', sh, re.MULTILINE)
    win_mjs = re.search(r'WINDOWS_STATE_DIR_NAME\s*=\s*"([^"]+)"', mjs)
    mac_mjs = re.search(r'MAC_STATE_DIR_NAME\s*=\s*"([^"]+)"', mjs)
    if not (win_ps1 and win_mjs) or win_ps1.group(1) != win_mjs.group(1):
        ERRORS.append("[state] nome della cartella Windows diverso tra state-dir.ps1 e credential-wizard.mjs")
    if not (mac_sh and mac_mjs) or mac_sh.group(1) != mac_mjs.group(1):
        ERRORS.append("[state] nome della cartella macOS diverso tra state-dir.sh e credential-wizard.mjs")
    for match in (win_ps1, mac_sh):
        if match and (BRAND_PAT.search(match.group(1)) or "Futuria CRM" == match.group(1)):
            ERRORS.append("[state] nome della cartella di stato non valido")
    service_sh = re.search(r'^FUTURIA_KEYCHAIN_SERVICE="([^"]+)"', sh, re.MULTILINE)
    service_mjs = re.search(r'const SERVICE\s*=\s*"([^"]+)"', mjs)
    if not (service_sh and service_mjs) or service_sh.group(1) != service_mjs.group(1):
        ERRORS.append("[state] service del Portachiavi diverso tra state-dir.sh e credential-wizard.mjs")

    # 2. Percorso vecchio solo nei file che lo riconoscono.
    for base in [SCRIPTS_DIR, ROOT / "commands"]:
        for p in sorted(base.rglob("*")):
            if not p.is_file() or p.suffix.lower() not in TEXT_EXT or p.name in STATE_FILES:
                continue
            for i, line in enumerate(p.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                if any(pat.search(line) for pat in LEGACY_PATH_PATS):
                    ERRORS.append(f"[state] {rel(p)}:{i} usa la cartella dell'app desktop Futuria CRM")

    # 3. Codifiche dei PowerShell: ASCII senza BOM dove richiesto, BOM nel setup.
    for name in ASCII_ONLY:
        path = SCRIPTS_DIR / name
        if not path.exists():
            continue
        data = path.read_bytes()
        if data.startswith(b"\xef\xbb\xbf") or any(byte > 0x7F for byte in data):
            ERRORS.append(f"[enc]   {rel(path)} deve essere solo ASCII e senza BOM")
    setup = SCRIPTS_DIR / "setup-credentials.ps1"
    if setup.exists():
        if not setup.read_bytes().startswith(b"\xef\xbb\xbf"):
            ERRORS.append(f"[enc]   {rel(setup)} deve avere il BOM UTF-8")
        head = git_bytes(f"HEAD:{rel(setup)}")
        if head is not None and not head.startswith(b"\xef\xbb\xbf"):
            ERRORS.append(f"[enc]   {rel(setup)} senza BOM nel commit HEAD")

    # 4. Righe lette dall'agente in ASCII; -LiteralPath sui cmdlet di file.
    for name in ["setup-credentials.ps1", "crm-api.ps1", "state-dir.ps1"]:
        path = SCRIPTS_DIR / name
        if not path.exists():
            continue
        for i, raw in enumerate(path.read_text(encoding="utf-8-sig", errors="replace").splitlines(), 1):
            line = strip_ps_comment(raw)
            if AGENT_OUTPUT_PAT.search(line) and any(ord(ch) > 0x7F for ch in line):
                ERRORS.append(f"[enc]   {rel(path)}:{i} messaggio per l'agente non ASCII")
            for match in LITERAL_PATH_CMDLETS.finditer(line):
                if "-LiteralPath" not in line[match.end():]:
                    ERRORS.append(f"[path]  {rel(path)}:{i} {match.group(1)} senza -LiteralPath")
    if "[IO." in ps1 or "[System.IO." in ps1:
        ERRORS.append("[clm]   state-dir.ps1 usa classi .NET non ammesse in Constrained Language Mode")

    # 5. Messaggio vecchio che rimandava a uno script non piu' adatto.
    for p in iter_files():
        if p.parent.name == "tests" or "tests" in p.relative_to(ROOT).parts:
            continue
        if "Esegui prima setup-credentials.ps1" in p.read_text(encoding="utf-8", errors="replace"):
            ERRORS.append(f"[state] {rel(p)} contiene ancora il vecchio messaggio di credenziali mancanti")

    # 6. Bash 3.2 di macOS e terminazioni di riga LF.
    for p in sorted(SCRIPTS_DIR.glob("*.sh")):
        text = p.read_text(encoding="utf-8", errors="replace")
        for pattern, label in BASH32_FORBIDDEN:
            if pattern.search(text):
                ERRORS.append(f"[compat] {rel(p)} usa {label}, non supportato da Bash 3.2 di macOS")
        if b"\r" in p.read_bytes():
            ERRORS.append(f"[eol]   {rel(p)} contiene CR nel working tree")
        indexed = git_bytes(f":{rel(p)}")
        if indexed is not None and b"\r" in indexed:
            ERRORS.append(f"[eol]   {rel(p)} contiene CR nell'indice Git")
    attributes = ROOT / ".gitattributes"
    attr_text = attributes.read_text(encoding="utf-8") if attributes.exists() else ""
    if not re.search(r"^\*\.sh\s+text\s+eol=lf\s*$", attr_text, re.MULTILINE):
        ERRORS.append("[eol]   .gitattributes deve imporre eol=lf sui .sh")

    # 7. CI: i nuovi helper sono controllati.
    workflow = ROOT / ".github" / "workflows" / "validate.yml"
    if workflow.exists():
        wf = workflow.read_text(encoding="utf-8")
        for needed in ["state-dir.sh", "state-dir.ps1", "tests/state-dir.test.mjs", "/bin/bash -n"]:
            if needed not in wf:
                ERRORS.append(f"[ci]    validate.yml non controlla {needed}")


def parse_frontmatter(text):
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.DOTALL)
    if not m:
        return None
    fm = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            fm[k.strip()] = v.strip()
    return fm


def check_skills():
    skills_dir = ROOT / "skills"
    for sk in sorted(d for d in skills_dir.iterdir() if d.is_dir()):
        name = sk.name
        skill_md = sk / "SKILL.md"
        if not skill_md.exists():
            ERRORS.append(f"[skill] {name}: manca SKILL.md")
            continue
        fm = parse_frontmatter(skill_md.read_text(encoding="utf-8"))
        if not fm:
            ERRORS.append(f"[skill] {name}: frontmatter assente in SKILL.md")
        else:
            if fm.get("name", "").strip("\"'") != name:
                ERRORS.append(f"[skill] {name}: frontmatter name != nome cartella")
            desc = fm.get("description", "")
            if not desc:
                ERRORS.append(f"[skill] {name}: description mancante")
            if '"' in desc:
                ERRORS.append(f"[skill] {name}: doppi apici nella description (rompe il parser)")
        if not (sk / "agents" / "openai.yaml").exists():
            ERRORS.append(f"[skill] {name}: manca agents/openai.yaml")
        if not (ROOT / "commands" / f"{name}.md").exists():
            ERRORS.append(f"[skill] {name}: manca il command wrapper commands/{name}.md")


def check_reference_paths():
    # I path `references/...` sono relativi alla RADICE della skill (dir di SKILL.md),
    # anche quando citati dentro una reference; si accetta pure il path dal file stesso.
    ref_pat = re.compile(r"`((?:\.\./)?(?:[\w-]+/)?references/[\w./-]+\.md)`")
    for p in (ROOT / "skills").rglob("*.md"):
        skill_dir = p.parent
        while skill_dir.parent.name != "skills" and skill_dir.name != "skills":
            skill_dir = skill_dir.parent
        text = p.read_text(encoding="utf-8", errors="replace")
        for refpath in ref_pat.findall(text):
            candidates = [(p.parent / refpath), (skill_dir / refpath)]
            if not any(c.resolve().exists() for c in candidates):
                ERRORS.append(f"[ref]   {rel(p)}: riferimento inesistente {refpath}")


def check_placeholders():
    for p in iter_files():
        if p.suffix.lower() not in {".md", ".yaml", ".yml"}:
            continue
        text = p.read_text(encoding="utf-8", errors="replace")
        for i, line in enumerate(text.splitlines(), 1):
            if PLACEHOLDER_PAT.search(line):
                ERRORS.append(f"[todo]  {rel(p)}:{i} placeholder da rimuovere: {line.strip()[:80]}")


def main():
    check_branding()
    check_json()
    check_packaging()
    check_credential_contract()
    check_state_dir()
    check_skills()
    check_reference_paths()
    check_placeholders()
    if ERRORS:
        print(f"VALIDAZIONE FALLITA — {len(ERRORS)} violazioni:")
        for e in ERRORS:
            print("  " + e)
        sys.exit(1)
    print("Validazione OK: white-label, JSON, skill, reference e placeholder tutti a posto.")


if __name__ == "__main__":
    main()
