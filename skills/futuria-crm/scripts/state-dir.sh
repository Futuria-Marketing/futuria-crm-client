# shellcheck shell=bash
# Cartella di stato della skill Futuria CRM su macOS.
#
# Caricato con source da setup-credentials.sh e crm-api.sh. Regole:
# - compatibile con /bin/bash 3.2 di macOS e con set -euo pipefail: niente
#   array propri, funzioni che possono fallire chiamate solo dentro un if o con ||;
# - espressioni regolari in variabili, senza virgolette dopo =~;
# - nessun parser JSON: la configurazione si riconosce sul testo grezzo, con la
#   stessa regola di state-dir.ps1 e credential-wizard.mjs;
# - messaggi per l'agente in ASCII, uguali a quelli di Windows.
#
# La cartella della skill e' separata da quella dell'app desktop Futuria CRM
# (~/Library/Application Support/Futuria CRM), usata dalle versioni fino alla
# 1.3.2: da li' si copia soltanto, mai si sposta o si modifica.
# Il nome e' identico in credential-wizard.mjs (controllato dal validatore).

FUTURIA_STATE_DIR_NAME="com.futuriamarketing.futuria-crm-skill"
FUTURIA_LEGACY_DIR_NAME="Futuria CRM"
FUTURIA_KEYCHAIN_SERVICE="com.futuriamarketing.futuria-crm.pit"
FUTURIA_KEYCHAIN_ACCOUNT="default"
FUTURIA_CONFIG_MAX_BYTES=1024
FUTURIA_DESKTOP_PROCESS_NAME="Futuria CRM"

FUTURIA_MSG_INVALID_DIR="[futuria-crm:cartella-non-valida] La cartella home (HOME) non e' valida: la configurazione Futuria CRM non si puo' usare."
FUTURIA_MSG_USE_POWERSHELL="[futuria-crm:usa-powershell] Su Windows usa scripts\\crm-api.ps1 (o setup-credentials.ps1) con PowerShell."

# Sistema riconosciuto dal nome del kernel: darwin, windows (Git Bash, MSYS,
# Cygwin) oppure other (Linux e il resto).
futuria_platform() {
  local kernel
  kernel="$(uname -s 2>/dev/null || true)"
  case "${kernel}" in
    Darwin) echo "darwin" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *) echo "other" ;;
  esac
}

