# Futuria CRM — skill per agenti AI

Plugin ufficiale **Futuria Marketing** per collegare Codex o Claude Code al proprio account **Futuria CRM** tramite API diretta. L’account autorizza il collegamento con un **Private Integration Token (PIT)**, presentato nel configuratore semplicemente come **chiave privata di collegamento**.

La release attuale:

- funziona con **Codex** e **Claude Code**;
- installa la skill `futuria-crm`;
- usa un solo account Futuria CRM;
- non installa e non richiede alcun connettore MCP;
- conserva la chiave privata con la protezione del sistema operativo, non nella chat;
- risponde sempre in italiano e chiama la piattaforma sempre **Futuria CRM**.

## Il testo da incollare al proprio agente

Copia questo testo in una chat nuova di Codex o Claude Code:

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

1. apre **Integrazioni private** seguendo il video in cima alla pagina o la guida a fisarmonica con schermate reali;
2. crea la chiave privata nel proprio account Futuria CRM;
3. incolla nel configuratore il link dell’account e la chiave;
4. attende la verifica in sola lettura e torna alla chat.

La pagina è disponibile soltanto sul computer dell’utente e resta attiva finché è aperta: si chiude da sola dopo il collegamento o dopo 45 minuti di inattività. La chiave non entra nel prompt, negli argomenti dei comandi o nei log del configuratore.

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
