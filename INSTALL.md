# Installazione — istruzioni per l’agente

Il pacchetto `2.0.0` contiene una sola skill condivisa, il collegamento MCP cliente e l’alternativa locale protetta. Scegli il percorso nativo disponibile nel client; non copiare istruzioni o configurazioni dell’integrazione interna di agenzia.

## Percorso consigliato: plugin con OAuth

1. Identifica il client e il supporto a plugin, skill e MCP remoto. Non installare software di sistema o modificare configurazioni estranee per colmare un limite.
2. Installa il plugin dal marketplace nativo. Il repository Git segue `stable`; non fissarlo a un tag se l’utente vuole il canale aggiornabile.
3. Apri il collegamento **Futuria CRM** nel client e completa **Accedi / Connetti** nel flusso OAuth protetto. Endpoint cliente: `https://futuria-crm.account-futuria.workers.dev/mcp`.
4. Segui `skills/futuria-crm/references/mcp-onboarding.md`: controlla gli strumenti realmente esposti e leggi il nome dell’account con `crm_get_location`, se disponibile. Una risposta del server o il catalogo visibile non provano l’autenticazione.
5. Comunica runtime, versione da `skills/futuria-crm/VERSION`, account ed esito della lettura. Se non puoi verificare, indica il limite senza dichiarare il collegamento completato.

Non chiedere password, token, codici OAuth o chiavi private in chat. Non raccogliere né trasferire token tra OAuth e configuratore locale.

`stable` è il canale di distribuzione: avanza dopo i controlli e la pubblicazione della release. `main` è il ramo di sviluppo. Verifica che il canale sia effettivamente disponibile prima di installarlo; non dichiarare riuscito un aggiornamento soltanto perché i sorgenti sono cambiati.

### Claude Code

In una sessione Claude Code:

```text
/plugin marketplace add https://github.com/Futuria-Marketing/futuria-crm-client.git#stable
/plugin install futuria-crm@futuria-crm
```

Apri `/plugin`, scheda **Marketplaces**, seleziona `futuria-crm` e abilita **Enable auto-update** per ricevere gli aggiornamenti del marketplace esterno. L’opzione non è necessariamente attiva inizialmente. Usa i controlli MCP del client per completare OAuth; poi ricarica i plugin o apri una nuova sessione secondo quanto richiede il client.

Non installare la sola skill se l’obiettivo è il plugin completo con il collegamento MCP.

### OpenAI / Codex

Il repository distribuisce il formato portabile Agent Plugins 1.0 (`plugin.json`, `mcp.json`, `skills/`) e il formato di compatibilità Codex. Nei client che espongono il marketplace Git puoi registrare `Futuria-Marketing/futuria-crm-client` sul ref `stable` con i controlli nativi; registrare un catalogo non equivale a installare e autenticare il plugin.

Per un workspace gestito, l’amministratore usa **Admin > Plugins > Add > Import marketplace**: Source `https://github.com/Futuria-Marketing/futuria-crm-client`, Path vuoto e **Branch, tag, or commit** impostato a `stable`. I marketplace nuovi si sincronizzano ogni giorno; **Sync now** richiede un controllo immediato. Dopo l’importazione o la sincronizzazione, leggere il rapporto: un processo completato può includere errori sul singolo plugin. Le policy del workspace determinano disponibilità, installazione e connessione. Non promettere la stessa sincronizzazione nelle installazioni personali Codex.

La directory pubblica OpenAI richiede una presentazione e approvazione separate. Questo repository non contiene identificativi registrati fittizi: non creare `.app.json` con ID inventati. Se il client richiede una connessione già registrata o il plugin non compare, segnala questo requisito; non sostituire il collegamento con quello di agenzia.

Il manifest distribuito dichiara l’endpoint HTTPS protetto; il client scopre OAuth dalla richiesta di autenticazione e dai metadati del server. Non aggiungere chiavi private o campi di autenticazione inventati al pacchetto. Per presentare il plugin nella directory pubblica, configurare separatamente OAuth nel portale OpenAI e completare i controlli della connessione: l’archivio da solo non registra né approva il servizio.

### Archivi fissi e passaggio dalla 1.3.3

Tag e ZIP di release restano snapshot immutabili. Prima di passare da una copia `v1.3.3` al marketplace aggiornabile, verifica origine, percorso, versione e modifiche locali; spiega la nuova modalità OAuth. Non cancellare copie ambigue, sostituire modifiche locali, revocare il PIT o modificare la connessione già funzionante. Evita che due copie della stessa skill siano attive nello stesso client. Il passaggio richiede una scelta esplicita dell’utente e una nuova verifica in sola lettura.

La `2.0.0` nei manifest è la versione preparata dai sorgenti: dichiarala pubblicata solo dopo verifica della release o della directory pertinente.

## Alternativa esplicita: PIT locale protetto

Usala se l’utente sceglie la chiave privata, oppure dopo aver spiegato una funzione mancante in OAuth e aver ricevuto la scelta di questo percorso. Un errore di ambito, una funzione mancante o una scrittura incerta non autorizzano il passaggio automatico.

Installa il pacchetto completo o, se serve soltanto questa alternativa, la cartella `skills/futuria-crm` con il percorso ufficiale delle skill del client. Per una copia fissa scegli una release effettivamente pubblicata, senza promettere aggiornamenti automatici. Per Codex puoi usare `$skill-installer` con repository `Futuria-Marketing/futuria-crm-client`, percorso `skills/futuria-crm` e il ref concordato. Non sovrascrivere copie ambigue.

Segui `skills/futuria-crm/references/getting-started.md` per lo stato, la configurazione protetta e la verifica. Il launcher apre una pagina temporanea solo su `127.0.0.1`; usa Node.js 20 o successivo, oppure il prompt protetto nativo se Node.js manca. Non installare Node.js senza informare l’utente.

Windows:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<skill-dir>\scripts\launch-credential-setup.ps1"
```

macOS:

```bash
bash "<skill-dir>/scripts/launch-credential-setup.sh"
```

La chiave è protetta da DPAPI su Windows in `%USERPROFILE%\.futuria-crm-skill\`, o nel Portachiavi su macOS con l’ID in `~/Library/Application Support/com.futuriamarketing.futuria-crm-skill/`. Questa cartella resta separata dall’app desktop Futuria CRM. Gli helper sicuri e le regole di migrazione delle versioni precedenti restano invariati. Su Linux le variabili d’ambiente, impostate personalmente fuori dalla chat, sono un’alternativa tecnica esplicita.

Non recuperare, stampare o mascherare la chiave; non metterla negli argomenti dei comandi, nei file del progetto o nei log. La rimozione locale e la revoca del PIT sono azioni distinte dalla disconnessione OAuth.

## Distribuzione e aggiornamenti: fonti ufficiali

- [Pacchetti OpenAI](https://developers.openai.com/plugins/build/plugins): formati portabile e di compatibilità.
- [Presentazione OpenAI](https://developers.openai.com/plugins/deploy/submission): aggiornamenti MCP soggetti ai controlli e nuovo ZIP per le skill.
- [Aggiornamenti Claude Code](https://code.claude.com/docs/en/discover-plugins#keep-plugins-updated): opt-in del marketplace esterno.
- [Gestione workspace OpenAI](https://learn.chatgpt.com/docs/enterprise/plugin-management): importazione GitHub e sincronizzazione controllate dall’amministratore.

Il pacchetto non installa updater, daemon o hook di aggiornamento. Una modifica locale non prova distribuzione, approvazione o accesso autenticato nel cliente.
