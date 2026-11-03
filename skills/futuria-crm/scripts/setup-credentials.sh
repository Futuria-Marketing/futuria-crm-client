#!/usr/bin/env bash
set -euo pipefail
set +x

# shellcheck source=state-dir.sh
. "$(dirname -- "${BASH_SOURCE[0]}")/state-dir.sh"

service="${FUTURIA_KEYCHAIN_SERVICE}"
account="${FUTURIA_KEYCHAIN_ACCOUNT}"
action="${1:-setup}"

case "$(futuria_platform)" in
  darwin) ;;
  windows)
    echo "${FUTURIA_MSG_USE_POWERSHELL}" >&2
    exit 2
    ;;
  *)
    echo "Questo script protetto usa il Portachiavi di macOS." >&2
    echo "Su Linux configura le variabili d'ambiente in un terminale separato." >&2
    exit 2
    ;;
esac

if ! futuria_state_paths; then
  echo "${FUTURIA_MSG_INVALID_DIR}" >&2
  exit 2
fi
config_dir="${FUTURIA_STATE_DIR}"
config_file="${FUTURIA_CONFIG_FILE}"

case "${action}" in
  status)
    # Le righe lette dall'agente restano in ASCII, uguali a quelle di Windows.
    futuria_resolve_location
    key_state="$(futuria_keychain_state)"
    key_label="mancante"
    case "${key_state}" in
      presente) key_label="presente" ;;
      non-accessibile) key_label="non accessibile" ;;
    esac
    echo "Chiave privata protetta: ${key_label}"
    if [[ -n "${FUTURIA_LOCATION}" ]]; then
      echo "ID account: presente"
    else
      echo "ID account: mancante"
    fi
    if [[ "${FUTURIA_MIGRATION}" == "copied" ]]; then
      echo "Configurazione della versione precedente copiata nella nuova cartella."
    elif [[ "${FUTURIA_MIGRATION}" == "fallback" ]]; then
      echo "Configurazione letta in sola lettura dalla cartella della versione precedente: la copia nella nuova cartella e' rimandata."
    fi
    if [[ "${key_state}" == "presente" && -z "${FUTURIA_LOCATION}" ]]; then
      echo "Serve ricollegare l'account: apri di nuovo il configuratore."
    fi
    if [[ "${key_state}" == "non-accessibile" ]]; then
      echo "Portachiavi non accessibile da questo processo: sbloccalo o esegui il comando fuori dalla sandbox."
    fi
    if futuria_legacy_newer; then
      echo "Un'altra installazione del plugin non aggiornata usa ancora la vecchia cartella: aggiornala."
    fi
    if [[ "${key_state}" == "presente" && -n "${FUTURIA_LOCATION}" ]]; then
      exit 0
    fi
    exit 1
    ;;
  remove)
    failed=0
    kept_legacy=0
    delete_rc=0
    security delete-generic-password -a "${account}" -s "${service}" >/dev/null 2>&1 || delete_rc=$?
    # 44: la voce non c'era. Con un altro errore (Portachiavi bloccato o
    # sandbox) i file restano com'erano: la rimozione incompleta non cambia lo
    # stato e si puo' ripetere.
    if (( delete_rc != 0 && delete_rc != 44 )); then
      echo "[futuria-crm:rimozione-incompleta] Portachiavi non accessibile da questo processo: sbloccalo o esegui il comando fuori dalla sandbox, poi ripeti la rimozione."
      exit 1
    fi

    # Cartella della skill: soltanto i nomi noti, poi la cartella se e' vuota.
    if [[ -e "${config_file}" || -L "${config_file}" ]]; then
      rm -f -- "${config_file}" 2>/dev/null || failed=1
    fi
    for temp_file in "${config_dir}"/.config-*.tmp; do
      if [[ -f "${temp_file}" ]] && futuria_is_temp_name "${temp_file##*/}"; then
        rm -f -- "${temp_file}" 2>/dev/null || failed=1
      fi
    done
    if [[ -d "${config_dir}" ]]; then
      rmdir -- "${config_dir}" 2>/dev/null || true
    fi

    # Cartella usata fino alla 1.3.2, condivisa con l'app desktop: soltanto i
    # file riconosciuti come della skill, mai la cartella stessa.
    if [[ -d "${FUTURIA_LEGACY_DIR}" ]]; then
      if futuria_classify_config "${FUTURIA_LEGACY_CONFIG_FILE}"; then
        legacy_text="${FUTURIA_CFG_TEXT}"
        if futuria_desktop_app_running; then
          # L'app potrebbe riscriverlo in questo momento: resta dov'e'.
          kept_legacy=1
        elif futuria_classify_config "${FUTURIA_LEGACY_CONFIG_FILE}" && [[ "${FUTURIA_CFG_TEXT}" == "${legacy_text}" ]]; then
          rm -f -- "${FUTURIA_LEGACY_CONFIG_FILE}" 2>/dev/null || failed=1
        fi
      fi
      # Temporanei lasciati dal configuratore 1.3.x: nome esatto, al massimo
      # 1 KiB, vuoti o con una configurazione della skill.
      for temp_file in "${FUTURIA_LEGACY_DIR}"/.config-*.tmp; do
        if [[ ! -f "${temp_file}" || -L "${temp_file}" ]]; then continue; fi
        if ! futuria_is_temp_name "${temp_file##*/}"; then continue; fi
        if [[ ! -s "${temp_file}" ]] || futuria_classify_config "${temp_file}"; then
          rm -f -- "${temp_file}" 2>/dev/null || failed=1
        fi
      done
    fi

    if (( failed == 1 )); then
      echo "[futuria-crm:rimozione-incompleta] Non e' stato possibile rimuovere tutti i file locali Futuria CRM: chiudi i programmi che li usano e ripeti la rimozione."
      exit 1
    fi
    echo "Credenziali locali Futuria CRM rimosse. La chiave privata remota non e' stata revocata."
    if (( kept_legacy == 1 )); then
      echo "Chiudi l'app desktop Futuria CRM e ripeti la rimozione per togliere anche la vecchia copia dell'ID account."
    fi
    exit 0
    ;;
  setup) ;;
  *)
    echo "Uso: setup-credentials.sh [setup|status|remove]" >&2
    exit 2
    ;;
