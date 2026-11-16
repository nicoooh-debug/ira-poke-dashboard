# IRA POKÈ — Dashboard cassa giornaliera

Dashboard web (funziona bene anche da smartphone) per registrare gli incassi di **pranzo** e **cena** su ogni canale (Locale, Glovo, Alfonsino, Avvoolo), le uscite del giorno e il risultato economico.

- Calcola in automatico: totale pranzo, totale cena, totale giornaliero, totale per canale, totale uscite, risultato del giorno.
- Ogni importo si può cambiare quante volte vuoi: viene **salvato da solo** dopo mezzo secondo e ogni modifica finisce nello **storico** (non si perde niente).
- Se manca internet, le modifiche restano in attesa sul telefono e vengono salvate appena torna la connessione.
- Le vendite delivery restano **vendite registrate**: diventano soldi in banca o in cassaforte solo quando registri l'accredito della piattaforma.

Senza configurazione la dashboard parte in **modalità demo** (dati salvati solo nel browser): utile per provarla subito.

---

## 1. Crea il database (Supabase, gratuito)

1. Vai su <https://supabase.com>, crea un account e un **nuovo progetto** (regione: *Central EU (Frankfurt)*). Annota la password del database in un posto sicuro.
2. Nel progetto apri **SQL Editor → New query**, incolla tutto il contenuto di `supabase/schema.sql` e premi **Run**.
3. Crea gli utenti che possono entrare: **Authentication → Users → Add user → Create new user** (email + password, spunta *Auto Confirm User*). Uno per te e uno per chi lavora con te, se serve.
4. Disattiva le iscrizioni libere: **Authentication → Sign In / Providers → Email** → togli *Allow new users to sign up*. Così solo gli utenti creati da te possono accedere.
5. Apri **Project Settings → API** e copia:
   - **Project URL**
   - **anon public key**
6. Incollali in `config.js`:

```js
window.IRA_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi...",
};
```

> La *anon key* è pensata per stare nel sito pubblico: i dati sono protetti dal login e dalle regole di sicurezza dello schema. **Non** mettere mai nel sito la *service_role key*.

## 2. Pubblica su GitHub Pages

### Dal sito di GitHub (senza programmi)
1. Accedi a <https://github.com> → **New repository** → nome `ira-poke-dashboard` → *Public* → **Create repository**.
2. Clicca **uploading an existing file** e trascina dentro **tutti i file e la cartella `supabase`** (non lo zip, il suo contenuto). Premi **Commit changes**.
3. Vai su **Settings → Pages** → *Source*: **Deploy from a branch** → Branch **main** / **(root)** → **Save**.
4. Dopo 1–2 minuti il sito è online su:
   `https://TUO-UTENTE.github.io/ira-poke-dashboard/`

> GitHub Pages gratuito richiede un repository **pubblico**: il codice è visibile, ma i dati incassi no (stanno su Supabase dietro login).

### Da terminale (alternativa)
```bash
cd ira-poke-dashboard
git init && git add . && git commit -m "Dashboard IRA POKÈ"
git branch -M main
git remote add origin https://github.com/TUO-UTENTE/ira-poke-dashboard.git
git push -u origin main
```
Poi attiva Pages come al punto 3.

### Aggiornamenti futuri
Modifica i file nel repository (anche dal sito, con l'icona della matita) e fai commit: il sito si aggiorna da solo in un paio di minuti.

## 3. Usala dal telefono come un'app
Apri il link del sito → **iPhone (Safari)**: Condividi → *Aggiungi alla schermata Home*. **Android (Chrome)**: menu ⋮ → *Aggiungi a schermata Home*.

---

## Struttura

| File | Cosa fa |
|---|---|
| `index.html` | Struttura della pagina |
| `styles.css` | Grafica (mobile prima, poi desktop) |
| `app.js` | Calcoli, salvataggio automatico, coda offline |
| `config.js` | Dati di collegamento Supabase |
| `supabase/schema.sql` | Tabelle, storico modifiche, sicurezza |

### Tabelle
- `entrate` — valore attuale per giorno + servizio + canale
- `entrate_storico` — ogni modifica (valore precedente → nuovo, ora, utente); compilata in automatico dal database
- `uscite` — spese del giorno (le eliminazioni sono "morbide": la riga resta con `deleted_at`)
- `accrediti` — soldi effettivamente ricevuti da Glovo / Alfonsino / Avvoolo
- `delivery_saldo` (vista) — vendite registrate vs ricevute vs da ricevere, per piattaforma
