# Workflows, forms and consent

Prefer the connected customer MCP specialised tools, then the catalog workflow in `references/mcp-operations.md`. The direct API paths and helper examples in this reference apply only to the explicitly chosen local PIT alternative; use actual MCP tool schemas for OAuth. Missing coverage never authorises a silent channel change.

Use the secure API helpers and the user's configured account. Discover workflow IDs, field IDs and tag names from that account.

## Read and inspect

- Workflows: `GET /workflows/?locationId={location}`. Include the account parameter. Do not assume `GET /workflows/{id}` exposes the builder: if unavailable, use the authenticated workflow editor.
- Forms: `GET /forms/?locationId={location}`.
- Tags: `GET /locations/{location}/tags`; fields: `GET /locations/{location}/customFields`.
- For relevant workflows inspect trigger, conditions, tags written, waiting/reminder timing, entry/exit rules, suppression and active/draft status. A list of names alone does not prove what a workflow does.

Builder-only details require the authenticated web interface. Relative routes include `/v2/location/{location}/automation/workflows`, `/location/{location}/workflow/{workflowId}`, `/v2/location/{location}/form-builder/main` and `/v2/location/{location}/form-builder-v2/{formId}`. Resolve them on the user's CRM domain. Let the user complete login in the supported browser; do not install browser tooling or export authentication as an implicit task step.

## Consent audit

Read the existing consent field, consent tags and suppression/DND settings. When the agreed account model mirrors a consent field into tags, verify both directions: consent added must add the corresponding tag; consent removed must remove it. Eligible segments should enforce consent together with the appropriate segment criterion. Use actual field/tag values rather than creating sample names automatically.

Do not infer consent from the existence of a contact, an import, a purchase or a message. Do not remove DND, grant consent, enqueue contacts or activate a workflow without authorization for that actual effect. Keep new workflows in draft unless activation is part of the user's mandate. Editing a template does not prove that an existing workflow action uses the edited body: inspect that action's stored content before reporting alignment.

Report observed configuration, missing evidence and gaps separately. After an authorized edit, re-read the actual builder/object and verify active state and affected conditions. A configuration audit is not a legal certification or a delivery test.
