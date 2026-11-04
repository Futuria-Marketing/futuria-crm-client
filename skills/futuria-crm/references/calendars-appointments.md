# Calendars & appointments

Prefer the connected customer MCP specialised tools, then the catalog workflow in `references/mcp-operations.md`. The direct API paths and helper examples in this reference apply only to the explicitly chosen local PIT alternative; use actual MCP tool schemas for OAuth. Missing coverage never authorises a silent channel change.

Read calendar activity and appointment notes from the user's Futuria CRM account. Base URL and headers in `references/api-and-troubleshooting.md`.

## Endpoints (validated)

| Action | Request |
| --- | --- |
| List calendars | `GET /calendars/?locationId={id}` → `calendars[]` (take the calendar ids here) |
| List events | `GET /calendars/events?locationId={id}&startTime={ms}&endTime={ms}&calendarId={calId}` — times in **epoch milliseconds**; **one of** `calendarId`, `userId`, `groupId` is required (422 otherwise). To cover the whole account, loop over the calendars list |
| Appointment detail | `GET /calendars/events/appointments/{eventId}` |
| Appointment notes | `GET /calendars/appointments/{appointmentId}/notes?limit=10&offset=0` — verify the response shape on first use |

Booking, moving or cancelling appointments (`POST /calendars/events/appointments`, `PUT /calendars/events/appointments/{eventId}`, `DELETE /calendars/events/{eventId}`) touches a real person's booking: confirm with the user first, and re-read after the write. If a write shape is unclear, prefer walking the user through the web interface.

## Working rules

- **Date ranges:** always pass an explicit range; convert dates to epoch milliseconds and use the account's timezone (it is in the account card, `GET /locations/{id}`).
- **Cross-reference contacts:** an appointment usually links to a contact — use the contact reference if the user wants the full picture.
- **Calendar configuration** (availability, team members) is builder territory: read what the API returns, but send configuration changes to the web interface.

## Output example (Italian)

> Nel tuo account Futuria CRM, questa settimana risultano **3 appuntamenti**: lun 10:00 con M. Bianchi, mer 15:00 con L. Verdi, ven 09:30 (slot libero). Vuoi che apra le note di uno di questi?
