# Changelog

## 1.3.2 — 2026-11-03

Correzione dell’errore «NetworkError when attempting to fetch resource» che compariva premendo «Conferma e collega» nel configuratore.

**Causa.** La pagina provava a inviare la chiave a un configuratore locale che nel frattempo si era chiuso. Poteva succedere in tre modi:

- la sessione durava 30 minuti fissi, anche con la pagina aperta, mentre il cliente era nel CRM a creare la chiave;
- l’agente poteva chiudere il configuratore alla fine del comando o del turno: su Windows `Start-Process` lasciava il processo dentro il job dell’agente, su macOS `nohup … &` lo lasciava nel suo gruppo di processi;
- un errore durante il salvataggio, per esempio PowerShell o `security` che chiudevano la pipe in anticipo, o un’eccezione non gestita in una richiesta, faceva cadere il server.

**Correzione.**

- La sessione resta aperta finché la pagina è aperta: la pagina manda un segnale ogni 60 secondi a una nuova verifica `status`, e il configuratore si chiude solo dopo 45 minuti senza richieste oppure pochi secondi dopo un collegamento riuscito.
- Il configuratore parte in un processo separato (`--detach`), indipendente dall’agente. Su macOS nasce in una nuova sessione. Su Windows il launcher lo crea tramite WMI, fuori dal job dell’agente, e usa `Start-Process` solo se WMI non è disponibile: `--detach` da solo non basta a uscire dal job.
- Gli errori di salvataggio e le richieste malformate ricevono una risposta di errore e il configuratore resta attivo.
- Se il configuratore si chiude comunque, la pagina lo dice subito in italiano, disattiva il pulsante e chiede di riaprirlo dall’agente; la chiave non resta nella pagina.

**Video più visibile.** In cima alla guida c’è il video di 29 secondi su come creare la chiave, con il link alla guida online; anche «Serve aiuto?» porta a quella guida. La pagina accetta immagini e video soltanto da `futuriamarketing.com`.

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
