/* =====================================================================
   IRA POKÈ — Dashboard cassa giornaliera
   ===================================================================== */
(() => {
  "use strict";

  // ---------- Costanti ----------
  const SERVIZI = ["pranzo", "cena"];
  const CANALI = [
    { id: "locale",    nome: "Locale",    sub: "vendite dirette", color: "var(--c-locale)" },
    { id: "glovo",     nome: "Glovo",     sub: "delivery",        color: "var(--c-glovo)" },
    { id: "alfonsino", nome: "Alfonsino", sub: "delivery",        color: "var(--c-alfonsino)" },
    { id: "avvoolo",   nome: "Avvoolo",   sub: "delivery",        color: "var(--c-avvoolo)" },
  ];
  const DELIVERY = CANALI.filter(c => c.id !== "locale");
  const NOME = Object.fromEntries(CANALI.map(c => [c.id, c.nome]));
  const CATEGORIE = { fornitori: "Fornitori", personale: "Personale", affitto: "Affitto", utenze: "Utenze", packaging: "Packaging", commissioni: "Commissioni", altro: "Altro" };
  const SAVE_DELAY = 600;
  const PENDING_KEY = "irapoke_pending_v1";

  // ---------- Utilità ----------
  const $ = (s, el = document) => el.querySelector(s);
  const eur = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", useGrouping: "always" });
  const fmt = n => eur.format(Number(n) || 0);
  const fmtInput = n => (Number(n) || 0) === 0 ? "" :
    Number(n).toLocaleString("it-IT", { useGrouping: false, maximumFractionDigits: 2 });
  const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /** Accetta "250", "250,5", "1.250,50", "1250.50", "€ 80" */
  function parseEuro(str) {
    let s = String(str ?? "").replace(/[€\s]/g, "");
    if (!s) return 0;
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\.(?=.*\.)/g, "");
    const n = parseFloat(s);
    return Number.isFinite(n) && n >= 0 ? round2(n) : NaN;
  }

  const toISO = d => {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
  };
  const fromISO = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const todayISO = () => toISO(new Date());
  const addDays = (iso, n) => { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
  const timeHM = ts => new Date(ts).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  const dateShort = iso => fromISO(iso).toLocaleDateString("it-IT", { day: "numeric", month: "short" });

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // =====================================================================
  //  STORAGE: Supabase (reale) oppure localStorage (demo)
  // =====================================================================
  const cfg = window.IRA_CONFIG || {};
  const useSupabase = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);

  function createSupabaseStore() {
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    const ok = ({ data, error }) => { if (error) throw error; return data; };

    return {
      demo: false,
      auth: {
        async session() { return (await sb.auth.getSession()).data.session; },
        async login(email, password) { ok(await sb.auth.signInWithPassword({ email, password })); },
        async logout() { await sb.auth.signOut(); },
        onChange(cb) { sb.auth.onAuthStateChange((_e, s) => cb(s)); },
      },
      async loadDay(giorno) {
        const [entrate, uscite, storico] = await Promise.all([
          sb.from("entrate").select("servizio,canale,importo,updated_at").eq("giorno", giorno).then(ok),
          sb.from("uscite").select("*").eq("giorno", giorno).is("deleted_at", null).order("created_at").then(ok),
          sb.from("entrate_storico").select("*").eq("giorno", giorno).order("modificato_at", { ascending: false }).limit(100).then(ok),
        ]);
        return { entrate, uscite, storico };
      },
      async saveEntrata(giorno, servizio, canale, importo) {
        ok(await sb.from("entrate").upsert({ giorno, servizio, canale, importo }, { onConflict: "giorno,servizio,canale" }));
      },
      async addUscita(u) { ok(await sb.from("uscite").insert(u)); },
      async deleteUscita(id) { ok(await sb.from("uscite").update({ deleted_at: new Date().toISOString() }).eq("id", id)); },
      async loadDelivery() {
        const [saldo, accrediti] = await Promise.all([
          sb.from("delivery_saldo").select("*").then(ok),
          sb.from("accrediti").select("*").is("deleted_at", null).order("data", { ascending: false }).order("created_at", { ascending: false }).limit(20).then(ok),
        ]);
        return { saldo, accrediti };
      },
      async addAccredito(a) { ok(await sb.from("accrediti").insert(a)); },
      async deleteAccredito(id) { ok(await sb.from("accrediti").update({ deleted_at: new Date().toISOString() }).eq("id", id)); },
    };
  }

  function createLocalStore() {
    const KEY = "irapoke_demo_db_v1";
    const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
    const db = Object.assign({ entrate: {}, storico: [], uscite: [], accrediti: [] }, read());
    const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
    const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
    const wait = v => new Promise(r => setTimeout(() => r(v), 80));

    return {
      demo: true,
      auth: { async session() { return { demo: true }; }, async login() {}, async logout() {}, onChange() {} },
      async loadDay(giorno) {
        const entrate = Object.values(db.entrate).filter(e => e.giorno === giorno);
        const uscite = db.uscite.filter(u => u.giorno === giorno && !u.deleted_at);
        const storico = db.storico.filter(s => s.giorno === giorno).slice().reverse().slice(0, 100);
        return wait({ entrate, uscite, storico });
      },
      async saveEntrata(giorno, servizio, canale, importo) {
        const k = `${giorno}|${servizio}|${canale}`;
        const prev = db.entrate[k];
        const now = new Date().toISOString();
        if (!prev || Number(prev.importo) !== importo) {
          db.storico.push({ giorno, servizio, canale, importo_precedente: prev ? prev.importo : null, importo_nuovo: importo, modificato_at: now });
        }
        db.entrate[k] = { giorno, servizio, canale, importo, updated_at: now };
        persist(); return wait();
      },
      async addUscita(u) { db.uscite.push({ ...u, id: uid(), created_at: new Date().toISOString() }); persist(); return wait(); },
      async deleteUscita(id) { const u = db.uscite.find(x => x.id === id); if (u) u.deleted_at = new Date().toISOString(); persist(); return wait(); },
      async loadDelivery() {
        const acc = db.accrediti.filter(a => !a.deleted_at);
        const saldo = DELIVERY.map(({ id }) => ({
          piattaforma: id,
          vendite: Object.values(db.entrate).filter(e => e.canale === id).reduce((s, e) => s + Number(e.importo), 0),
          ricevuto: acc.filter(a => a.piattaforma === id).reduce((s, a) => s + Number(a.importo), 0),
        }));
        const accrediti = acc.slice().sort((a, b) => (b.data + b.created_at).localeCompare(a.data + a.created_at)).slice(0, 20);
        return wait({ saldo, accrediti });
      },
      async addAccredito(a) { db.accrediti.push({ ...a, id: uid(), created_at: new Date().toISOString() }); persist(); return wait(); },
      async deleteAccredito(id) { const a = db.accrediti.find(x => x.id === id); if (a) a.deleted_at = new Date().toISOString(); persist(); return wait(); },
    };
  }

  const store = useSupabase ? createSupabaseStore() : createLocalStore();

  // =====================================================================
  //  STATO
  // =====================================================================
  const state = {
    giorno: todayISO(),
    entrate: emptyEntrate(),   // { pranzo: { locale: 0, ... }, cena: {...} }
    uscite: [],
    storico: [],
    lastUpdate: null,
    delivery: { saldo: [], accrediti: [] },
  };
  function emptyEntrate() {
    return Object.fromEntries(SERVIZI.map(s => [s, Object.fromEntries(CANALI.map(c => [c.id, 0]))]));
  }

  // ---------- Coda di salvataggio (resiste a offline e chiusura pagina) ----------
  const pending = (() => { try { return JSON.parse(localStorage.getItem(PENDING_KEY)) || {}; } catch { return {}; } })();
  const savePending = () => { try { localStorage.setItem(PENDING_KEY, JSON.stringify(pending)); } catch {} };
  const pkey = (g, s, c) => `${g}|${s}|${c}`;
  const timers = {};
  let flushing = false;

  function queueSave(servizio, canale, importo) {
    const k = pkey(state.giorno, servizio, canale);
    pending[k] = importo;
    savePending();
    setSync();
    clearTimeout(timers[k]);
    timers[k] = setTimeout(flush, SAVE_DELAY);
  }

  async function flush() {
    if (flushing) return;
    const keys = Object.keys(pending);
    if (!keys.length) return setSync();
    flushing = true;
    setSync("saving");
    let failed = false;
    for (const k of keys) {
      const value = pending[k];
      const [g, s, c] = k.split("|");
      try {
        await store.saveEntrata(g, s, c, value);
        if (pending[k] === value) delete pending[k];   // non cancellare se nel frattempo è cambiato
        savePending();
        markInput(g, s, c, "saved");
      } catch (err) {
        console.error(err);
        failed = true;
        if (isAuthError(err)) return handleAuthLost();
        break;
      }
    }
    flushing = false;
    if (failed) { setSync("offline"); return; }
    if (Object.keys(pending).length) return flush();
    setSync("ok");
    refreshAfterSave();
  }

  const isAuthError = err => err && (err.status === 401 || /JWT|token/i.test(err.message || ""));

  function setSync(force) {
    const el = $("#sync");
    const n = Object.keys(pending).length;
    let st = force || (n ? "saving" : "ok");
    if (!navigator.onLine && n) st = "offline";
    el.dataset.state = st;
    el.textContent = st === "ok" ? "Salvato" : st === "saving" ? "Salvataggio…" : `Offline · ${n} in attesa`;
  }

  function markInput(g, s, c, cls) {
    if (g !== state.giorno) return;
    const inp = document.querySelector(`input[data-s="${s}"][data-c="${c}"]`);
    if (!inp) return;
    inp.classList.remove("is-saved", "is-pending");
    if (cls === "saved") {
      inp.classList.add("is-saved");
      setTimeout(() => inp.classList.remove("is-saved"), 1200);
    } else if (cls === "pending") inp.classList.add("is-pending");
  }

  // Dopo un salvataggio aggiorna storico e saldo delivery (senza toccare gli input)
  let refreshTimer;
  function refreshAfterSave() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      try {
        const [day] = await Promise.all([store.loadDay(state.giorno), loadDelivery()]);
        state.storico = day.storico;
        state.lastUpdate = latest(day.entrate);
        renderStorico();
        renderLastUpdate();
      } catch (e) { console.warn(e); }
    }, 400);
  }

  const latest = rows => rows.reduce((m, r) => (!m || r.updated_at > m ? r.updated_at : m), null);

  // =====================================================================
  //  RENDER
  // =====================================================================
  function buildChannelInputs() {
    for (const servizio of SERVIZI) {
      const box = $(`[data-channels="${servizio}"]`);
      box.innerHTML = CANALI.map((c, i) => `
        <label class="channel" style="--c:${c.color}">
          <span class="channel-name">${c.nome}<small>${c.sub}</small></span>
          <span class="money">
            <input type="text" inputmode="decimal" autocomplete="off" placeholder="0"
                   enterkeyhint="${i === CANALI.length - 1 ? "done" : "next"}"
                   data-s="${servizio}" data-c="${c.id}" aria-label="${c.nome} ${servizio}" />
            <span>€</span>
          </span>
        </label>`).join("");
    }
  }

  function fillInputs({ onlyIdle = false } = {}) {
    document.querySelectorAll("input[data-s]").forEach(inp => {
      const { s, c } = inp.dataset;
      if (onlyIdle && (inp === document.activeElement || pkey(state.giorno, s, c) in pending)) return;
      inp.value = fmtInput(state.entrate[s][c]);
      inp.classList.toggle("is-pending", pkey(state.giorno, s, c) in pending);
    });
  }

  function totals() {
    const e = state.entrate;
    const servizio = Object.fromEntries(SERVIZI.map(s => [s, round2(CANALI.reduce((t, c) => t + e[s][c.id], 0))]));
    const canale = Object.fromEntries(CANALI.map(c => [c.id, round2(SERVIZI.reduce((t, s) => t + e[s][c.id], 0))]));
    const entrate = round2(servizio.pranzo + servizio.cena);
    const uscite = round2(state.uscite.reduce((t, u) => t + Number(u.importo), 0));
    return { servizio, canale, entrate, uscite, risultato: round2(entrate - uscite) };
  }

  function renderTotals() {
    const t = totals();
    $("#tot-giorno").textContent = fmt(t.entrate);
    $("#sum-pranzo").textContent = fmt(t.servizio.pranzo);
    $("#sum-cena").textContent = fmt(t.servizio.cena);
    $(`[data-total="pranzo"]`).textContent = fmt(t.servizio.pranzo);
    $(`[data-total="cena"]`).textContent = fmt(t.servizio.cena);
    $("#tot-uscite").textContent = fmt(t.uscite);
    $("#uscite-total").textContent = fmt(t.uscite);
    $("#tot-risultato").textContent = fmt(t.risultato);
    $("#kpi-result").dataset.sign = t.risultato > 0 ? "pos" : t.risultato < 0 ? "neg" : "";

    const max = Math.max(...Object.values(t.canale), 0);
    $("#platforms").innerHTML = CANALI.map(c => {
      const p = state.entrate.pranzo[c.id], k = state.entrate.cena[c.id], tot = t.canale[c.id];
      const pct = t.entrate ? Math.round((tot / t.entrate) * 100) : 0;
      return `
        <div class="platform" style="--c:${c.color}">
          <div class="platform-top">
            <span class="platform-name">${c.nome}</span>
            <span class="platform-total">${fmt(tot)}</span>
          </div>
          <div class="bar"><i style="width:${max ? (tot / max) * 100 : 0}%"></i></div>
          <span class="platform-detail">Pranzo ${fmt(p)} · Cena ${fmt(k)} · ${pct}% del giorno</span>
        </div>`;
    }).join("");
  }

  function renderUscite() {
    const ul = $("#uscite-list");
    if (!state.uscite.length) { ul.innerHTML = `<li class="empty">Nessuna uscita registrata</li>`; return; }
    ul.innerHTML = state.uscite.map(u => `
      <li>
        <span><span class="li-title">${esc(u.descrizione)}</span><br>
          <span class="li-sub">${CATEGORIE[u.categoria] || esc(u.categoria)} · ${u.metodo === "banca" ? "Banca" : "Cassa"}</span></span>
        <span class="li-amount">${fmt(u.importo)}</span>
        <button class="li-del" data-del-uscita="${esc(u.id)}" aria-label="Elimina uscita">✕</button>
      </li>`).join("");
  }

  function renderStorico() {
    const ul = $("#storico-list");
    $("#storico-count").textContent = state.storico.length ? `${state.storico.length} modifiche` : "";
    if (!state.storico.length) { ul.innerHTML = `<li class="empty">Nessuna modifica</li>`; return; }
    ul.innerHTML = state.storico.map(r => `
      <li>
        <span>${timeHM(r.modificato_at)} · <b>${r.servizio === "pranzo" ? "Pranzo" : "Cena"}</b> · ${NOME[r.canale] || esc(r.canale)}</span>
        <span class="li-amount">${r.importo_precedente == null ? "" : fmt(r.importo_precedente) + " → "}${fmt(r.importo_nuovo)}</span>
      </li>`).join("");
  }

  function renderLastUpdate() {
    $("#last-update").textContent = state.lastUpdate
      ? new Date(state.lastUpdate).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      : "—";
  }

  function renderDay() {
    const d = fromISO(state.giorno);
    $("#day-weekday").textContent = d.toLocaleDateString("it-IT", { weekday: "long" });
    $("#day-date").textContent = d.toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
    $("#day-input").value = state.giorno;
    $("#day-today").setAttribute("aria-pressed", String(state.giorno === todayISO()));
  }

  function renderDelivery() {
    const { saldo, accrediti } = state.delivery;
    const by = Object.fromEntries(saldo.map(r => [r.piattaforma, r]));
    $("#delivery").innerHTML = DELIVERY.map(c => {
      const r = by[c.id] || { vendite: 0, ricevuto: 0 };
      const due = round2(Number(r.vendite) - Number(r.ricevuto));
      return `
        <div class="dlv" style="--c:${c.color}">
          <span class="dlv-name">${c.nome}</span>
          <span class="dlv-col"><small>Registrate</small>${fmt(r.vendite)}</span>
          <span class="dlv-col"><small>Ricevute</small>${fmt(r.ricevuto)}</span>
          <span class="dlv-col dlv-col--due"><small>Da ricevere</small>${fmt(due)}</span>
        </div>`;
    }).join("");

    const ul = $("#accrediti-list");
    ul.innerHTML = accrediti.length
      ? accrediti.map(a => `
        <li>
          <span>${dateShort(a.data)} · <b>${NOME[a.piattaforma]}</b> · ${a.destinazione === "cassaforte" ? "Cassaforte" : "Banca"}${a.note ? " · " + esc(a.note) : ""}</span>
          <span><span class="li-amount">${fmt(a.importo)}</span>
            <button class="li-del" data-del-accredito="${esc(a.id)}" aria-label="Elimina accredito">✕</button></span>
        </li>`).join("")
      : `<li class="empty">Nessun accredito registrato</li>`;
  }

  // =====================================================================
  //  CARICAMENTO
  // =====================================================================
  let loadSeq = 0;
  async function loadDay({ soft = false } = {}) {
    const seq = ++loadSeq;
    const giorno = state.giorno;
    renderDay();
    if (!soft) { state.entrate = emptyEntrate(); applyPendingToState(); fillInputs(); renderTotals(); }
    try {
      const day = await store.loadDay(giorno);
      if (seq !== loadSeq) return;            // l'utente ha cambiato giorno nel frattempo
      const e = emptyEntrate();
      for (const r of day.entrate) if (e[r.servizio] && r.canale in e[r.servizio]) e[r.servizio][r.canale] = Number(r.importo);
      state.entrate = e;
      applyPendingToState();
      state.uscite = day.uscite;
      state.storico = day.storico;
      state.lastUpdate = latest(day.entrate);
      fillInputs({ onlyIdle: soft });
      renderTotals(); renderUscite(); renderStorico(); renderLastUpdate();
    } catch (err) {
      console.error(err);
      if (isAuthError(err)) return handleAuthLost();
      toast("Impossibile caricare i dati. Controlla la connessione.");
    }
  }

  // I valori non ancora salvati hanno la precedenza su quelli del server
  function applyPendingToState() {
    for (const [k, v] of Object.entries(pending)) {
      const [g, s, c] = k.split("|");
      if (g === state.giorno && state.entrate[s]) state.entrate[s][c] = v;
    }
  }

  async function loadDelivery() {
    try {
      state.delivery = await store.loadDelivery();
      renderDelivery();
    } catch (err) { console.error(err); }
  }

  // =====================================================================
  //  EVENTI
  // =====================================================================
  function bindEvents() {
    // Inserimento incassi
    document.addEventListener("input", e => {
      const inp = e.target.closest("input[data-s]");
      if (!inp) return;
      const v = parseEuro(inp.value);
      if (Number.isNaN(v)) { inp.classList.add("is-pending"); return; }
      const { s, c } = inp.dataset;
      state.entrate[s][c] = v;
      renderTotals();
      markInput(state.giorno, s, c, "pending");
      queueSave(s, c, v);
    });
    document.addEventListener("focusin", e => {
      const inp = e.target.closest("input[data-s], .money input");
      if (inp) setTimeout(() => inp.select(), 0);
    });
    document.addEventListener("focusout", e => {
      const inp = e.target.closest("input[data-s]");
      if (!inp) return;
      const { s, c } = inp.dataset;
      inp.value = fmtInput(state.entrate[s][c]);   // normalizza (es. "1.250,5" → "1250,5")
    });
    // Invio = campo successivo
    document.addEventListener("keydown", e => {
      if (e.key !== "Enter") return;
      const inp = e.target.closest("input[data-s]");
      if (!inp) return;
      e.preventDefault();
      const all = [...document.querySelectorAll("input[data-s]")];
      const next = all[all.indexOf(inp) + 1];
      next ? next.focus() : inp.blur();
    });

    // Navigazione giorni
    const goTo = iso => { if (!iso) return; state.giorno = iso; loadDay(); };
    $("#day-prev").onclick = () => goTo(addDays(state.giorno, -1));
    $("#day-next").onclick = () => goTo(addDays(state.giorno, 1));
    $("#day-today").onclick = () => goTo(todayISO());
    $("#day-input").onchange = e => goTo(e.target.value);

    // Uscite
    $("#uscita-form").onsubmit = async e => {
      e.preventDefault();
      const importo = parseEuro($("#u-importo").value);
      const descrizione = $("#u-desc").value.trim();
      if (!descrizione || !(importo > 0)) return toast("Inserisci descrizione e importo valido");
      const btn = e.submitter; if (btn) btn.disabled = true;
      try {
        await store.addUscita({ giorno: state.giorno, descrizione, importo, categoria: $("#u-cat").value, metodo: $("#u-metodo").value });
        $("#u-desc").value = ""; $("#u-importo").value = "";
        toast("Uscita aggiunta");
        await loadDay({ soft: true });
      } catch (err) { console.error(err); toast("Errore nel salvataggio dell'uscita"); }
      finally { if (btn) btn.disabled = false; }
    };
    $("#uscite-list").onclick = async e => {
      const id = e.target.closest("[data-del-uscita]")?.dataset.delUscita;
      if (!id || !confirm("Eliminare questa uscita?")) return;
      try { await store.deleteUscita(id); toast("Uscita eliminata"); await loadDay({ soft: true }); }
      catch (err) { console.error(err); toast("Errore durante l'eliminazione"); }
    };

    // Accrediti delivery
    $("#a-data").value = todayISO();
    $("#accredito-form").onsubmit = async e => {
      e.preventDefault();
      const importo = parseEuro($("#a-importo").value);
      if (!(importo > 0)) return toast("Inserisci un importo valido");
      const btn = e.submitter; if (btn) btn.disabled = true;
      try {
        await store.addAccredito({
          data: $("#a-data").value || todayISO(), piattaforma: $("#a-piatt").value, importo,
          destinazione: $("#a-dest").value, note: $("#a-note").value.trim() || null,
        });
        $("#a-importo").value = ""; $("#a-note").value = "";
        toast("Accredito registrato");
        await loadDelivery();
      } catch (err) { console.error(err); toast("Errore nel salvataggio dell'accredito"); }
      finally { if (btn) btn.disabled = false; }
    };
    $("#accrediti-list").onclick = async e => {
      const id = e.target.closest("[data-del-accredito]")?.dataset.delAccredito;
      if (!id || !confirm("Eliminare questo accredito?")) return;
      try { await store.deleteAccredito(id); toast("Accredito eliminato"); await loadDelivery(); }
      catch (err) { console.error(err); toast("Errore durante l'eliminazione"); }
    };

    // Rete e sincronizzazione tra dispositivi
    window.addEventListener("online", () => { setSync(); flush(); });
    window.addEventListener("offline", () => setSync());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") { flush(); loadDay({ soft: true }); loadDelivery(); }
    });
    setInterval(() => { if (Object.keys(pending).length) flush(); }, 15000);
    setInterval(() => { if (document.visibilityState === "visible" && !Object.keys(pending).length) loadDay({ soft: true }); }, 60000);
    window.addEventListener("beforeunload", e => {
      if (Object.keys(pending).length) { flush(); e.preventDefault(); e.returnValue = ""; }
    });

    $("#logout").onclick = async () => {
      if (store.demo) return toast("Modalità demo: nessun account collegato");
      if (Object.keys(pending).length && !confirm("Ci sono modifiche non ancora salvate. Uscire comunque?")) return;
      await store.auth.logout();
      showLogin();
    };
  }

  // =====================================================================
  //  AUTENTICAZIONE E AVVIO
  // =====================================================================
  let started = false;
  function showLogin() { $("#app").hidden = true; $("#login").hidden = false; }
  function handleAuthLost() { flushing = false; setSync("offline"); toast("Sessione scaduta, accedi di nuovo"); showLogin(); }

  function startApp() {
    $("#login").hidden = true;
    $("#app").hidden = false;
    $("#demo-banner").hidden = !store.demo;
    if (!started) { buildChannelInputs(); bindEvents(); started = true; }
    setSync();
    loadDay();
    loadDelivery();
    flush();
  }

  $("#login-form").onsubmit = async e => {
    e.preventDefault();
    $("#login-error").textContent = "";
    try {
      await store.auth.login($("#login-email").value.trim(), $("#login-password").value);
      $("#login-password").value = "";
      startApp();
    } catch (err) {
      $("#login-error").textContent = /invalid/i.test(err.message) ? "Email o password errate" : (err.message || "Errore di accesso");
    }
  };

  (async () => {
    const session = await store.auth.session();
    session ? startApp() : showLogin();
  })();
})();
