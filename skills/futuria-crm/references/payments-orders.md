# Payments & orders

Prefer the connected customer MCP specialised tools, then the catalog workflow in `references/mcp-operations.md`. The direct API paths and helper examples in this reference apply only to the explicitly chosen local PIT alternative; use actual MCP tool schemas for OAuth. Missing coverage never authorises a silent channel change.

Read payment activity from the user's Futuria CRM account. This area is **read-only** — you inspect and report, you do not move money.

## Endpoints (validated)

| Action | Request |
| --- | --- |
| List orders | `GET /payments/orders?altId={account id}&altType=location&limit=10` → `data[]`, `totalCount` |
| Read one order | `GET /payments/orders/{orderId}?altId={account id}&altType=location` |
| List transactions | `GET /payments/transactions?altId={account id}&altType=location&limit=10` → `data[]`, `totalCount` |

Note the family quirk: payments endpoints identify the account with `altId` + `altType=location`, not `locationId` (see the conventions table in `references/api-and-troubleshooting.md`).

## Working rules

- **Never initiate, refund, or alter a payment.** If the user wants to take a financial action, point them to the billing/payments section of their account and let them perform it. Report and summarise only.
- **Money is sensitive:** always state the currency, and don't round in a way that hides detail when reporting amounts.
- **Wallet vs orders:** account *usage credits* (wallet) are different from customer *orders/transactions*. If the user is asking about their own running costs, that is the wallet model in `references/terminology-and-voice.md`, not this area.

## Output example (Italian)

> Nel tuo account Futuria CRM, nel periodo 1–31 maggio 2026 risultano **14 transazioni** per un totale di € 3.880 (12 riuscite, 2 fallite). Vuoi il dettaglio di una in particolare?
