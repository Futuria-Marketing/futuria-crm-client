# Futuria CRM customer plugin

Public customer plugin with one runtime-neutral skill for Codex and Claude Code. Hosted customer MCP with OAuth is preferred; bundled protected local PIT helpers remain an explicit alternative. The internal agency connector is a different product.

## Rules

- Product source in this repository is canonical; do not fork skill business logic by runtime.
- Portable root `plugin.json` and `mcp.json` follow Agent Plugins 1.0. Keep compatibility manifests aligned, including the different portable and compatibility MCP transport names.
- Never add customer data, tokens, local credential files or realistic secret examples. Never invent registered connector IDs or distribute an updater/installation daemon.
- Customer-facing text always calls the platform `Futuria CRM`.
- Prefer connected customer MCP tools. Missing OAuth scope or capability does not authorize a silent change to PIT. Never retry an uncertain write through another channel.
- Preserve bundled secure PIT helpers and the state directory separate from the desktop app. Never teach an agent to print or pass a token in a command.
- Align root, Claude, Codex, versioned marketplace entries and skill `VERSION` on release. Git marketplaces follow `stable`; tagged release archives are immutable snapshots.
- Run `python scripts/validate-plugin.py`, `python -m unittest discover -s tests -p "test_*.py"`, and the existing Node credential/state suites before release.

## Schema compatibility note (2026-11-04)

OpenAI's current package documentation describes OAuth declarations in each MCP server's `extensions.com.openai.auth`. The published Agent Plugins 1.0 MCP JSON schema and the actual native Codex 0.160.1 plugin loader reject that `extensions` property (`unknown field extensions, expected url or headers`). The distributed `mcp.json` therefore contains only the standard Streamable HTTP type and protected customer endpoint URL; do not add an invented alternative auth field. The server advertises OAuth through its authentication challenge and authorization metadata. Public-directory submission must separately configure OAuth in the portal and satisfy that platform's connection review. Root `plugin.json` and the complete base `mcp.json` can be validated against their unmodified upstream schemas. Recheck the documentation/runtime discrepancy when either upstream changes.
