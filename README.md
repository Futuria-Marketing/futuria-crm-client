# Futuria CRM — skill per agenti AI

Plugin ufficiale **Futuria Marketing** per collegare il proprio agente AI all’account **Futuria CRM** tramite API diretta. L’account autorizza il collegamento con un **Private Integration Token (PIT)**, presentato nel configuratore semplicemente come **chiave privata di collegamento**.

Serve un’app installata sul computer che possa lavorare sui tuoi file: **Claude Code** (nell’app Claude per computer, sezione Code, oppure nel terminale o in VS Code) o l’**app ChatGPT per computer** in modalità **Work (Codex)**. Non funzionano claude.ai, chatgpt.com né la chat normale delle app: non possono installare la skill né aprire la configurazione protetta. Resta supportato anche Codex da terminale o in VS Code.

La release attuale:

- installa la skill `futuria-crm`;
- usa un solo account Futuria CRM;
- non installa e non richiede alcun connettore MCP;
- conserva la chiave privata con la protezione del sistema operativo, non nella chat;
- risponde sempre in italiano e chiama la piattaforma sempre **Futuria CRM**.

## Il testo da incollare al proprio agente

Copia questo testo in una chat nuova. Usa Claude Code o l’app ChatGPT per computer in modalità Work (Codex), non la versione da browser né la chat normale.

```text
Installa la release stabile della skill Futuria CRM dal repository pubblico
https://github.com/Futuria-Marketing/futuria-crm-client seguendo INSTALL.md.
Usa il percorso previsto per il tuo runtime e apri il configuratore protetto
incluso nella skill. Non chiedermi mai credenziali in chat o in un comando.
Al termine verifica la connessione in sola lettura e comunicami soltanto il
nome dell’account collegato, la versione installata e l’esito.
```

Le istruzioni operative restano in [INSTALL.md](INSTALL.md), quindi il prompt può rimanere breve. Non servono `winget` o Homebrew per installare la skill. La skill non richiede Python.

## Configurazione guidata

Dopo l’installazione l’agente apre un configuratore grafico locale. L’utente:

1. vede un solo modulo con due campi: il link dell’account e la chiave privata;
2. se non sa dove trovarli, apre la guida accanto al campo: «Dove trovo il link?» oppure «Scopri dove trovare questa chiave», con il video e le schermate reali di **Integrazioni private**;
3. crea la chiave privata nel proprio account Futuria CRM e incolla nel configuratore il link e la chiave;
4. attende la verifica in sola lettura e torna alla chat.

La pagina è disponibile soltanto sul computer dell’utente. Il configuratore resta attivo finché la pagina è aperta e in primo piano; si ferma da solo dopo il collegamento, dopo 45 minuti in cui la pagina resta chiusa o in un’altra scheda, e comunque dopo 3 ore. In quel caso la pagina lo segnala. La chiave non entra nel prompt, negli argomenti dei comandi o nei log del configuratore.

- **Windows:** la chiave viene cifrata con Windows DPAPI per l’utente corrente.
- **macOS:** la chiave viene salvata nel Portachiavi di macOS.
- Se Node.js non è disponibile, il launcher apre automaticamente il precedente prompt protetto in PowerShell o Terminale.
- Le variabili d’ambiente restano un fallback per utenti tecnici e ambienti automatizzati.

## Cosa può fare

- **Contatti, note, task e tag** — cerca, crea e aggiorna, evitando i duplicati.
- **Conversazioni** — legge la cronologia e prepara o invia messaggi dopo conferma.
- **Opportunità e pipeline** — consulta e aggiorna trattative, valore, stato e fase.
- **Appuntamenti** — consulta calendari, eventi e note.
- **Contenuti** — lavora su template email, bozze e programmazione social, statistiche, commenti e articoli del blog.
- **Media e automazioni** — verifica la libreria file, workflow, form e consenso; usa l’interfaccia CRM per upload e dettagli non gestiti dagli helper API.
- **Pagamenti** — consulta ordini e transazioni in sola lettura.

## Aggiornamenti

La skill non si aggiorna in background e non modifica da sola i file installati. Dalla v1.2.0 l’agente legge il file `VERSION`, confronta la release pubblica stabile quando avvia una configurazione o quando l’utente chiede di verificare gli aggiornamenti e propone l’upgrade senza sovrascrivere copie ambigue o modificate.

## Uso

Dopo la configurazione basta chiedere, per esempio:

- «Crea un contatto per Maria Bianchi e aggiungi il tag cliente-2026.»
- «Com’è messa la pipeline Vendite questo mese?»
- «Prepara una risposta WhatsApp a Luca per confermare l’appuntamento.»

Codex può richiamare esplicitamente `$futuria-crm`. In Claude Code le skill del plugin sono disponibili anche tramite i comandi con namespace; normalmente l’agente riconosce la richiesta dal linguaggio naturale.

## Privacy essenziale

I dati letti dal CRM vengono elaborati dall’agente AI scelto dall’utente. Possono quindi essere trattati anche dal relativo fornitore AI, secondo piano, impostazioni e contratto dell’utente. La skill non invia telemetria propria a Futuria Marketing e in questa versione non usa un server MCP Futuria.

Per attivazione, revoca della chiave privata o supporto: il proprio referente Futuria Marketing — <https://futuriamarketing.com>.

Dettagli e limiti sono descritti in [PRIVACY.md](PRIVACY.md) e [SECURITY.md](SECURITY.md).

---

© Futuria Marketing. Tutti i diritti riservati.
