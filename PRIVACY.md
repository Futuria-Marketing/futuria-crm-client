# Informativa tecnica sul trattamento dei dati

Ultimo aggiornamento: 2026-11-04

Questa informativa descrive il funzionamento tecnico del plugin **Futuria CRM**, con skill condivisa, MCP cliente con OAuth e alternativa locale protetta per Codex e Claude Code. Non sostituisce gli accordi privacy tra il cliente, Futuria Marketing, il fornitore dell’agente AI e gli interessati presenti nel CRM.

## Quali dati vengono trattati

In base alla richiesta dell’utente, l’agente può leggere o modificare dati presenti nel suo account Futuria CRM, tra cui:

- dati anagrafici e di contatto;
- conversazioni e messaggi;
- note, task, appuntamenti, opportunità e pipeline;
- contenuti marketing;
- ordini e transazioni in sola lettura;
- metadati tecnici dell’account.

Il collegamento OAuth usa credenziali di autorizzazione gestite dal client e dal servizio MCP, e l’identificativo dell’account autorizzato. Il servizio conserva i token necessari al collegamento e al rinnovo dell’accesso. Password e codici di accesso non devono essere forniti all’agente.

Solo scegliendo il collegamento locale, gli helper usano un Private Integration Token (PIT), cioè la chiave privata, e l’identificativo dell’account Futuria CRM.

## Dove transitano i dati

Nel percorso consigliato OAuth le richieste transitano dal server MCP cliente gestito da Futuria Marketing all’indirizzo `https://futuria-crm.account-futuria.workers.dev/mcp`, ospitato su infrastruttura cloud, verso Futuria CRM. Il servizio gestisce i token di accesso e rinnovo e tratta i dati necessari alle operazioni richieste. Non è l’integrazione interna di agenzia.

Nell’alternativa PIT locale le richieste API partono dal computer dell’utente verso Futuria CRM attraverso gli helper inclusi, senza passare dal server MCP.

In entrambi i percorsi i risultati letti vengono usati dall’agente per ragionare e rispondere: possono quindi entrare nel contesto elaborato da **OpenAI** o **Anthropic**, a seconda dell’agente scelto. Condizioni, conservazione, utilizzo per l’addestramento e controlli disponibili dipendono dal piano e dalle impostazioni dell’utente presso quel fornitore.

Prima di usare la skill su dati personali o riservati, il cliente deve verificare che il proprio piano, le impostazioni e gli accordi con il fornitore AI siano adeguati al trattamento previsto.

Riferimenti dei fornitori:

- OpenAI: <https://openai.com/business-data/>
- Anthropic: <https://privacy.anthropic.com/>

## Conservazione locale — solo alternativa PIT

- **Windows:** la chiave privata viene cifrata con la protezione dati dell’utente Windows (DPAPI) e salvata, insieme all’identificativo dell’account, nella cartella `%USERPROFILE%\.futuria-crm-skill\`.
- **macOS:** la chiave privata viene salvata nel Portachiavi di macOS. L’identificativo dell’account sta nel file `~/Library/Application Support/com.futuriamarketing.futuria-crm-skill/config.json`, che contiene solo quell’ID.
- La skill non salva nulla nella cartella dell’app desktop Futuria CRM (`%APPDATA%\Futuria CRM` su Windows, `~/Library/Application Support/Futuria CRM` su macOS), che le versioni fino alla 1.3.2 condividevano con l’app. All’aggiornamento copia da lì nella propria cartella soltanto i propri file; se la copia non riesce, per esempio dentro una sandbox, li legge da lì in sola lettura finché la copia non riesce. Per riconoscerli legge al massimo `credential.xml` e un `config.json` non più grande di 1 KiB, senza conservarne, mostrarne o registrarne il contenuto; i file dell’app non vengono copiati né modificati.
- Il configuratore grafico viene servito temporaneamente soltanto su `127.0.0.1`; non invia telemetria e non conserva la chiave nei log o nella cache del browser. Il campo della chiave è un campo password: il browser può proporre di salvarla nel proprio gestore delle password, e non serve accettare.
- All’apertura il configuratore non fa richieste verso l’esterno. Solo se l’utente apre la guida della chiave il browser scarica da `futuriamarketing.com` l’immagine di anteprima del video e, se l’utente preme play, il video. Nessun dato inserito nel configuratore viene inviato con queste richieste.
- Come fallback tecnico, l’utente può scegliere variabili d’ambiente; non sono il percorso consigliato per utenti non tecnici.

## Controlli dell’utente

L’utente può:

- disconnettere il collegamento OAuth dai controlli del client e revocare l’autorizzazione tramite i controlli del servizio;
- revocare o rigenerare la chiave privata dal proprio account Futuria CRM, se usa l’alternativa PIT;
- rimuovere la copia locale con gli script di configurazione inclusi: la rimozione toglie anche le vecchie copie della skill nella cartella dell’app desktop, mai i file dell’app. Se usi anche l’app desktop, l’ID account può restare nel file di configurazione dell’app: la skill non lo modifica per non danneggiarla;
- disinstallare o disabilitare la skill;
- limitare gli ambiti assegnati alla chiave.

Disconnettere OAuth non equivale a rimuovere o revocare un PIT già configurato; disinstallare il plugin non equivale a revocare tutte le autorizzazioni. Gli ambiti concessi e le operazioni disponibili dipendono dalla connessione effettiva.

Le azioni verso persone reali, le pubblicazioni e le eliminazioni devono rientrare nell’autorizzazione dell’utente secondo le regole della skill. Le autorizzazioni dell’agente AI e del sistema operativo restano comunque sotto il controllo dell’utente.

## Futuria Marketing

Il repository pubblico contiene istruzioni e script, ma nessuna chiave privata e nessun dato cliente. Futuria Marketing tratta i dati necessari a gestire il servizio MCP, il collegamento OAuth e le operazioni richieste, oltre all’assistenza e alla gestione dell’account CRM, secondo gli accordi applicabili. Il repository e questa informativa non stabiliscono da soli tempi di conservazione, ruoli contrattuali o condizioni ulteriori del servizio ospitato: tali aspetti richiedono i relativi accordi e la verifica del servizio.

Per richieste operative o revoca dell’accesso, contattare il proprio referente Futuria Marketing: <https://futuriamarketing.com>.

Questa informativa descrive i percorsi previsti dal pacchetto `2.0.0`. La revisione legale e contrattuale, la pubblicazione del plugin e la verifica autenticata del servizio sono controlli separati.
