# Getting started — protected connection and verification

Use this reference when the agent must connect the user's Futuria CRM account for the first time or diagnose missing credentials.

## 1. Connection model

The account uses two distinct values:

| Value | Purpose | Secret? |
| --- | --- | --- |
| Private Integration Token (PIT), shown as **private connection key** | Authorises API requests; starts with `pit-` | Yes |
| Account id | Identifies the user's Futuria CRM account | No |

Preferred storage:

- Windows: private key encrypted with Windows DPAPI for the current user, plus the account id, in the skill's own folder `%USERPROFILE%\.futuria-crm-skill\`.
- macOS: private key in macOS Keychain; account id in `~/Library/Application Support/com.futuriamarketing.futuria-crm-skill/config.json`.
- Linux or automated environments: environment variables as an explicit fallback.

The skill folder is separate from the Futuria CRM desktop app, whose folder (`%APPDATA%\Futuria CRM`, `~/Library/Application Support/Futuria CRM`) versions up to 1.3.2 also used. On the first status check or API call after an update, the helpers copy the skill's own files from that old folder into the new one and never modify the app's files. If the copy is not possible (for example inside a sandbox), they read the old files read-only and retry next time; this needs no action from you or the user.

Never ask the user to paste the private key in chat, a prompt, a shell command, a file in the workspace, or an issue. Never retrieve it merely to inspect or mask it.

## 2. Guided setup for a non-technical user

Resolve the launcher relative to this skill directory. It opens a temporary graphical configurator on `127.0.0.1`, outside the chat capture. The page is a single form with two fields, the Futuria CRM account URL and the private key; next to each field a help button opens a short guide (for the key: a video and three screenshots). It verifies the connection read-only and stores the private key with the operating system.

The configurator runs in a separate process (on Windows it is created outside the agent's job object). The launcher waits until it is listening, prints the page address and returns; if the configurator cannot start, the launcher exits with an error. If the browser did not open, give the user the printed address. The page stays available while it is open and visible; the configurator closes by itself a few seconds after a successful connection, after 45 minutes without activity, or after 3 hours in any case.

If the Windows launcher prints a line starting with `Attenzione: configuratore avviato senza WMI`, the configurator could not leave the agent's job and may close when the command ends. If the page then reports that it has closed, run the launcher again outside the sandbox or with elevated permissions.

If the user reports that the page says the configurator has closed, do not assume the outcome: first run the status check below, then follow the first matching branch:

1. Private key and account id both present: run the first sanity read (section 3); run the launcher again only if the read fails.
2. Private key present but account id missing (the status prints `Serve ricollegare l'account`): run the launcher once and ask the user to connect the account again. Do not run a sanity read first: without the account id it cannot work. This is expected once after updating to 1.3.3 for users who also use the Futuria CRM desktop app.
3. Private key missing, or both missing: run the launcher.

If the status says the key is not readable (Windows) or the Keychain is not accessible (macOS), see the message table in `references/api-and-troubleshooting.md` before reconnecting.

If the page says it is no longer connected to the configurator and asks to be reloaded, the user reloads it; if the message stays, run the launcher again.

If the Windows launcher says that PowerShell runs in a restricted mode because of company policies (Constrained Language Mode), the protected setup cannot work on that computer: do not retry, and ask the user to contact Futuria support.

### Windows

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<skill-dir>\scripts\launch-credential-setup.ps1"
```

Status check, which never returns the private key. It checks that the key can really be decrypted for this Windows user and that the account id is valid, prints `Chiave privata protetta: presente|mancante|non leggibile` and `ID account: presente|mancante`, adds `Serve ricollegare l'account` when only the account id is missing, and exits with 0 only when both are valid:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<skill-dir>\scripts\setup-credentials.ps1" -Status
```

### macOS

```bash
bash "<skill-dir>/scripts/launch-credential-setup.sh"
```

Status check, with the same lines as on Windows (the key state can also be `non accessibile` when the Keychain is locked or blocked by a sandbox):

```bash
bash "<skill-dir>/scripts/setup-credentials.sh" status
```

If the status prints `Un'altra installazione del plugin non aggiornata usa ancora la vecchia cartella`, another agent on the same computer still runs version 1.3.2 or earlier: tell the user to update the plugin there too and restart its sessions.

### Automatic fallback

If Node.js is unavailable, the launcher opens the protected native prompt in a separate PowerShell or Terminal window. The secret input remains hidden and does not enter the agent-visible command.

Do not install Node.js solely for this wizard without informing the user first.

### Environment fallback

Advanced users and non-interactive environments may provide `FUTURIA_CRM_TOKEN` plus `FUTURIA_CRM_LOCATION` (`FUTURIA_CRM_LOCATION_ID` is accepted as an alternative name for the account id). The user must set them personally outside the conversation. Do not propose a command containing their real values and do not write them into shell profiles on their behalf. Environment values take precedence over the protected storage; the helpers read the skill folder only for a value the environment does not provide.

## 3. First sanity read

Use the secure helper; never build a raw Authorization header in the conversation.

Windows:

```powershell
& "<skill-dir>\scripts\crm-api.ps1" -Method GET -Path "/locations/{location}"
```

macOS:

```bash
bash "<skill-dir>/scripts/crm-api.sh" GET "/locations/{location}"
```

If the account endpoint fails for scope reasons, fall back to a one-contact read:

Windows:

```powershell
& "<skill-dir>\scripts\crm-api.ps1" -Method POST -Path "/contacts/search" -Body '{"locationId":"{location}","pageLimit":1,"filters":[]}'
```

macOS:

```bash
bash "<skill-dir>/scripts/crm-api.sh" POST "/contacts/search" '{"locationId":"{location}","pageLimit":1,"filters":[]}'
```

Confirm in Italian only the account name and the successful connection. If both reads fail, classify the HTTP response with `references/api-and-troubleshooting.md` before changing credentials.

## 4. Removing local credentials

Windows:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<skill-dir>\scripts\setup-credentials.ps1" -Remove
```

macOS:

```bash
bash "<skill-dir>/scripts/setup-credentials.sh" remove
```

This removes the skill folder and the copies left by versions up to 1.3.2 in the desktop app's folder, recognised by their structure; it never removes the desktop app's own files or that folder. If the desktop app is open, the old copy of the account id stays until the app is closed and the removal is repeated (the output says so). If the user also uses the desktop app, the account id may remain inside the app's own configuration file, which the skill does not modify.

This removes only the local copy. Revoking the private key itself is a separate action in the user's Futuria CRM account.

## 5. Version check

Read the installed version from `<skill-dir>/VERSION`. Before a new setup, or when the user asks about updates, compare it with the latest stable GitHub Release. Inform the user when an update exists; do not silently overwrite an installed copy or discard local changes.

## 6. Reporting

- Always reply in Italian and call the platform Futuria CRM.
- Report whether protected credentials are present; never report their value or prefix.
- Report the installed version from `VERSION`.
- After a write, report the exact fields changed, the object identifier, and the verification surface.
