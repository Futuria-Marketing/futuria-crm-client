# Informativa tecnica sul trattamento dei dati

Ultimo aggiornamento: 2026-11-03

Questa informativa descrive il funzionamento tecnico della skill **Futuria CRM** per Codex e Claude Code. Non sostituisce gli accordi privacy tra il cliente, Futuria Marketing, il fornitore dell’agente AI e gli interessati presenti nel CRM.

## Quali dati vengono trattati

In base alla richiesta dell’utente, l’agente può leggere o modificare dati presenti nel suo account Futuria CRM, tra cui:

- dati anagrafici e di contatto;
- conversazioni e messaggi;
- note, task, appuntamenti, opportunità e pipeline;
- contenuti marketing;
- ordini e transazioni in sola lettura;
- metadati tecnici dell’account.

La skill usa inoltre:

- un Private Integration Token (PIT), cioè la chiave privata usata per autorizzare le richieste API;
- l’identificativo dell’account Futuria CRM.

## Dove transitano i dati

La v1 non usa un server MCP Futuria e non invia telemetria propria a Futuria Marketing.

Le richieste API partono dal computer dell’utente verso Futuria CRM. I risultati letti vengono però usati dall’agente per ragionare e rispondere: possono quindi entrare nel contesto elaborato da **OpenAI** o **Anthropic**, a seconda dell’agente scelto. Condizioni, conservazione, utilizzo per l’addestramento e controlli disponibili dipendono dal piano e dalle impostazioni dell’utente presso quel fornitore.

Prima di usare la skill su dati personali o riservati, il cliente deve verificare che il proprio piano, le impostazioni e gli accordi con il fornitore AI siano adeguati al trattamento previsto.

Riferimenti dei fornitori:

- OpenAI: <https://openai.com/business-data/>
- Anthropic: <https://privacy.anthropic.com/>

## Conservazione locale

- **Windows:** la chiave privata viene cifrata con la protezione dati dell’utente Windows (DPAPI) e salvata, insieme all’identificativo dell’account, nella cartella `%USERPROFILE%\.futuria-crm-skill\`.
- **macOS:** la chiave privata viene salvata nel Portachiavi di macOS. L’identificativo dell’account sta nel file `~/Library/Application Support/com.futuriamarketing.futuria-crm-skill/config.json`, che contiene solo quell’ID.
- La skill non usa la cartella dell’app desktop Futuria CRM (`%APPDATA%\Futuria CRM` su Windows, `~/Library/Application Support/Futuria CRM` su macOS), che le versioni fino alla 1.3.2 condividevano con l’app. All’aggiornamento copia da lì nella propria cartella soltanto i propri file. Per riconoscerli legge al massimo `credential.xml` e un `config.json` non più grande di 1 KiB, senza conservarne, mostrarne o registrarne il contenuto; i file dell’app non vengono copiati né modificati.
- Il configuratore grafico viene servito temporaneamente soltanto su `127.0.0.1`; non invia telemetria e non conserva la chiave nei log o nella cache del browser. Il campo della chiave è un campo password: il browser può proporre di salvarla nel proprio gestore delle password, e non serve accettare.
- All’apertura il configuratore non fa richieste verso l’esterno. Solo se l’utente apre la guida della chiave il browser scarica da `futuriamarketing.com` l’immagine di anteprima del video e, se l’utente preme play, il video. Nessun dato inserito nel configuratore viene inviato con queste richieste.
- Come fallback tecnico, l’utente può scegliere variabili d’ambiente; non sono il percorso consigliato per utenti non tecnici.

## Controlli dell’utente

L’utente può:

- revocare o rigenerare la chiave privata dal proprio account Futuria CRM;
- rimuovere la copia locale con gli script di configurazione inclusi: la rimozione toglie anche le vecchie copie della skill nella cartella dell’app desktop, mai i file dell’app. Se usi anche l’app desktop, l’ID account può restare nel file di configurazione dell’app: la skill non lo modifica per non danneggiarla;
- disinstallare o disabilitare la skill;
- limitare gli ambiti assegnati alla chiave.

Le azioni verso persone reali, le pubblicazioni e le eliminazioni richiedono conferma secondo le regole della skill. Le autorizzazioni dell’agente AI e del sistema operativo restano comunque sotto il controllo dell’utente.

## Futuria Marketing

Il repository pubblico contiene istruzioni e script, ma nessuna chiave privata e nessun dato cliente. Futuria Marketing può trattare dati soltanto quando presta assistenza, gestisce l’account CRM o riceve informazioni dall’utente attraverso i normali canali di supporto, secondo gli accordi applicabili.

Per richieste operative o revoca dell’accesso, contattare il proprio referente Futuria Marketing: <https://futuriamarketing.com>.

Questa informativa è stata verificata rispetto al comportamento tecnico del pacchetto `v1.3.3`; la validazione legale e contrattuale resta distinta.
