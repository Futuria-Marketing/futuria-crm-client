# Customer MCP — operation discovery and execution

Use exposed specialised tools first. The existing customer tool families cover contacts, conversations, opportunities, calendars, account metadata, blogs and read-only orders/transactions. The established set has 38 tools; the catalog adds four when that server version is deployed. Count and documentation do not prove every tool is available in the current session or allowed by the current OAuth grant. Follow actual schemas rather than direct API examples.

## Catalog path

1. **`crm_search_operations`** searches documented operations without calling the CRM. Search narrowly by need/domain/mode and follow `next_offset` if paginated (at most 25 per page). `executable_only` filters dispatcher support; it is not a granted-scope filter.
2. **`crm_describe_operation`** reads the selected `operation_id`: method, resource path, required parameters/body, scopes, source, beta flags, `executable` and `unavailableReason`. When abbreviated, use `schema_path` with the returned JSON Pointer / `$expand` to load the necessary branch. Do not invent omitted required fields.
3. **`crm_read_operation`** executes a catalogued read. Build `input.path`, `input.query`, `input.headers` and `input.body` only as described. Account context comes from the authenticated customer connection: do not add an agency selector, arbitrary account ID or Authorization header. A POST operation can be a read only when the descriptor classifies it as such.
4. **`crm_write_operation`** executes a real mutation. Use only within the user's authorisation. Its schema requires `write_confirmed`, `preflight` and `verification`; these are execution controls, not a substitute for user authorisation. Set `write_confirmed: true` only when the exact action and target are covered. Each read reference uses `operation_id` and the documented `input`; verification may include `expected` fields or `expect_absent` for authorised deletion. Choose reads that establish the target's current state and prove the changed fields, rather than a generic list of unrelated objects. Describe those reads too if unfamiliar.

Do not call a write operation with the read tool or bypass an unsupported descriptor using a raw request. OAuth scopes and feature access can still block a documented executable operation. Do not expand the task to obtain broader permissions. Offer a clear alternative choice using `references/mcp-onboarding.md` if necessary.

## Result interpretation

- Read `mutationApplied`, `verificationStatus` and any error/partial-result fields when returned. A mutation may have happened even if its verification failed.
- For `response_truncated`, use documented pagination for reads; never repeat a mutation to obtain a smaller response.
- If creation or update has an uncertain result, search by stable object identity before any retry. Stop if you cannot establish whether it happened.
- Verify the resulting object through the appropriate detail/list tool or visible CRM asset. Catalog execution acceptance does not prove publication, delivery or completion.
- Never retry an uncertain write through a specialised tool, local PIT helper or the web interface. Missing scopes require a decision, not a hidden fallback.

The account is bound by the hosted customer's OAuth context. This procedure does not grant agency access or authorise account switching. Payments and orders remain read-only under this skill, even if a broader documented catalog exposes write operations.
