# Futuria CRM — plugin per agenti AI

Un solo plugin ufficiale **Futuria Marketing**, con una skill condivisa e il collegamento al tuo account **Futuria CRM** tramite MCP e **OAuth**. Accedi nella pagina protetta del servizio: non devi consegnare una chiave all’agente.

Puoi usarlo nei client che supportano plugin, skill e MCP remoto, tra cui Codex e Claude Code, secondo le funzioni disponibili nel tuo piano e ambiente. L’installazione del pacchetto non dimostra che la connessione sia autenticata o che ogni operazione sia autorizzata.

## Testo da incollare all’agente

```text
Installa il plugin Futuria CRM dal repository ufficiale
https://github.com/Futuria-Marketing/futuria-crm-client seguendo INSTALL.md.
Usa il marketplace nativo del mio client e il collegamento OAuth consigliato.
Non chiedermi credenziali in chat. Verifica la connessione in sola lettura
e comunicami account, versione installata ed esito. Se il client non supporta
questo percorso, spiegami il limite prima di proporre l’alternativa locale.
```

## Cosa può fare

La skill guida contatti, conversazioni, opportunità, appuntamenti, contenuti, media, automazioni e consultazione di ordini e transazioni. Preferisce gli strumenti specifici del collegamento e, quando presenti, i quattro strumenti di ricerca, descrizione, lettura e scrittura del catalogo documentato.

Il catalogo non è una promessa di copertura: operazioni documentate, strumenti esposti, ambiti OAuth concessi e disponibilità effettiva nel tuo account sono cose distinte. Prima di una scrittura l’agente legge lo stato e verifica il risultato; invii, pubblicazioni ed eliminazioni devono rientrare nella tua autorizzazione.

## Alternativa locale protetta

Se scegli il collegamento locale con chiave privata, il configuratore incluso conserva il **Private Integration Token (PIT)** con Windows DPAPI o Portachiavi macOS, nella cartella propria della skill separata dall’app desktop Futuria CRM. Gli helper e la configurazione della 1.3.3 restano supportati. L’agente non passa automaticamente a questa alternativa quando OAuth fallisce. La guida è in [INSTALL.md](INSTALL.md).

## Aggiornamenti

- **Claude Code:** il marketplace Git segue `stable`; per i marketplace esterni devi abilitare **Enable auto-update** nelle impostazioni del marketplace.
- **Workspace OpenAI:** l’amministratore può importare il repository e abilitare la sincronizzazione GitHub giornaliera. Installazione e disponibilità restano soggette ai controlli del workspace.
- **Codex personale:** usa i comandi e i controlli del client. Non è garantito un aggiornamento automatico universale del marketplace personale; il pacchetto non installa servizi o hook di aggiornamento.
- **Directory pubblica OpenAI:** le modifiche del server MCP possono diventare disponibili dopo i controlli della piattaforma; una nuova versione delle skill richiede un nuovo ZIP e la relativa revisione.

Il ramo `stable` avanza dopo i controlli e la pubblicazione della release; `main` conserva lo sviluppo. I tag e gli archivi delle release sono copie fisse. Una copia installata dalla `v1.3.3` resta tale finché non scegli di passare al nuovo canale: non viene migrata silenziosamente. Il repository prepara la `2.0.0`; la presenza dei file non certifica pubblicazione, approvazione nella directory o qualificazione autenticata.

## Privacy e supporto

Con OAuth le richieste passano dal server MCP Futuria; i risultati vengono elaborati dal fornitore dell’agente AI secondo il tuo piano e le tue impostazioni. Con il PIT locale le chiamate API partono dal computer. Leggi [PRIVACY.md](PRIVACY.md) e [SECURITY.md](SECURITY.md).

Per assistenza: il tuo referente Futuria Marketing — <https://futuriamarketing.com>.

© Futuria Marketing. Tutti i diritti riservati.
