# Conversations & messaging

Prefer the connected customer MCP specialised tools, then the catalog workflow in `references/mcp-operations.md`. The direct API paths and helper examples in this reference apply only to the explicitly chosen local PIT alternative; use actual MCP tool schemas for OAuth. Missing coverage never authorises a silent channel change.

Read and send messages in the user's Futuria CRM account (the unified conversations inbox). Base URL and headers in `references/api-and-troubleshooting.md`.

## Endpoints (validated)

| Action | Request |
| --- | --- |
| Find conversations | `GET /conversations/search?locationId={id}&limit=20` — optional `contactId`, `query` → `conversations[]`, `total` |
| Read messages | `GET /conversations/{conversationId}/messages?limit=20` → `messages.{lastMessageId, nextPage, messages[]}` (paginate with `lastMessageId`) |
| Send a message | `POST /conversations/messages` — body `{"type": "SMS" \| "Email" \| "WhatsApp" \| "IG" \| "FB" \| "Live_Chat", "contactId": "...", "message": "<testo>"}`; email adds `subject`/`html`. On `422` the `message` array names the missing channel fields |

## Working rules

- **Sending is an outbound action to a real person.** Confirm the recipient, the channel, and the exact text with the user before sending, unless they have clearly authorised this specific send.
- **Channel matters.** A conversation can span SMS, WhatsApp, email, and more. Confirm which channel you are sending on — usage cost and tone differ (see the wallet model in `references/terminology-and-voice.md`).
- **Read before reply.** Pull recent messages so your reply has context; don't answer blind.
- **No bulk blasts here.** This surface is for individual conversation messages, not newsletters. Mass email is a marketing feature with its own usage cost.

## Drafting replies

- Match the language and tone of the incoming message.
- Keep the platform name as **Futuria CRM** if it ever comes up; never expose a vendor name to the end recipient either.

## Output example (Italian)

> Ho trovato la conversazione con **Luca Verdi** (canale WhatsApp) nel tuo account Futuria CRM. Ho preparato questa risposta — confermi l'invio?
> «Buongiorno Luca, confermo l'appuntamento di giovedì alle 15. A presto!»
