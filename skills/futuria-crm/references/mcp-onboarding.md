# Customer MCP — OAuth onboarding

Use the customer's **Futuria CRM** connection at:

`https://futuria-crm.account-futuria.workers.dev/mcp`

The portable root `mcp.json` declares the protected Streamable HTTP endpoint. The compatibility `.mcp.json` uses the client's HTTP transport form. OAuth is discovered through the server's authentication challenge and authorization metadata, then completed in the client. Neither manifest contains credentials or client secrets. The internal agency connector is a distinct surface and must not be substituted.

## Establish the connection

1. Confirm the full plugin is installed in the current client, not merely a copied skill. If remote MCP or OAuth is unsupported, explain this limit and offer the protected local alternative; do not change configuration silently.
2. Open the client's Futuria CRM connection controls and select **Connect / Sign in**. The user completes the protected OAuth page and grants the offered permissions. Never ask for credentials, authorization codes, callback URLs containing codes, or tokens in the conversation. Do not copy OAuth credentials into the PIT wizard.
3. Refresh the connection/tool list as the client requires. Inspect actual tool names and schemas. Plugin installation or successful MCP initialization alone is not authentication.
4. Run `crm_get_location` with its exposed schema if present. Read only the account identity needed to confirm the target. If that read is scope-restricted, an authorised minimal read such as a single-contact search can prove access to that resource, but cannot certify the unknown account name or unrelated scopes. Do not enumerate customer data merely to test connectivity.
5. Report the observed account, installed skill `VERSION`, successful read and remaining limit. If no authenticated read succeeds, the result is **not verified**, even when tools or a catalog are visible.

## Errors and missing capabilities

| Observation | Response |
| --- | --- |
| No Futuria CRM tools | Check installation/enabled connection and client support; do not switch to the agency connector. |
| Authentication expired / 401 | Reconnect through the client's OAuth flow. Never inspect token values or read local PIT storage. |
| Permission denied / 403 | Identify the denied resource or scope; reconnection only helps if the service offers the required grant. Explain the actual limitation. |
| Specialised tool absent | Discover and describe the catalog operation if the four catalog tools are exposed. Absence of both is a capability gap. |
| `executable: false`, beta or unsupported operation | Report the descriptor's reason. A catalog entry does not establish live support. |
| Timeout or uncertain write | Reconcile through a minimal read. Do not repeat the write or change channels until its result is known. |

If the desired operation lacks OAuth coverage, explain what cannot be done through the current connection. The user may choose to adjust the supported OAuth grant, use the CRM interface, or use the local protected PIT alternative where it provides the required function. Wait for that choice before starting PIT setup or using an existing PIT. Once selected, confirm the same target account and applicable permissions before proceeding. The alternative does not expand the user's authorisation.

## Local alternative and disconnect

Read `references/getting-started.md` only when PIT was chosen. Its local wizard and secure helpers remain included, with their state separate from the desktop Futuria CRM app. Preserve any existing setup and never print secrets or migrate them between channels.

Disconnecting or revoking OAuth is done through the client/service's connection controls. Removing local PIT storage, revoking the PIT in the CRM, uninstalling the skill and disconnecting OAuth are separate actions; do only the requested one. Choosing OAuth does not authorise deleting a prior local configuration.
