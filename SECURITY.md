# Sicurezza

## Credenziali

- La credenziale API è un **Private Integration Token (PIT)**; nel configuratore viene chiamata **chiave privata di collegamento**.
- Non inserirla mai in chat, prompt, issue GitHub, screenshot o file del progetto.
- Usare il configuratore protetto incluso nella skill: DPAPI su Windows, Portachiavi su macOS.
- La skill conserva i propri dati in una cartella dedicata, separata da quella dell’app desktop Futuria CRM, e non ne modifica i file.
- Assegnare alla chiave soltanto gli ambiti necessari.
- Revocarla e rigenerarla subito se si sospetta un’esposizione.

## Configuratore locale

- Ascolta soltanto su `127.0.0.1`, su una porta casuale e con un percorso di sessione non prevedibile.
- Usa cookie `HttpOnly` e `SameSite=Strict`, token CSRF, limiti di richiesta, Content Security Policy e header `no-store`.
- Verifica l’account in sola lettura prima del salvataggio.
- Non inserisce la chiave negli argomenti di processo, nella cronologia shell o nei log.
- La sessione scade automaticamente; senza Node.js viene usato il prompt protetto nativo.

## Azioni dell’agente

- Lettura prima di ogni scrittura.
- Modifica minima e verifica successiva.
- Conferma esplicita prima di invii, pubblicazioni, eliminazioni o sostituzioni.
- Pagamenti e transazioni sono in sola lettura.

## Segnalazioni

Non aprire issue pubbliche contenenti dati cliente o dettagli di credenziali. Contattare direttamente il proprio referente Futuria Marketing tramite <https://futuriamarketing.com>.