# Imposta i percorsi; restituisce 1 se HOME manca o non e' assoluto.
futuria_state_paths() {
  local home="${HOME:-}"
  case "${home}" in
    /?*) ;;
    *) return 1 ;;
  esac
  case "${home}" in
    *[[:cntrl:]]*) return 1 ;;
  esac
  case "/${home}/" in
    */../*) return 1 ;;
  esac
  home="${home%/}"
  FUTURIA_STATE_DIR="${home}/Library/Application Support/${FUTURIA_STATE_DIR_NAME}"
  FUTURIA_CONFIG_FILE="${FUTURIA_STATE_DIR}/config.json"
  FUTURIA_LEGACY_DIR="${home}/Library/Application Support/${FUTURIA_LEGACY_DIR_NAME}"
  FUTURIA_LEGACY_CONFIG_FILE="${FUTURIA_LEGACY_DIR}/config.json"
  return 0
}

# Riconosce una configurazione della skill: oggetto JSON con le sole chiavi
# location, storage e updated_at, valori stringa semplici, nessun duplicato,
# storage uguale a macos-keychain, al massimo 1 KiB. Restituisce 0 e imposta
# FUTURIA_CFG_LOCATION, FUTURIA_CFG_UPDATED_AT e FUTURIA_CFG_TEXT, altrimenti 1.
# Il contenuto non viene mai stampato.
futuria_classify_config() {
  local LC_ALL=C
  local file="$1"
  local ws=$' \t\r\n'
  local re_object="^[${ws}]*[{](.*)[}][${ws}]*\$"
  local re_pair="^\"([A-Za-z_]+)\"[${ws}]*:[${ws}]*\"([A-Za-z0-9_.:+-]*)\"(.*)\$"
  local re_location='^[A-Za-z0-9_-]{6,128}$'
  local re_updated='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,7})?Z$'
  local re_size='^[0-9]+$'
  local size text body key value rest
  local seen=" " need_pair=0 location="" storage="" updated="" has_updated=0

  FUTURIA_CFG_LOCATION=""
  FUTURIA_CFG_UPDATED_AT=""
  FUTURIA_CFG_TEXT=""
  if [[ ! -f "${file}" || -L "${file}" || ! -r "${file}" ]]; then return 1; fi
  size="$(wc -c 2>/dev/null < "${file}" | tr -d '[:space:]')" || return 1
  if [[ ! "${size}" =~ ${re_size} ]]; then return 1; fi
  if (( size > FUTURIA_CONFIG_MAX_BYTES )); then return 1; fi
  # Lettura limitata a 1025 byte; la x finale conserva gli a capo.
  text="$(head -c 1025 -- "${file}" 2>/dev/null; printf 'x')" || return 1
  text="${text%x}"
  if (( ${#text} > FUTURIA_CONFIG_MAX_BYTES )); then return 1; fi
  FUTURIA_CFG_TEXT="${text}"
  text="${text#$'\xEF\xBB\xBF'}"

  if [[ ! "${text}" =~ ${re_object} ]]; then return 1; fi
  body="${BASH_REMATCH[1]}"
  while :; do
    body="${body#"${body%%[!${ws}]*}"}"
    if [[ -z "${body}" ]]; then
      if (( need_pair == 1 )); then return 1; fi
      break
    fi
    if [[ ! "${body}" =~ ${re_pair} ]]; then return 1; fi
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    rest="${BASH_REMATCH[3]}"
    case "${key}" in
      location|storage|updated_at) ;;
      *) return 1 ;;
    esac
    case "${seen}" in
      *" ${key} "*) return 1 ;;
    esac
    seen="${seen}${key} "
    case "${key}" in
      location) location="${value}" ;;
      storage) storage="${value}" ;;
      updated_at) updated="${value}"; has_updated=1 ;;
    esac
    rest="${rest#"${rest%%[!${ws}]*}"}"
    if [[ -z "${rest}" ]]; then break; fi
    if [[ "${rest:0:1}" != "," ]]; then return 1; fi
    body="${rest:1}"
    need_pair=1
  done

  if [[ ! "${location}" =~ ${re_location} ]]; then return 1; fi
  if [[ "${storage}" != "macos-keychain" ]]; then return 1; fi
  if (( has_updated == 1 )) && [[ ! "${updated}" =~ ${re_updated} ]]; then return 1; fi
  FUTURIA_CFG_LOCATION="${location}"
  FUTURIA_CFG_UPDATED_AT="${updated}"
  return 0
}

# Testo della configurazione nel formato della skill.
futuria_config_text() {
  if [[ -n "${2:-}" ]]; then
    printf '{\n  "location": "%s",\n  "storage": "macos-keychain",\n  "updated_at": "%s"\n}\n' "$1" "$2"
  else
    printf '{\n  "location": "%s",\n  "storage": "macos-keychain"\n}\n' "$1"
  fi
}

# Nome del file temporaneo, identico a quello del configuratore:
# .config-<16 cifre esadecimali>.tmp
futuria_temp_name() {
  local hex re_hex='^[0-9a-f]{16}$'
  hex="$(od -An -N8 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n')" || return 1
  if [[ ! "${hex}" =~ ${re_hex} ]]; then return 1; fi
  printf '.config-%s.tmp' "${hex}"
}

futuria_is_temp_name() {
  local re_temp='^\.config-[0-9a-f]{16}\.tmp$'
  [[ "$1" =~ ${re_temp} ]]
}

# Cancella i propri temporanei piu' vecchi di 10 minuti nella cartella indicata.
futuria_clean_stale_temps() {
  local dir="$1" file
  if [[ ! -d "${dir}" || -L "${dir}" ]]; then return 0; fi
  find "${dir}" -maxdepth 1 -type f -name '.config-*.tmp' -mmin +10 2>/dev/null | while IFS= read -r file; do
    if futuria_is_temp_name "${file##*/}"; then
      rm -f -- "${file}" 2>/dev/null || true
    fi
  done || true
  return 0
}

