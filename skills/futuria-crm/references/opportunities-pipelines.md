# Opportunities & pipelines

Prefer the connected customer MCP specialised tools, then the catalog workflow in `references/mcp-operations.md`. The direct API paths and helper examples in this reference apply only to the explicitly chosen local PIT alternative; use actual MCP tool schemas for OAuth. Missing coverage never authorises a silent channel change.

Track deals through the sales pipelines of the user's Futuria CRM account. Base URL and headers in `references/api-and-troubleshooting.md`.

## Endpoints (validated)

| Action | Request |
| --- | --- |
| List pipelines + stages | `GET /opportunities/pipelines?locationId={id}` → `pipelines[]` with stage ids/names. **Read this first** |
| Search opportunities | `GET /opportunities/search?location_id={id}&limit=20` — **snake_case `location_id`**: camelCase here returns 422. Optional `pipeline_id`, `pipeline_stage_id`, `status`, `q`, `contact_id`; pagination info in `meta` |
| Read one | `GET /opportunities/{opportunityId}` → `{opportunity}` |
| Update | `PUT /opportunities/{opportunityId}` — body camelCase: `pipelineStageId`, `status`, `monetaryValue`, `assignedTo`, `name`… |
| Change status only | `PUT /opportunities/{opportunityId}/status` — body `{"status": "open" \| "won" \| "lost" \| "abandoned"}` |

Quirk worth remembering: the **search** endpoint speaks snake_case, the **write** bodies speak camelCase.

## Working rules

- **Resolve the pipeline first.** Stage ids only make sense within a pipeline — always read pipelines before moving an opportunity, so you use the correct stage id.
- **Status vs stage.** "Stage" is the position in the pipeline; "status" is open / won / lost / abandoned. Be explicit about which you are changing.
- **Money fields:** confirm the currency and amount with the user before changing a value.
- **Write safety:** read the opportunity → apply the smallest change → re-read → report the new stage/status and the opportunity id, in Italian.

## Output example (Italian)

> Nella pipeline **Vendite 2026** del tuo account Futuria CRM ho spostato l'opportunità **Preventivo Rossi** dallo stage *Contatto iniziale* a *Proposta inviata* e impostato il valore a € 2.400. Ho riletto l'opportunità per conferma.
