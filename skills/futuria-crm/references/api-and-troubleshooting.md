# Direct API — foundation & troubleshooting

The direct API is the **explicit local PIT alternative**. Use this foundation and error matrix only after the user chooses that path. OAuth customer MCP remains preferred; its tool schemas differ from the endpoint examples below. Missing OAuth scope does not authorise a silent fallback or retry of an uncertain write.

> **Technical-host note.** The platform's underlying technical host may appear only in this reference and in the bundled API helpers, because it is part of real endpoint URLs and error payloads. It is infrastructure, not a brand: **never surface the host name to the user, and never use it as the name of the platform.** To the user, everything here is **Futuria CRM**. See `references/terminology-and-voice.md`.

## Secure request rules

- Base URL: `https://services.leadconnectorhq.com` — every path in the area references is relative to it.
- Use the bundled helper for every API request. It loads the PIT internally from Windows DPAPI, macOS Keychain, or the environment fallback, reads the account id from the skill's own folder, and accepts only relative paths on the fixed Futuria CRM API host. Only after an update, while the skill's files from versions up to 1.3.2 cannot be copied into that folder (for example inside a sandbox), it reads those files read-only from the old folder shared with the desktop app; it never uses the app's own files. When something is missing it stops before any request with one of the coded messages below.
- The helper adds the Authorization, Version and Accept headers. It adds the JSON content type on writes. It defaults to the validated V2 date header used by the endpoint tables; pass `-Version v3` on Windows or set `FUTURIA_CRM_API_VERSION=v3` on macOS only for an endpoint whose reference explicitly requires V3.
- Never construct or display a raw Authorization header in the conversation.

Windows:

```powershell
& "<skill-dir>\scripts\crm-api.ps1" -Method GET -Path "/locations/{location}"
```

macOS:

```bash
bash "<skill-dir>/scripts/crm-api.sh" GET "/locations/{location}"
```

Use `{location}` wherever an endpoint requires the account id; the helper replaces it without exposing the PIT. On Windows use `-Body` or `-BodyFile` for JSON. On macOS pass a small JSON body as the third argument.

## Parameter conventions per endpoint family (validated)

The account id parameter is **not uniform** across families — this table prevents the most common 422s:

| Family | How the account id is passed |
| --- | --- |
| Contacts search | JSON body: `"locationId": "..."` |
| Contacts create/upsert | JSON body: `"locationId": "..."` |
| Conversations, calendars, blogs, emails, tags, custom fields | query string: `?locationId=...` |
| **Opportunities search** | query string **snake_case**: `?location_id=...` — `locationId` here returns `422 property locationId should not exist` |
| **Payments** | query string: `?altId=<account id>&altType=location` |
| Social posting | in the path: `/social-media-posting/{locationId}/...` |

Other validated quirks:

- `GET /calendars/events` requires `startTime`/`endTime` in **epoch milliseconds** and **one of** `calendarId`, `userId` or `groupId` — omitting all three returns `422 Either of userId, calendarId or groupId is required`.
- `POST /social-media-posting/{locationId}/posts/list` wants `skip`/`limit` as **strings** (`"0"`, `"10"`), not numbers.
- Email templates live under `GET /emails/builder` — a `/emails/templates` path does **not** exist (404).

## Pagination patterns

- **Contacts search:** `pageLimit` (≤ 100 recommended) + cursor — each returned contact carries a `searchAfter` array; pass the last one as `"searchAfter"` in the next request body until you reach `total`.
- **Blogs, authors, categories, emails builder:** `limit` + `offset` query params.
- **Blog sites:** `limit` + `skip`.
- **Payments:** `limit` + `offset`, response has `totalCount`.
- Insert a short pause (~100–150 ms) between pages on bulk reads: the API enforces burst rate limits.

## Credential and account diagnostics

1. Run the protected setup script with `-Status` on Windows or `status` on macOS. It never prints values: on Windows it checks that the private key can really be decrypted for this user, on macOS that the Keychain entry exists, without reading it (`presente`, `mancante`, `non leggibile` on Windows, `non accessibile` on macOS); it checks that the stored account id is valid, says when the account must be connected again (`Serve ricollegare l'account`), and exits with 0 only when both are present.
2. Confirm that the account id is separate from the PIT and is passed where the endpoint family requires it.
3. Probe one low-risk read (`GET /locations/{location}`, else `POST /contacts/search` with `pageLimit` 1) through the helper and classify the result before changing credentials or code.
4. Do not retrieve the PIT for visual inspection, even in masked form.

