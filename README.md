# Gli Ultimi Umani

Storia interattiva su Instagram: i follower sono gli ultimi sopravvissuti, ULTIMA è l'IA nemica.
Il sito è il Rifugio in 3D dove ogni sopravvissuto ha il suo posto.

## Struttura

| Percorso | Cosa fa |
| --- | --- |
| `index.html` | Scena 3D (Three.js), HUD, prologo, iscrizione con codice, modalità Reel (`/#reel`) |
| `admin.html` | Pannello: verifica codici, stato del gioco, posti dei ruoli |
| `privacy.html` | Informativa privacy (bozza da completare) |
| `api/state.js` | `GET` stato pubblico del gioco |
| `api/claim.js` | `POST` iscrizione: riserva il ruolo per 48 ore e restituisce il codice |
| `api/admin.js` | `POST` azioni admin, protette da `ADMIN_TOKEN` |
| `lib/db.js` | Connessione a Neon |

## Infrastruttura

- Hosting: Vercel (progetto `ultimi-umani`)
- Database: Neon, progetto `gli-ultimi-umani` (eu-central-1)
- Variabili d'ambiente: `DATABASE_URL`, `ADMIN_TOKEN`

## Ciclo di gioco

- I posti dei ruoli contano i verificati più i codici in attesa da meno di 48 ore.
- Il primo verificato di un ruolo ottiene il titolo di Primo (salvato in `roles.first_handle`).
- Gli Infiltrati non vengono mai esposti dall'API pubblica.
