# Changelog

## 1.3.2 — 2026-11-03

Correzione dell’errore «NetworkError when attempting to fetch resource» che compariva premendo «Conferma e collega» nel configuratore.

**Causa.** La pagina provava a inviare la chiave a un configuratore locale che nel frattempo si era chiuso. Poteva succedere in tre modi:

- la sessione durava 30 minuti fissi, anche con la pagina aperta, mentre il cliente era nel CRM a creare la chiave;
- l’agente poteva chiudere il configuratore alla fine del comando o del turno: su Windows `Start-Process` lasciava il processo dentro il job dell’agente, su macOS `nohup … &` lo lasciava nel suo gruppo di processi;
- un errore durante il salvataggio, per esempio PowerShell o `security` che chiudevano la pipe in anticipo, o un’eccezione non gestita in una richiesta, faceva cadere il server.

**Correzione.**

- La sessione resta aperta finché la pagina è aperta e in vista: la pagina manda un segnale ogni 60 secondi a una nuova verifica `status`, protetta dal cookie di sessione. Il configuratore si chiude pochi secondi dopo un collegamento riuscito, dopo 45 minuti senza richieste autenticate (anche una scheda nascosta e dimenticata smette di tenerlo attivo) e comunque dopo 3 ore.
- Il configuratore parte in un processo separato (`--detach`), indipendente dall’agente. Chi lo avvia aspetta che sia davvero in ascolto, stampa l’indirizzo della pagina e, se non parte (per esempio porta occupata), esce con un errore invece di dire che è aperto. Su macOS nasce in una nuova sessione. Su Windows il launcher lo crea tramite WMI, fuori dal job dell’agente, con un tempo massimo di attesa; usa `Start-Process` solo se WMI non funziona e in quel caso lo scrive nell’output, perché il configuratore potrebbe chiudersi alla fine del comando.
- Gli errori di salvataggio, le richieste malformate e un browser che non si apre non fanno cadere il configuratore.
- Se il configuratore si chiude comunque, la pagina lo dice subito in italiano, disattiva il pulsante e svuota il campo della chiave. Prima di inviare la chiave la pagina controlla che il configuratore risponda: se è già chiuso la chiave non lascia la pagina e l’avviso dice che non è stato salvato nulla. Il messaggio dice il vero in ogni caso: se la chiusura avviene durante l’invio avvisa che la chiave potrebbe essere stata salvata e chiede all’agente di verificare; se il collegamento è stato completato in un’altra scheda, mostra il collegamento riuscito; se la pagina ha perso la sessione, chiede di ricaricarla. Con una guida aperta, la guida si chiude e l’avviso riceve il focus.
- Alla chiusura il configuratore non accetta più richieste nemmeno sulle connessioni già aperte: un collegamento in corso finisce, poi il socket si chiude.
- Se il file con l’esito dell’avvio non si può scrivere, il launcher esce con un errore prima di avviare il configuratore, così non resta in ascolto un configuratore di cui nessuno conosce l’indirizzo. Su Windows il launcher non avvia più un secondo configuratore quando il primo è ancora in partenza.
- In Constrained Language Mode di PowerShell (criteri aziendali) il launcher lo dice subito con un messaggio chiaro: in quella modalità la configurazione protetta non funziona.

**Modulo più protetto.** Il campo della chiave resta un campo password: la chiave è nascosta in ogni browser e i lettori di schermo non la leggono ad alta voce; il pulsante «Mostra» la rende visibile su richiesta. Il browser può proporre di salvarla nel proprio gestore delle password, e non serve accettare. Il modulo non può più essere inviato dal browser senza lo script della pagina, quindi la chiave non finisce mai nell’indirizzo o nella cronologia. Lo script della pagina funziona anche sui browser meno recenti, il focus da tastiera è ben visibile e, nei browser senza finestre di dialogo, «Dove trovo il link?» apre Futuria CRM invece della guida della chiave.

**Pagina più semplice.** La pagina mostra solo il modulo. Accanto a ciascun campo c’è un pulsante di aiuto, «Dove trovo il link?» e «Scopri dove trovare questa chiave», che apre una finestra di guida. Quella della chiave contiene il video di 29 secondi, i tre passaggi con le schermate, il pulsante «Apri Futuria CRM» e il link alla guida online. All’apertura la pagina non fa richieste esterne: anteprima e video arrivano da `futuriamarketing.com` solo quando il cliente apre la guida della chiave, e la pagina accetta soltanto quei due file.

**Requisiti più chiari.** Configuratore e README dicono che serve un’app installata sul computer che possa lavorare sui file: Claude Code oppure l’app ChatGPT per computer in modalità Work (Codex). claude.ai, chatgpt.com e la chat normale delle app non funzionano; Codex da terminale o in VS Code resta supportato. Se l’agente non può eseguire comandi e scrivere file sul computer dell’utente, INSTALL.md chiede all’agente di fermarsi e spiegarlo.

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
