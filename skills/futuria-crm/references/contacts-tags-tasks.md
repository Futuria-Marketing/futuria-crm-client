# Contacts, tags & tasks

Prefer the connected customer MCP specialised tools, then the catalog workflow in `references/mcp-operations.md`. The direct API paths and helper examples in this reference apply only to the explicitly chosen local PIT alternative; use actual MCP tool schemas for OAuth. Missing coverage never authorises a silent channel change.

Operate on people in the user's Futuria CRM account: contacts, their tags, tasks and notes. Base URL, headers and pagination in `references/api-and-troubleshooting.md`.

## Endpoints (validated)

| Action | Request |
| --- | --- |
| Search/list contacts | `POST /contacts/search` — body `{"locationId": "...", "pageLimit": 100, "filters": [], "query": "<testo>"}`; paginate with each contact's `searchAfter` cursor |
| Read one contact | `GET /contacts/{contactId}` → `{contact}` |
| Create | `POST /contacts/` — body includes `locationId` plus the fields |
| Update | `PUT /contacts/{contactId}` — send only the fields to change |
| Create-or-update | `POST /contacts/upsert` — body with `locationId` + unique key (email/phone). Prefer over blind create |
| Delete | `DELETE /contacts/{contactId}` — destructive: confirm first, snapshot before |
| Add / remove tags | `POST /contacts/{contactId}/tags` / `DELETE /contacts/{contactId}/tags` — body `{"tags": ["..."]}` |
| Tags existing in the account | `GET /locations/{locationId}/tags` |
| Contact tasks | `GET /contacts/{contactId}/tasks`; create with `POST /contacts/{contactId}/tasks` (`title`, `dueDate` ISO, `completed`) |
| Contact notes | `GET /contacts/{contactId}/notes`; create with `POST /contacts/{contactId}/notes` (`body`) |
| Custom fields of the account | `GET /locations/{locationId}/customFields` |

Write bodies not listed field-by-field here can vary: on a `422`, read the `message` array — it names the fields — and adjust.

## Working rules

- **Avoid duplicates.** Before creating, search by email or phone; if a match exists, use upsert or update instead of create.
- **Custom fields:** never assume a field exists because you saw it in an old export or template. Read the account's custom fields first and use the real field id.
- **Tags:** adding a tag creates it implicitly — read `GET /locations/{locationId}/tags` first and reuse the existing spelling instead of inventing near-duplicates.
- **Write safety:** read the contact → apply the smallest change → re-read to confirm → report the changed fields and the contact id, in Italian.

## Output example (Italian)

> Ho aggiornato il contatto **Maria Bianchi** nel tuo account Futuria CRM: aggiunto il tag `cliente-2026` e impostato il campo `Città = Padova`. Ho riletto la scheda per conferma.
