#!/usr/bin/env bash
set -euo pipefail
set +x

if (( $# < 2 || $# > 3 )); then
  echo "Uso: crm-api.sh METHOD /percorso[/...] [corpo-json]" >&2
  exit 2
fi

method="$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')"
path="$2"
body="${3:-}"
version="${FUTURIA_CRM_API_VERSION:-2021-07-28}"

case "${method}" in
  GET|POST|PUT|PATCH|DELETE) ;;
  *) echo "Metodo API non consentito." >&2; exit 2 ;;
esac
if [[ "${path}" != /* ]] || [[ "${path}" == *"://"* ]]; then
  echo "Il percorso API deve essere relativo e iniziare con /. URL esterni non sono consentiti." >&2
  exit 2
fi

location="${FUTURIA_CRM_LOCATION:-${FUTURIA_CRM_LOCATION_ID:-}}"
token="${FUTURIA_CRM_TOKEN:-}"

# shellcheck source=state-dir.sh
. "$(dirname -- "${BASH_SOURCE[0]}")/state-dir.sh"

runtime="$(futuria_platform)"
if [[ "${runtime}" == "windows" ]]; then
  # Git Bash su Windows: la configurazione protetta e' quella di PowerShell.
  unset token
  echo "${FUTURIA_MSG_USE_POWERSHELL}" >&2
  exit 2
fi

key_state="mancante"
if [[ -n "${token}" ]]; then key_state="presente"; fi

# Le variabili d'ambiente hanno la precedenza; su macOS il Portachiavi e la
# cartella della skill si consultano solo per il valore che manca. Su Linux si
# usano soltanto le variabili d'ambiente.
if [[ "${runtime}" == "darwin" && ( -z "${token}" || -z "${location}" ) ]]; then
  if ! futuria_state_paths; then
    unset token
    echo "${FUTURIA_MSG_INVALID_DIR}" >&2
    exit 3
  fi
  if [[ -z "${location}" ]]; then
    futuria_resolve_location
    location="${FUTURIA_LOCATION}"
  fi
  if [[ -z "${token}" ]]; then
    token_rc=0
    token="$(security find-generic-password -a "${FUTURIA_KEYCHAIN_ACCOUNT}" -s "${FUTURIA_KEYCHAIN_SERVICE}" -w 2>/dev/null)" || token_rc=$?
    if (( token_rc == 0 )) && [[ -n "${token}" ]]; then
      key_state="presente"
    elif (( token_rc == 44 || token_rc == 0 )); then
      token=""
      key_state="mancante"
    else
      token=""
      key_state="non-accessibile"
    fi
  fi
fi

if [[ "${key_state}" == "non-accessibile" ]]; then
  unset token
  echo "[futuria-crm:portachiavi-non-accessibile] Portachiavi non accessibile da questo processo: sbloccalo o esegui il comando fuori dalla sandbox." >&2
  exit 3
fi
if [[ "${runtime}" != "darwin" && ( -z "${token}" || -z "${location}" ) ]]; then
  unset token
  echo "[futuria-crm:credenziali-mancanti] Credenziali Futuria CRM mancanti. Su Linux imposta FUTURIA_CRM_TOKEN e FUTURIA_CRM_LOCATION in un terminale separato." >&2
  exit 3
fi
if [[ -z "${token}" && -z "${location}" ]]; then
  echo "[futuria-crm:credenziali-mancanti] Credenziali Futuria CRM mancanti. Avvia il configuratore con launch-credential-setup.sh." >&2
  exit 3
fi
if [[ -z "${location}" ]]; then
  unset token
  echo "[futuria-crm:id-mancante] Configurazione Futuria CRM incompleta: chiave privata presente, ID account mancante. Riapri il configuratore con launch-credential-setup.sh e ricollega l'account." >&2
  exit 3
fi
if [[ -z "${token}" ]]; then
  echo "[futuria-crm:chiave-mancante] Configurazione Futuria CRM incompleta: ID account presente, chiave privata mancante. Riapri il configuratore con launch-credential-setup.sh." >&2
  exit 3
fi
if [[ ! "${token}" =~ ^pit-[A-Za-z0-9._-]+$ ]] || (( ${#token} < 10 || ${#token} > 2052 )); then
  unset token
  echo "La chiave privata configurata non ha il formato atteso." >&2
  exit 3
fi
if [[ ! "${location}" =~ ^[A-Za-z0-9_-]{6,128}$ ]]; then
  unset token
  echo "L'ID account configurato non ha il formato atteso." >&2
  exit 3
fi
if [[ ! "${version}" =~ ^(v[0-9]+|[0-9]{4}-[0-9]{2}-[0-9]{2})$ ]]; then
  unset token
  echo "La versione API richiesta non ha il formato atteso." >&2
  exit 2
fi

path="${path//\{location\}/${location}}"
body="${body//\{location\}/${location}}"
url="https://services.leadconnectorhq.com${path}"

curl_args=(--silent --show-error --fail-with-body --request "${method}" --url "${url}")
if [[ -n "${body}" ]]; then
  curl_args+=(--data-binary "${body}")
fi

{
  printf 'header = "Authorization: Bearer %s"\n' "${token//\"/\\\"}"
  printf 'header = "Version: %s"\n' "${version}"
  printf 'header = "Accept: application/json"\n'
  if [[ -n "${body}" ]]; then
    printf 'header = "Content-Type: application/json"\n'
  fi
} | curl --config - "${curl_args[@]}"

unset token