esac

echo "Configurazione protetta Futuria CRM"
echo "Inserisci i valori in questa finestra. La chiave privata non verrà mostrata né scritta nella chat."
printf "ID del tuo account Futuria CRM: "
IFS= read -r location

if [[ ! "${location}" =~ ^[A-Za-z0-9_-]{6,128}$ ]]; then
  echo "ID account non valido: usa soltanto lettere, numeri, trattino o underscore." >&2
  exit 2
fi

# Si scrive soltanto nella cartella della skill, mai in quella dell'app
# desktop. La nuova configurazione si prepara in un temporaneo prima di
# chiedere la chiave; subito prima si toglie l'ID account precedente, cosi'
# un'interruzione lascia "chiave presente, ID mancante" invece della chiave
# nuova accanto all'ID di prima. Alla fine una rinomina atomica.
if ! temp_name="$(futuria_temp_name)"; then
  echo "Impossibile preparare il salvataggio della configurazione." >&2
  exit 2
fi
( umask 077 && mkdir -p -- "${config_dir}" )
# Senza "--": il chmod di macOS lo prenderebbe per un file. I percorsi sono
# assoluti, quindi non possono sembrare opzioni.
chmod 700 "${config_dir}"
temp_file="${config_dir}/${temp_name}"
trap 'rm -f -- "${temp_file}" 2>/dev/null || true' EXIT
( umask 077 && futuria_config_text "${location}" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "${temp_file}" )
rm -f -- "${config_file}"

echo "Il Portachiavi chiederà ora il Private Integration Token (PIT) con input nascosto. Incollalo e premi Invio."
# Con -w senza valore, `security` legge il segreto direttamente dal terminale:
# durante l'inserimento il PIT non diventa un argomento di processo.
security add-generic-password -U -a "${account}" -s "${service}" -w >/dev/null

stored_pit="$(security find-generic-password -a "${account}" -s "${service}" -w 2>/dev/null || true)"
if [[ ! "${stored_pit}" =~ ^pit-[A-Za-z0-9._-]+$ ]] || (( ${#stored_pit} < 10 || ${#stored_pit} > 2052 )); then
  unset stored_pit
  security delete-generic-password -a "${account}" -s "${service}" >/dev/null 2>&1 || true
  echo "La chiave privata non ha il formato atteso. Deve iniziare con pit-. Nessun valore è stato conservato." >&2
  exit 2
fi
unset stored_pit

mv -f -- "${temp_file}" "${config_file}"
chmod 600 "${config_file}"

echo "Configurazione salvata nel Portachiavi dell’utente macOS corrente."
echo "Puoi chiudere questa finestra e tornare all’agente."