### Helper messages before any request

The helpers print one of these messages (in ASCII, the same on Windows and macOS apart from the launcher name) and stop without calling the API. Recognise them by the code at the start, then explain the situation to the user in plain Italian.

| Code | Meaning | What to do |
| --- | --- | --- |
| `[futuria-crm:credenziali-mancanti]` | Neither the private key nor the account id is stored (on Linux: environment variables not set) | Run the launcher (`launch-credential-setup.ps1` or `.sh`); on Linux ask the user to set the variables personally |
| `[futuria-crm:id-mancante]` | Private key present, account id missing | Run the launcher once and ask the user to connect the account again; expected once after updating to 1.3.3 for users of the desktop app |
| `[futuria-crm:chiave-mancante]` | Account id present, private key missing | Run the launcher once |
| `[futuria-crm:chiave-non-leggibile]` | Windows: the key file exists but cannot be decrypted for this Windows user | Run the launcher and connect again; do not delete files by hand |
| `[futuria-crm:portachiavi-non-accessibile]` | macOS: the Keychain is locked or blocked by the agent's sandbox | Ask the user to unlock it, or run the command outside the sandbox; do not reopen the configurator |
| `[futuria-crm:cartella-non-valida]` | `USERPROFILE` (Windows) or `HOME` (macOS) is empty or not an absolute path | Run the helper from a normal user session; do not set the variable on the user's behalf |
| `[futuria-crm:usa-powershell]` | A `.sh` helper was started from Git Bash on Windows | Use the `.ps1` helper with PowerShell |
| `[futuria-crm:copia-rimandata]` | Warning only: the files of the previous version could not be copied into the new folder, so they were read read-only | No action; the copy is retried on the next run |
| `[futuria-crm:rimozione-incompleta]` | Printed by the removal (`-Remove` or `remove`), not by the API helper: some local files could not be removed (a program is using them), or on macOS the Keychain is locked | Ask the user to close the programs using the files or unlock the Keychain, then run the removal again |

## Error matrix

### 401 Unauthorized
- Token invalid, expired, revoked, or wrong scope.
- Confirm the helper is using the expected protected credential source.
- If the user has just connected the account again, check that every agent on the computer runs plugin 1.3.3 or later: an installation still on 1.3.2 writes into the old folder, so the updated one may keep using the previous key or account id. The status check reports this case.
- Do not assume the requested object is missing until the token is verified.
- User-facing: "errore di autorizzazione sul tuo account Futuria CRM" — never name the host.

### 403 Forbidden
- Token is valid but lacks access to the requested resource: the integration token may not include that area's permissions.
- User-facing: suggest asking il referente Futuria to extend the token's permissions for that area.

### 404 Not Found
- Object id wrong or already deleted — but also returned for a **wrong path** (e.g. `/emails/templates`). Re-check the endpoint against the area reference before concluding the object is gone.

### 422 Unprocessable Entity
- Request shape incomplete or invalid. Read the `message` array — it names the offending fields.
- First suspects: account id passed in the wrong form for that family (see the conventions table) or a family-specific quirk (epoch ms, string skip/limit).
- Some list endpoints enforce small `limit` values — reduce the limit before changing auth assumptions.

### 429 Too Many Requests
- Respect Retry-After and use bounded backoff for reads; slow pagination. Do not blindly retry a creation or send with an uncertain result: reconcile the resulting object first. Stop when the outcome or authorization is unresolved.

### 200 OK but no visible change
- Treat as partial/no-op until independently verified.
- Re-read through the canonical surface: API detail/list for metadata, the public page for published content, the web interface for builder-only internals.

## Custom field folders (contacts)

- Create a folder: `POST /locations/{locationId}/customFields` with `{ "name": "<folder>", "model": "contact", "documentType": "folder", "position": <n> }`. Success key is `customFieldFolder`.
- Link a field to a folder: `PUT /locations/{locationId}/customFields/{id}` including the field details plus `"parentId": "<folder id>"`.
- The list endpoint exposes `parentId`, not `folderId`. If create returns `400 Folder already exists`, reuse `meta.existingId` from the body.

## Reporting

After any API work, report in Italian what you did and which area it touched — described as Futuria CRM — without exposing the host or any vendor name.