# Copia (mai sposta) la configurazione della versione precedente nella
# cartella nuova, solo se la cartella nuova non ha ancora una configurazione
# e la voce del Portachiavi c'e' ancora: dopo una rimozione la vecchia copia
# dell'ID account (rimasta perche' l'app desktop era aperta) non torna.
# Non restituisce mai errore: imposta FUTURIA_MIGRATION a none, copied o
# fallback e, nel caso fallback, FUTURIA_FALLBACK_LOCATION.
futuria_migrate_legacy() {
  local location updated temp_name temp
  FUTURIA_MIGRATION="none"
  FUTURIA_FALLBACK_LOCATION=""
  if [[ -e "${FUTURIA_CONFIG_FILE}" || -L "${FUTURIA_CONFIG_FILE}" ]]; then return 0; fi
  if [[ ! -d "${FUTURIA_LEGACY_DIR}" ]]; then return 0; fi
  if ! futuria_classify_config "${FUTURIA_LEGACY_CONFIG_FILE}"; then return 0; fi
  # Con il Portachiavi bloccato (non accessibile) la copia si fa comunque.
  if [[ "$(futuria_keychain_state)" == "mancante" ]]; then return 0; fi
  location="${FUTURIA_CFG_LOCATION}"
  updated="${FUTURIA_CFG_UPDATED_AT}"

  temp=""
  if temp_name="$(futuria_temp_name)" \
    && ( umask 077 && mkdir -p -- "${FUTURIA_STATE_DIR}" ) 2>/dev/null \
    && chmod 700 -- "${FUTURIA_STATE_DIR}" 2>/dev/null \
    && temp="${FUTURIA_STATE_DIR}/${temp_name}" \
    && ( umask 077 && futuria_config_text "${location}" "${updated}" > "${temp}" ) 2>/dev/null; then
    # Rinomina senza sovrascrivere: ln fallisce se la destinazione esiste.
    # Se il disco non supporta i collegamenti (SMB, disco esterno) si crea il
    # file con noclobber, che fallisce anch'esso se la destinazione esiste.
    if ! ln -- "${temp}" "${FUTURIA_CONFIG_FILE}" 2>/dev/null; then
      ( set -C; umask 077; cat -- "${temp}" > "${FUTURIA_CONFIG_FILE}" ) 2>/dev/null || true
    fi
  fi
  if [[ -n "${temp}" ]]; then rm -f -- "${temp}" 2>/dev/null || true; fi

  if futuria_classify_config "${FUTURIA_CONFIG_FILE}"; then
    # Copiata da questo processo o, in parallelo, da un altro.
    FUTURIA_MIGRATION="copied"
    return 0
  fi
  FUTURIA_MIGRATION="fallback"
  FUTURIA_FALLBACK_LOCATION="${location}"
  echo "[futuria-crm:copia-rimandata] Non e' stato possibile copiare la configurazione della versione precedente nella nuova cartella: la uso in sola lettura e la copia verra' ritentata alla prossima esecuzione." >&2
  return 0
}

# ID account per Status e crm-api: dalla cartella nuova, dopo l'eventuale
# copia dalla versione precedente. Imposta FUTURIA_LOCATION (vuoto se manca).
futuria_resolve_location() {
  FUTURIA_LOCATION=""
  futuria_clean_stale_temps "${FUTURIA_STATE_DIR}"
  futuria_migrate_legacy
  if [[ "${FUTURIA_MIGRATION}" == "fallback" ]]; then
    FUTURIA_LOCATION="${FUTURIA_FALLBACK_LOCATION}"
    return 0
  fi
  if futuria_classify_config "${FUTURIA_CONFIG_FILE}"; then
    FUTURIA_LOCATION="${FUTURIA_CFG_LOCATION}"
  fi
  return 0
}

# Stato della voce del Portachiavi, senza leggerne il valore:
# presente, mancante (errSecItemNotFound, codice 44) o non-accessibile.
futuria_keychain_state() {
  local rc=0
  security find-generic-password -a "${FUTURIA_KEYCHAIN_ACCOUNT}" -s "${FUTURIA_KEYCHAIN_SERVICE}" >/dev/null 2>&1 || rc=$?
  case "${rc}" in
    0) echo "presente" ;;
    44) echo "mancante" ;;
    *) echo "non-accessibile" ;;
  esac
}

# Vero se nella cartella vecchia c'e' una configurazione della skill piu'
# recente della copia nuova: un'installazione non aggiornata ha ricollegato
# l'account dopo la copia.
futuria_legacy_newer() {
  if [[ ! -f "${FUTURIA_CONFIG_FILE}" ]]; then return 1; fi
  if ! futuria_classify_config "${FUTURIA_LEGACY_CONFIG_FILE}"; then return 1; fi
  [[ "${FUTURIA_LEGACY_CONFIG_FILE}" -nt "${FUTURIA_CONFIG_FILE}" ]]
}

# Vero se l'app desktop Futuria CRM e' in esecuzione (o se non si puo' sapere).
futuria_desktop_app_running() {
  local rc=0
  if ! command -v pgrep >/dev/null 2>&1; then return 0; fi
  pgrep -x "${FUTURIA_DESKTOP_PROCESS_NAME}" >/dev/null 2>&1 || rc=$?
  [[ "${rc}" -ne 1 ]]
}
