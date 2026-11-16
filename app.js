/* =====================================================================
   IRA POKÈ — Dashboard cassa giornaliera
   ===================================================================== */
(() => {
  "use strict";

  // ---------- Costanti ----------
  const SERVIZI = ["pranzo", "cena"];
  const CANALI = [
    { id: "contanti",  nome: "Contanti",  gruppo: "locale",   color: "var(--c-contanti)" },
    { id: "pos",       nome: "POS",       gruppo: "locale",   color: "var(--c-pos)" },
    { id: "glovo",     nome: "Glovo",     gruppo: "delivery", color: "var(--c-glovo)" },
    { id: "alfonsino", nome: "Alfonsino", gruppo: "delivery", color: "var(--c-alfonsino)" },
    { id: "avvoolo",   nome: "Avvoolo",   gruppo: "delivery", color: "var(--c-avvoolo)" },
  ];
  const GRUPPI = [
    { id: "locale",   nome: "Locale · vendite dirette" },
    { id: "delivery", nome: "Delivery" },
  ];
  // I dati salvati prima dell'aggiornamento come "locale" vengono letti come contanti
  const normCanale = c => (c === "locale" ? "contanti" : c);
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

  const monthRange = iso => {
    const d = fromISO(iso);
    return [toISO(new Date(d.getFullYear(), d.getMonth(), 1)), toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
  };
  const monthName = iso => fromISO(iso).toLocaleDateString("it-IT", { month: "long", year: "numeric" });
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
      async loadMonth(da, a) {
        const [entrate, uscite] = await Promise.all([
          sb.from("entrate").select("giorno,canale,importo").gte("giorno", da).lte("giorno", a).limit(5000).then(ok),
          sb.from("uscite").select("giorno,importo").gte("giorno", da).lte("giorno", a).is("deleted_at", null).limit(5000).then(ok),
        ]);
        return { entrate, uscite };
      },
    };
  }

  function createLocalStore() {
    const KEY = "irapoke_demo_db_v1";
    const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
    const db = Object.assign({ entrate: {}, storico: [], uscite: [] }, read());
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
      async loadMonth(da, a) {
        const inMonth = g => g >= da && g <= a;
        return wait({
          entrate: Object.values(db.entrate).filter(e => inMonth(e.giorno)),
          uscite: db.uscite.filter(u => !u.deleted_at && inMonth(u.giorno)),
        });
      },
    };
  }

  const store = useSupabase ? createSupabaseStore() : createLocalStore();

  // =====================================================================
  //  STATO
  // =====================================================================
  const state = {
    giorno: todayISO(),
    entrate: emptyEntrate(),   // { pranzo: { contanti: 0, pos: 0, ... }, cena: {...} }
    uscite: [],
    storico: [],
    lastUpdate: null,
    mese: { entrate: [], uscite: [] },
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

  // Dopo un salvataggio aggiorna storico e riepilogo mensile (senza toccare gli input)
  let refreshTimer;
  function refreshAfterSave() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      try {
        const [day] = await Promise.all([store.loadDay(state.giorno), loadMonth()]);
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
      box.innerHTML = GRUPPI.map(g => `
        <div class="group">
          <div class="group-head"><span>${g.nome}</span><b data-gtotal="${servizio}-${g.id}">0,00 €</b></div>
          ${CANALI.filter(c => c.gruppo === g.id).map(c => {
            const i = CANALI.indexOf(c);
            return `
        <label class="channel" style="--c:${c.color}">
          <span class="channel-name">${c.nome}</span>
          <span class="money">
            <input type="text" inputmode="decimal" autocomplete="off" placeholder="0"
                   enterkeyhint="${i === CANALI.length - 1 ? "done" : "next"}"
                   data-s="${servizio}" data-c="${c.id}" aria-label="${c.nome} ${servizio}" />
            <span>€</span>
          </span>
        </label>`; }).join("")}
        </div>`).join("");
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
    const gruppo = {};
    for (const s of SERVIZI) for (const g of GRUPPI)
      gruppo[`${s}-${g.id}`] = round2(CANALI.filter(c => c.gruppo === g.id).reduce((t, c) => t + e[s][c.id], 0));
    const uscite = round2(state.uscite.reduce((t, u) => t + Number(u.importo), 0));
    return { servizio, canale, gruppo, entrate, uscite, risultato: round2(entrate - uscite) };
  }

  function renderTotals() {
    const t = totals();
    $("#tot-giorno").textContent = fmt(t.entrate);
    $("#sum-pranzo").textContent = fmt(t.servizio.pranzo);
    $("#sum-cena").textContent = fmt(t.servizio.cena);
    $(`[data-total="pranzo"]`).textContent = fmt(t.servizio.pranzo);
    $(`[data-total="cena"]`).textContent = fmt(t.servizio.cena);
    for (const [k, v] of Object.entries(t.gruppo)) $(`[data-gtotal="${k}"]`).textContent = fmt(v);
    $("#sum-contanti").textContent = fmt(t.canale.contanti);
    $("#sum-pos").textContent = fmt(t.canale.pos);
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

  function renderMonth() {
    const { entrate, uscite } = state.mese;
    const [da] = monthRange(state.giorno);
    const giorni = {};
    const day = g => (giorni[g] ||= { entrate: 0, uscite: 0 });
    const perCanale = Object.fromEntries(CANALI.map(c => [c.id, 0]));
    for (const r of entrate) {
      const c = normCanale(r.canale), v = Number(r.importo) || 0;
      if (c in perCanale) perCanale[c] += v;
      day(r.giorno).entrate += v;
    }
    for (const u of uscite) day(u.giorno).uscite += Number(u.importo) || 0;

    const totE = round2(Object.values(perCanale).reduce((a, b) => a + b, 0));
    const totU = round2(uscite.reduce((a, u) => a + (Number(u.importo) || 0), 0));
    const ris = round2(totE - totU);
    const sign = ris > 0 ? "pos" : ris < 0 ? "neg" : "";

    $("#mese-titolo").textContent = monthName(da);
    $("#mese-entrate").textContent = fmt(totE);
    $("#mese-uscite").textContent = fmt(totU);
    $("#mese-risultato").textContent = fmt(ris);
    const badge = $("#mese-badge");
    badge.dataset.sign = sign;
    badge.textContent = sign === "pos" ? "▲ In positivo" : sign === "neg" ? "▼ In negativo" : "In pareggio";
    $("#mese-canali").innerHTML = CANALI.map(c =>
      `<span class="mc" style="--c:${c.color}"><i></i>${c.nome}<b>${fmt(perCanale[c.id])}</b></span>`).join("");

    const righe = Object.entries(giorni).sort((a, b) => b[0].localeCompare(a[0]));
    $("#mese-count").textContent = righe.length ? `${righe.length} giorni` : "";
    $("#mese-giorni").innerHTML = righe.length ? righe.map(([g, v]) => {
      const r = round2(v.entrate - v.uscite);
      return `<li data-go="${g}" class="${g === state.giorno ? "is-current" : ""}">
        <span class="li-title">${fromISO(g).toLocaleDateString("it-IT", { weekday: "short", day: "numeric" })}</span>
        <span class="li-sub">+${fmt(v.entrate)} · −${fmt(v.uscite)}</span>
        <span class="li-amount ${r < 0 ? "neg" : "pos"}">${fmt(r)}</span>
      </li>`;
    }).join("") : `<li class="empty">Nessun dato in questo mese</li>`;
  }

  // =====================================================================
  //  CARICAMENTO
  // =====================================================================
  let loadSeq = 0;
  let meseCaricato = null;
  async function loadDay({ soft = false } = {}) {
    const seq = ++loadSeq;
    const giorno = state.giorno;
    if (giorno.slice(0, 7) !== meseCaricato) { meseCaricato = giorno.slice(0, 7); loadMonth(); }
    else if (soft) loadMonth();
    renderDay();
    if (!soft) { state.entrate = emptyEntrate(); applyPendingToState(); fillInputs(); renderTotals(); }
    try {
      const day = await store.loadDay(giorno);
      if (seq !== loadSeq) return;            // l'utente ha cambiato giorno nel frattempo
      const e = emptyEntrate();
      for (const r of day.entrate) {
        const c = normCanale(r.canale);
        if (e[r.servizio] && c in e[r.servizio]) e[r.servizio][c] += Number(r.importo);
      }
      state.entrate = e;
      applyPendingToState();
      state.uscite = day.uscite;
      state.storico = day.storico;
      state.lastUpdate = latest(day.entrate);
      fillInputs({ onlyIdle: soft });
      renderTotals(); renderUscite(); renderStorico(); renderLastUpdate(); renderMonth();
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

  let monthSeq = 0;
  async function loadMonth() {
    const seq = ++monthSeq;
    try {
      const [da, a] = monthRange(state.giorno);
      const mese = await store.loadMonth(da, a);
      if (seq !== monthSeq) return;
      state.mese = mese;
      renderMonth();
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

    // Riepilogo mese: tocca un giorno per aprirlo
    $("#mese-giorni").onclick = e => {
      const g = e.target.closest("[data-go]")?.dataset.go;
      if (g) { goTo(g); window.scrollTo({ top: 0, behavior: "smooth" }); }
    };

    // Rete e sincronizzazione tra dispositivi
    window.addEventListener("online", () => { setSync(); flush(); });
    window.addEventListener("offline", () => setSync());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") { flush(); loadDay({ soft: true }); }
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
