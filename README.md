# 🚀 Vibeship

Una **navicella 3D** in cui i tuoi agenti [Claude Code](https://claude.com/claude-code) lavorano in divisa da equipaggio.
È una *mod* (plugin) di Claude Code: ogni sessione diventa un animaletto che cammina, si siede alla console, pensa, dorme ed esulta mentre lavora davvero.

## Cosa fa
- **Vedi cosa fanno gli agenti**: leggono, scrivono, eseguono comandi, cercano sul web. Ogni agente ha una specie (volpe, gatto, cane, procione, coniglio, orso, uccellino) e una divisa (capitano, ingegnere, pilota, scienziato, medico, esploratore, cadetto).
- **Tre luoghi** (Plancia, Sala macchine, Serra), ognuno con i suoi agenti. Si spostano dal portello, dalla scheda o trascinando sulla scheda del luogo.
- **Parli con gli agenti** dalla finestra: vedi la conversazione, lo stato di ogni messaggio e la risposta. Puoi fermare o chiudere un agente.
- **Permessi**: quando Claude chiede conferma, la nave va in allerta e approvi o neghi dalla finestra (se non rispondi entro ~30 s la domanda passa al terminale).
- **Subagenti**: un drone parte dall'agente principale e atterra sul pad di lancio, dove il subagente si materializza; a fine missione torna con il risultato.
- **Nuovi agenti**: dal pulsante *Agente* scegli luogo, personaggio, divisa e cartella (anche un **nuovo progetto**, con `git init` facoltativo) e si apre un terminale con Claude Code.
- Arredi trascinabili e ruotabili, catalogo con anteprime 3D, luci della nave (normale, allerta rossa, soffuse).

## Requisiti
- Claude Code **2.1.287 o successivo** (le mod non esistono nelle versioni precedenti)
- Node.js
- Un browser con WebGL (Edge, Chrome, Firefox). Windows è la piattaforma provata; macOS è scritto ma non provato.

## Uso
```bash
claude --plugin-dir /percorso/a/vibeship
```
Poi, nella sessione:

| Comando | Cosa fa |
| :- | :- |
| `/vibeship` | avvia il server locale e apre la finestra 3D |
| `/vibeship-text` | vista testuale dentro il terminale |

(`/office` e `/office-pane` sono i vecchi nomi: funzionano ancora ma sono nascosti.)

Per averla in ogni progetto, in `~/.claude/settings.json`:
```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/percorso/a/vibeship" } }
```

## Variabili d'ambiente
| Variabile | Effetto |
| :- | :- |
| `AGENT_OFFICE_PORT` | porta del server locale (default 47890) |
| `AGENT_OFFICE_DIR` | cartella dei dati (token, layout); default `~/.claude-agent-office` |
| `AGENT_OFFICE_NAME` | nome dell'abitante (default: nome della cartella) |
| `AGENT_OFFICE_LOOK` | aspetto, `specie:divisa` (es. `fox:3`) |
| `AGENT_OFFICE_LOC` | luogo: `bridge`, `engine` o `habitat` |

## Sicurezza
- Il server ascolta **solo su `127.0.0.1`**.
- Chat, stop, chiusura, permessi, spostamenti, nuovi agenti e creazione di cartelle richiedono un **token** casuale, salvato in un file nella tua cartella utente e passato solo alla finestra aperta da `/vibeship`.
- La mod **non è in sandbox**: ha gli stessi accessi di Claude Code. Il pulsante *Agente* può aprire un terminale con Claude Code in una cartella che scegli. Installa mod solo da fonti di cui ti fidi.

## Struttura
```
.claude-plugin/plugin.json   manifest
hooks/                        la mod (eventi, comandi, vista testuale)
server/server.js              server locale (SSE, comandi, permessi, avvio agenti), senza dipendenze
web/                          la finestra 3D (Three.js, nessun build)
  js/                         scena, personaggi, arredi, effetti, audio
  vendor/three/               Three.js (MIT)
tests/                        test della mod (`claude plugin test`)
```

## Sviluppo
```bash
claude plugin validate .
claude plugin test .
```
La finestra si ricarica con Ctrl+R: i file sono serviti da disco, non serve riavviare il server per le modifiche in `web/`.

## Licenze
Three.js è incluso in `web/vendor/three/` con la sua licenza MIT. Per questo progetto non è ancora stata scelta una licenza.
