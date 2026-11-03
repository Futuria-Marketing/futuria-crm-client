# Getting started — protected connection and verification

Use this reference when the agent must connect the user's Futuria CRM account for the first time or diagnose missing credentials.

## 1. Connection model

The account uses two distinct values:

| Value | Purpose | Secret? |
| --- | --- | --- |
| Private Integration Token (PIT), shown as **private connection key** | Authorises API requests; starts with `pit-` | Yes |
| Account id | Identifies the user's Futuria CRM account | No |

Preferred storage:

- Windows: private key encrypted with Windows DPAPI for the current user; account id in local config.
- macOS: private key in macOS Keychain; account id in local config.
- Linux or automated environments: environment variables as an explicit fallback.

Never ask the user to paste the private key in chat, a prompt, a shell command, a file in the workspace, or an issue. Never retrieve it merely to inspect or mask it.

## 2. Guided setup for a non-technical user

Resolve the launcher relative to this skill directory. It opens a temporary graphical configurator on `127.0.0.1`, outside the chat capture. The page is a single form with two fields, the Futuria CRM account URL and the private key; next to each field a help button opens a short guide (for the key: a video and three screenshots). It verifies the connection read-only and stores the private key with the operating system.

The configurator runs in a separate process (on Windows it is created outside the agent's job object). The launcher waits until it is listening, prints the page address and returns; if the configurator cannot start, the launcher exits with an error. If the browser did not open, give the user the printed address. The page stays available while it is open and visible; the configurator closes by itself a few seconds after a successful connection, after 45 minutes without activity, or after 3 hours in any case.

If the Windows launcher prints a line starting with `Attenzione: configuratore avviato senza WMI`, the configurator could not leave the agent's job and may close when the command ends. If the page then reports that it has closed, run the launcher again outside the sandbox or with elevated permissions.

If the user reports that the page says the configurator has closed, do not assume the outcome: first run the status check below. If the private key is present, run the first sanity read (section 3); run the launcher again only if the key is missing or the read fails.

If the page says it is no longer connected to the configurator and asks to be reloaded, the user reloads it; if the message stays, run the launcher again.

If the Windows launcher says that PowerShell runs in a restricted mode because of company policies (Constrained Language Mode), the protected setup cannot work on that computer: do not retry, and ask the user to contact Futuria support.

### Windows

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<skill-dir>\scripts\launch-credential-setup.ps1"
```

Status check, which never returns the private key:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<skill-dir>\scripts\setup-credentials.ps1" -Status
```

### macOS

```bash
bash "<skill-dir>/scripts/launch-credential-setup.sh"
```

Status check:

```bash
bash "<skill-dir>/scripts/setup-credentials.sh" status
```

### Automatic fallback

If Node.js is unavailable, the launcher opens the protected native prompt in a separate PowerShell or Terminal window. The secret input remains hidden and does not enter the agent-visible command.

Do not install Node.js solely for this wizard without informing the user first.

### Environment fallback

Advanced users and non-interactive environments may provide `FUTURIA_CRM_TOKEN` plus `FUTURIA_CRM_LOCATION`. The user must set them personally outside the conversation. Do not propose a command containing their real values and do not write them into shell profiles on their behalf.

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

This removes only the local copy. Revoking the private key itself is a separate action in the user's Futuria CRM account.

## 5. Version check

Read the installed version from `<skill-dir>/VERSION`. Before a new setup, or when the user asks about updates, compare it with the latest stable GitHub Release. Inform the user when an update exists; do not silently overwrite an installed copy or discard local changes.

## 6. Reporting

- Always reply in Italian and call the platform Futuria CRM.
- Report whether protected credentials are present; never report their value or prefix.
- Report the installed version from `VERSION`.
- After a write, report the exact fields changed, the object identifier, and the verification surface.
