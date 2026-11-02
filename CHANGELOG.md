# Changelog

## 1.3.1 — 2026-11-02

- Moved the repository to the `Futuria-Marketing` GitHub organization: installation commands, plugin manifests and the privacy policy link now point to the new owner.
- No change to skills, scripts or permissions. Installations from earlier tags keep working through the GitHub redirect.

## 1.3.0 — 2026-10-14

- Removed the secondary skill, command, references and local Python tooling; the package installs only futuria-crm.
- Updated installation, capability descriptions, privacy, security and validation for the single-skill package.

- Added customer-only API v3 Social Planner instructions, platform payload fields, statistics, comments and Media Library verification.
- Documented secure-helper upload limits and web fallback without exposing the PIT.
- Added workflow/form/consent inspection, blog body and imported-article verification, and contact operations.
- Preserved exact publication/deletion authorization and reconciliation after uncertain writes.
- Corrected wallet guidance to use verified account amounts, currency and recharge settings.
- Retained the single-account API model and shared Codex/Claude instructions.


## 1.2.1 — 2026-08-03

- Updated the guided setup to recommend selecting every available scope when the user wants the agent to use all supported Futuria CRM functions.
- Clarified that omitted scopes limit the corresponding agent actions.
- Reduced the wizard typography scale while preserving layout, interactions and accessibility.

## 1.2.0 — 2026-08-03

- Added a guided local credential wizard for Windows and macOS, with a three-step visual accordion and real Futuria CRM screenshots.
- The wizard accepts the account URL, extracts the account ID, verifies the connection read-only and stores the credential with Windows DPAPI or macOS Keychain.
- Added loopback-only session isolation, CSRF protection, no-store headers, request limits and cross-platform tests; the private key never enters chat, process arguments or wizard logs.
- Isolated Windows PowerShell module discovery so DPAPI storage remains reliable when the agent starts from PowerShell 7.
- Kept the protected PowerShell and Terminal prompts as automatic fallback when Node.js is unavailable.

## 1.1.0 — 2026-07-31

- First formally tagged public release.
- Shared Futuria CRM instructions for Codex and Claude Code.
- Protected PIT setup through Windows DPAPI or macOS Keychain.
- Bundled API helpers that keep the PIT out of chat and agent command arguments.
- Public installation, privacy and security documentation.
- Native Codex marketplace metadata plus the Claude Code marketplace.

## 1.0.0 — 2026-07-07

- Initial API-first, single-account and white-label release on `main`.
- Human confirmation gates for messages, publications and destructive actions.
- Manifest version published without a formal Git tag or GitHub Release.
