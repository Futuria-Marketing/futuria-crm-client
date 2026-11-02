# Installazione — istruzioni per l’agente

Questa procedura è destinata all’agente AI che riceve il link del repository. L’utente non deve scegliere manualmente il runtime né incollare credenziali nella chat.

## Obiettivo

1. Identificare se il runtime corrente è **Codex** o **Claude Code**.
2. Installare la release stabile del pacchetto Futuria CRM.
3. Aprire il configuratore grafico locale per il collegamento protetto.
4. Eseguire una verifica in sola lettura e comunicare soltanto nome account, versione ed esito.

Il collegamento usa API diretta e una credenziale chiamata **Private Integration Token (PIT)**. Nel configuratore viene indicata come **chiave privata di collegamento**. Questa release non installa né configura MCP.

## Regole di sicurezza

- Non chiedere mai all’utente di scrivere la chiave privata nella chat.
- Non inserirla mai in un comando, un argomento CLI, un file del progetto o un log.
- Avviare sempre il launcher incluso: apre una pagina locale temporanea fuori dalla conversazione.
- Non recuperare, stampare o mascherare la chiave privata.
- Prima della prima scrittura, verificare il nome dell’account con una lettura.

## Release stabile

Versione del pacchetto: `v1.3.1`. I comandi seguenti richiedono che il tag e la release `v1.3.1` siano pubblicati prima della distribuzione guidata.

Repository: `https://github.com/Futuria-Marketing/futuria-crm-client`.

## Claude Code

Per l’installazione eseguita direttamente dall’agente, usare il percorso personale ufficiale delle skill di Claude Code:

1. Destinazione: `~/.claude/skills/futuria-crm-client`.
2. Se la cartella non esiste, clonare `https://github.com/Futuria-Marketing/futuria-crm-client.git` alla release `v1.3.1` con cronologia ridotta.
3. Se esiste già, verificare prima che sia la copia di questo repository e che non contenga modifiche locali; solo in quel caso aggiornare al tag `v1.3.1`. Non cancellare o sovrascrivere una cartella ambigua.
4. Se Git non è disponibile, scaricare l’archivio GitHub del tag `v1.3.1` ed estrarlo atomicamente nella stessa destinazione.
5. Eseguire `claude plugin details futuria-crm@skills-dir` quando disponibile, quindi `/reload-plugins` oppure aprire una nuova sessione.

Claude Code riconosce come plugin personale ogni cartella sotto `~/.claude/skills/` che contiene `.claude-plugin/plugin.json`; non serve registrare un marketplace per questo percorso.

Il marketplace resta disponibile per l’installazione manuale da una sessione Claude Code:

```text
/plugin marketplace add https://github.com/Futuria-Marketing/futuria-crm-client.git#v1.3.1
/plugin install futuria-crm@futuria-crm
```

Non aggiornare Claude Code o installare software di sistema senza aver informato l’utente.

## Codex

Usare la skill di sistema `$skill-installer` per installare la skill dalla release congelata:

```text
Installa con $skill-installer dal repository Futuria-Marketing/futuria-crm-client,
ref v1.3.1, la cartella skills/futuria-crm.
```

Se `$skill-installer` non è disponibile, scaricare la release `v1.3.1` e copiare la cartella sotto la directory personale delle skill di Codex, senza sovrascrivere directory ambigue. Aprire una nuova chat se le skill non vengono rilevate subito.

Il repository include anche il manifest `.codex-plugin/plugin.json` e il marketplace `.agents/plugins/marketplace.json`. `codex plugin marketplace add Futuria-Marketing/futuria-crm-client@v1.3.1` registra il catalogo nei client che lo supportano, ma non va confuso con l’installazione della skill.

## Configurazione grafica protetta

Individuare la cartella installata della skill `futuria-crm`, quindi eseguire il launcher adatto al sistema operativo. Il launcher usa Node.js, già presente nella maggior parte degli ambienti Codex e Claude Code, per aprire una pagina raggiungibile soltanto su `127.0.0.1` e valida per una sessione temporanea.

La pagina:

- mostra una guida visiva in tre passaggi con schermate Futuria CRM;
- accetta il link completo dell’account ed estrae automaticamente l’ID;
- verifica la chiave in sola lettura;
- salva la credenziale con la protezione nativa del sistema operativo;
- restituisce all’agente soltanto l’esito e il nome dell’account.

### Windows

Dal terminale dell’agente eseguire:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<skill-futuria-crm>\scripts\launch-credential-setup.ps1"
```

Il browser apre il configuratore. Dopo la verifica, la chiave viene cifrata con Windows DPAPI per l’utente corrente. L’ID account viene salvato nella configurazione locale e non è un segreto.

### macOS

Dal terminale dell’agente eseguire:

```bash
bash "<skill-futuria-crm>/scripts/launch-credential-setup.sh"
```

Il browser apre lo stesso configuratore. Dopo la verifica, la chiave viene salvata nel Portachiavi dell’utente macOS senza comparire negli argomenti di processo o nel profilo shell.

### Fallback senza Node.js

Se `node` non è disponibile, lo stesso launcher apre automaticamente il prompt protetto precedente:

- PowerShell con input nascosto e DPAPI su Windows;
- Terminale con input nascosto e Portachiavi su macOS.

Non installare Node.js soltanto per il configuratore senza prima informare l’utente.

### Linux

Il percorso protetto automatizzato è previsto per Windows e macOS. Su Linux usare variabili d’ambiente impostate personalmente dall’utente in un terminale separato; non far transitare i valori nella chat.

## Verifica finale in sola lettura

Windows:

```powershell
& "<skill-futuria-crm>\scripts\crm-api.ps1" -Method GET -Path "/locations/{location}"
```

macOS:

```bash
bash "<skill-futuria-crm>/scripts/crm-api.sh" GET "/locations/{location}"
```

Confermare all’utente soltanto:

- runtime installato;
- versione letta dal file `VERSION`;
- nome dell’account collegato;
- esito della verifica.

Se la lettura fallisce per permessi, usare la sanity read contatti documentata in `skills/futuria-crm/references/getting-started.md`. Non sostituire la chiave prima di aver classificato l’errore.

## Aggiornamenti

Non esiste un aggiornamento silenzioso in background. Prima di una nuova configurazione, o quando l’utente chiede di verificare gli aggiornamenti:

1. leggere la versione locale da `VERSION`;
2. confrontarla con l’ultima GitHub Release stabile del repository;
3. se esiste una versione più recente, informare l’utente e proporre l’aggiornamento;
4. aggiornare soltanto una copia riconosciuta, pulita e senza modifiche locali, dopo conferma.
