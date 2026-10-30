(function () {
  'use strict';
  const L = window.Logic;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  const today = () => L.iso(new Date());
  const CYCLES = ['weekly', 'monthly', 'quarterly', 'yearly'];

  let db = null, key = null, tab = 'home';
  const emptyDb = () => ({ v: 1, base: 'USD', rates: Object.assign({}, L.DEFAULT_RATES), txs: [], budgets: [], subs: [], trips: [],
    cards: [], syncUrl: '', notified: {} });

  /* ---------- Encrypted storage (PBKDF2 -> AES-GCM) ---------- */
  const b64 = u => btoa(String.fromCharCode(...new Uint8Array(u)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const enc = new TextEncoder(), dec = new TextDecoder();
  async function deriveKey(pass, salt) {
    const m = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, m, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(obj, k, salt) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(JSON.stringify(obj)));
    return JSON.stringify({ salt: b64(salt), iv: b64(iv), ct: b64(ct) });
  }
  async function open(blob, pass) {
    const o = JSON.parse(blob), salt = unb64(o.salt);
    const k = await deriveKey(pass, salt);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, k, unb64(o.ct));
    return { data: JSON.parse(dec.decode(pt)), k, salt };
  }
  let salt = null;
  async function save() {
    localStorage.setItem('et.data', await seal(db, key, salt));
    scheduleSync();
  }

  /* ---------- Cloud sync (optional, encrypted blob to user's endpoint) ---------- */
  let syncT = null;
  function scheduleSync() { clearTimeout(syncT); if (db.syncUrl) syncT = setTimeout(push, 1500); }
  async function push() {
    try { const r = await fetch(db.syncUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: localStorage.getItem('et.data') });
      if (!r.ok) throw new Error(r.status); } catch (e) { toast('Cloud sync failed: ' + e.message); }
  }
  async function pull(pass) {
    const r = await fetch(db.syncUrl); if (!r.ok) throw new Error('HTTP ' + r.status);
    const o = await open(await r.text(), pass); db = o.data; await save();
  }

  /* ---------- UI helpers ---------- */
  function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2500); }
  const money = (n, c) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: c || db.base }).format(n); } catch (e) { return n.toFixed(2) + ' ' + c; } };
  const cur = () => Object.keys(db.rates);
  const opts = (arr, sel) => arr.map(x => `<option${x === sel ? ' selected' : ''}>${esc(x)}</option>`).join('');
  function applyBars(root) { root.querySelectorAll('[data-w]').forEach(e => { e.style.width = Math.min(100, +e.dataset.w) + '%'; }); }
  const barCls = p => p >= 100 ? 'b' : p >= 80 ? 'w' : '';

  function dialog(html, onSubmit) {
    const d = $('#dlg'); d.innerHTML = `<form method="dialog">${html}<div class="actions"><button class="primary" value="ok">Save</button><button value="x" formnovalidate>Cancel</button></div></form>`;
    d.showModal();
    d.querySelector('form').onsubmit = async ev => { if (ev.submitter && ev.submitter.value === 'x') return; await onSubmit(Object.fromEntries(new FormData(ev.target))); render(); };
    return d;
  }

  /* ---------- Add / edit transaction ---------- */
  function txForm(t) {
    t = t || { type: 'expense', date: today(), currency: db.base, category: 'Other', amount: '', description: '' };
    const cards = [''].concat(db.cards.map(c => c.id));
    const d = dialog(`
      <h3>${t.id ? 'Edit' : 'Add'} transaction</h3>
      <div class="actions"><button type="button" data-a="voice">🎤 Voice</button><button type="button" data-a="scan">📷 Scan receipt</button><input id="rcpt" type="file" accept="image/*" capture="environment" hidden></div>
      <label>Type<select name="type"><option${t.type === 'expense' ? ' selected' : ''}>expense</option><option${t.type === 'income' ? ' selected' : ''}>income</option></select></label>
      <label>Amount<input name="amount" type="number" step="0.01" min="0.01" required value="${esc(t.amount)}"></label>
      <label>Currency<select name="currency">${opts(cur(), t.currency)}</select></label>
      <label>Description<input name="description" value="${esc(t.description)}"></label>
      <label>Category<select name="category">${opts(L.CATEGORIES, t.category)}</select></label>
      <label>Date<input name="date" type="date" required value="${esc(t.date)}"></label>
      <label>Card<select name="cardId">${cards.map(id => `<option value="${esc(id)}"${id === t.cardId ? ' selected' : ''}>${esc(id ? (db.cards.find(c => c.id === id) || {}).name : 'None / cash')}</option>`).join('')}</select></label>
      <label>Trip<select name="tripId"><option value="">None</option>${db.trips.map(x => `<option value="${esc(x.id)}"${x.id === t.tripId ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" name="taxDeductible"${t.taxDeductible ? ' checked' : ''}> Tax deductible</label>`,
      async f => {
        const o = { id: t.id || uid(), type: f.type, amount: +f.amount, currency: f.currency, description: f.description.trim(), category: f.category,
          date: f.date, cardId: f.cardId || '', tripId: f.tripId || '', taxDeductible: !!f.taxDeductible };
        if (!(o.amount > 0)) return toast('Invalid amount');
        const i = db.txs.findIndex(x => x.id === o.id); if (i >= 0) db.txs[i] = o; else db.txs.push(o);
        await save(); toast('Saved'); checkBudgetAlerts(o);
      });
    const fill = p => { const f = d.querySelector('form').elements;
      if (p.amount != null) f.amount.value = p.amount; if (p.description) f.description.value = p.description;
      if (p.category) f.category.value = p.category; if (p.date) f.date.value = p.date; };
    d.querySelector('[data-a=voice]').onclick = () => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return toast('Voice input not supported in this browser');
      const r = new SR(); r.lang = navigator.language || 'en-US';
      r.onresult = e => { const p = L.parseVoice(e.results[0][0].transcript); p ? (fill(p), toast('Heard: ' + e.results[0][0].transcript)) : toast("Couldn't find an amount"); };
      r.onerror = e => toast('Voice error: ' + e.error); r.start(); toast('Listening… e.g. "spent 12 on lunch"');
    };
    const file = d.querySelector('#rcpt');
    d.querySelector('[data-a=scan]').onclick = () => file.click();
    file.onchange = async () => {
      if (!file.files[0]) return;
      try { toast('Reading receipt…'); await loadTesseract();
        const { data } = await window.Tesseract.recognize(file.files[0], 'eng'); const p = L.parseReceipt(data.text);
        fill({ amount: p.total, description: p.merchant, category: p.category, date: p.date }); toast(p.total != null ? 'Receipt scanned - please verify' : 'No total found');
      } catch (e) { toast('OCR unavailable (needs internet): ' + e.message); }
    };
  }
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve();
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = res; s.onerror = () => rej(new Error('load failed')); document.head.appendChild(s); });
  }

  /* ---------- Notifications ---------- */
  function notify(title, body, id) {
    if (id) { if (db.notified[id]) return; db.notified[id] = today(); save(); }
    toast(title + ': ' + body);
    if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
  }
  function checkBudgetAlerts(t) {
    const now = new Date();
    db.budgets.forEach(b => { const s = L.budgetStatus(b, db.txs, db.rates, db.base, now);
      if (s.pct >= 100) notify('Budget exceeded', `${b.category || 'All'} ${b.period}`, `b${b.id}${s.range.start}100`);
      else if (s.pct >= 80) notify('Budget 80% used', `${b.category || 'All'} ${b.period}`, `b${b.id}${s.range.start}80`); });
  }
  function checkDue() {
    L.dueSoon(db.subs, new Date(), 3).forEach(s => notify('Bill due', `${s.name} ${money(s.amount, s.currency)} on ${s.nextDue}`, `s${s.id}${s.nextDue}`));
  }

  /* ---------- Views ---------- */
  const TABS = { home: '🏠 Home', txs: '🧾 Activity', budgets: '🎯 Budgets', reports: '📊 Reports', subs: '🔁 Bills', trips: '✈️ Trips', cards: '💳 Cards', ai: '🤖 Assistant', settings: '⚙️ Settings' };
  const views = {
    home() {
      const r = L.periodRange('monthly', new Date()), s = L.summary(db.txs, r, db.rates, db.base);
      const ins = L.insights(db.txs, db.rates, db.base, new Date());
      const due = L.dueSoon(db.subs, new Date(), 7);
      return `<div class="card"><div class="mut">This month</div><div class="grid"><div>Income<b class="pos">${money(s.income)}</b></div><div>Spent<b class="neg">${money(s.expense)}</b></div><div>Net<b>${money(s.net)}</b></div></div></div>
      <div class="card"><b>AI insights</b>${ins.map(i => `<div class="row"><span>${i.level === 'warn' ? '⚠️' : i.level === 'ok' ? '✅' : 'ℹ️'} ${esc(i.text)}</span></div>`).join('')}</div>
      <div class="card"><b>Upcoming bills</b>${due.map(x => `<div class="row"><span>${esc(x.name)}<br><span class="mut">${esc(x.nextDue)}</span></span><b>${money(x.amount, x.currency)}</b></div>`).join('') || '<p class="mut">Nothing due this week.</p>'}</div>
      <div class="card"><b>Recent</b>${txRows(db.txs.slice().sort(byDate).slice(0, 5))}</div>`;
    },
    txs() {
      const q = (state.q || '').toLowerCase();
      const list = db.txs.slice().sort(byDate).filter(t => !q || (t.description + t.category).toLowerCase().includes(q));
      return `<input id="q" placeholder="Search…" value="${esc(state.q || '')}"><div class="card">${txRows(list) || '<p class="mut">No transactions yet. Tap ＋ Add.</p>'}</div>`;
    },
    budgets() {
      const rows = db.budgets.map(b => { const s = L.budgetStatus(b, db.txs, db.rates, db.base, new Date());
        return `<div class="card"><div class="row"><b>${esc(b.category || 'All')} · ${esc(b.period)}</b><button class="danger" data-act="delBudget" data-id="${esc(b.id)}">✕</button></div>
        <div class="mut">${esc(s.range.start)} → ${esc(s.range.end)}</div><div class="bar"><i class="${barCls(s.pct)}" data-w="${s.pct}"></i></div>
        <div class="row"><span>${money(s.spent)} of ${money(b.limit)}</span><span class="${s.remaining < 0 ? 'neg' : ''}">${money(s.remaining)} left</span></div></div>`; }).join('');
      return `<button class="primary" data-act="addBudget">＋ New budget</button><br><br>${rows || '<p class="mut">No budgets yet.</p>'}`;
    },
    reports() {
      const now = new Date(), w = L.summary(db.txs, L.periodRange('weekly', now), db.rates, db.base), m = L.summary(db.txs, L.periodRange('monthly', now), db.rates, db.base);
      const cats = Object.entries(m.byCategory).sort((a, b) => b[1] - a[1]);
      const yr = now.getFullYear(), tax = L.taxReport(db.txs, yr, db.rates, db.base);
      return `<div class="card"><b>Weekly</b><div class="grid"><div>Income<b>${money(w.income)}</b></div><div>Spent<b>${money(w.expense)}</b></div><div>Net<b>${money(w.net)}</b></div></div></div>
      <div class="card"><b>Monthly breakdown</b><canvas id="pie" width="600" height="360"></canvas>${cats.map(([c, v]) => `<div class="row"><span>${esc(c)}</span><b>${money(v)}</b></div>`).join('') || '<p class="mut">No data.</p>'}</div>
      <div class="card"><b>Last 6 months spending</b><canvas id="bars" width="600" height="360"></canvas></div>
      <div class="card"><b>Tax ${yr}</b><p>${tax.rows.length} deductible expenses, total ${money(tax.total)}</p><div class="actions"><button data-act="exportTax">⬇ Export tax CSV</button><button data-act="exportCsv">⬇ Export all CSV</button></div></div>`;
    },
    subs() {
      const total = db.subs.reduce((a, s) => a + L.convert(L.monthlyCost(s), s.currency, db.base, db.rates), 0);
      return `<button class="primary" data-act="addSub">＋ Add bill / subscription</button><p class="mut">≈ ${money(total)} per month</p>` +
        db.subs.slice().sort((a, b) => a.nextDue.localeCompare(b.nextDue)).map(s => `<div class="card"><div class="row"><b>${esc(s.name)}</b><b>${money(s.amount, s.currency)}</b></div>
        <div class="mut">${esc(s.cycle)} · next due ${esc(s.nextDue)}</div><div class="actions"><button data-act="paySub" data-id="${esc(s.id)}">✓ Mark paid</button><button class="danger" data-act="delSub" data-id="${esc(s.id)}">Delete</button></div></div>`).join('');
    },
    trips() {
      return `<button class="primary" data-act="addTrip">＋ New trip</button><br><br>` + db.trips.map(t => { const r = L.tripTotals(t, db.txs, db.rates, db.base);
        const pct = r.budget ? r.total / r.budget * 100 : 0;
        return `<div class="card"><div class="row"><b>${esc(t.name)}</b><button class="danger" data-act="delTrip" data-id="${esc(t.id)}">✕</button></div><div class="mut">${esc(t.start)} → ${esc(t.end)} (${r.days} days)</div>
        <div class="bar"><i class="${barCls(pct)}" data-w="${pct}"></i></div>
        <div class="row"><span>Spent ${money(r.total)} / ${money(r.budget)}</span><span class="${r.remaining < 0 ? 'neg' : ''}">${money(r.remaining)} left</span></div>
        <div class="row"><span>Per day ${money(r.perDay)}</span><span class="${r.perDiemLimit && r.perDay > r.perDiemLimit ? 'neg' : ''}">Per-diem ${money(r.perDiemLimit)}</span></div>
        ${Object.entries(r.byCategory).map(([c, v]) => `<div class="row"><span class="mut">${esc(c)}</span><span>${money(v)}</span></div>`).join('')}</div>`; }).join('');
    },
    cards() {
      return `<button class="primary" data-act="addCard">＋ Add card</button><br><br>` + db.cards.map(c => {
        const spent = L.sumExpenses(db.txs, db.rates, db.base, t => t.cardId === c.id);
        return `<div class="card"><div class="row"><b>${esc(c.name)}</b><button class="danger" data-act="delCard" data-id="${esc(c.id)}">✕</button></div>
        <div class="mut">${esc(c.type)} · •••• ${esc(c.last4)}</div><div class="row"><span>Total spent</span><b>${money(spent)}</b></div></div>`; }).join('') ||
        '<p class="mut">Only a nickname, type and last 4 digits are stored. Never enter full card numbers.</p>';
    },
    ai() {
      return `<div class="card"><div id="chat">${(state.chat || []).map(m => `<div class="chat ${m.me ? 'me' : ''}">${esc(m.t)}</div>`).join('') || '<p class="mut">Ask: "How are my budgets?", "Where do I spend most?", "Give me saving tips".</p>'}</div>
        <form id="chatForm"><input id="chatIn" placeholder="Ask your assistant…" required autocomplete="off"><button class="primary">Send</button></form></div>`;
    },
    settings() {
      return `<div class="card"><label>Base currency<select id="baseCur">${opts(cur(), db.base)}</select></label>
        <b>Exchange rates (per 1 USD)</b>${cur().map(c => `<div class="row"><span>${esc(c)}</span><input class="rate" data-c="${esc(c)}" type="number" step="any" min="0.0001" value="${esc(db.rates[c])}"></div>`).join('')}
        <div class="actions"><button data-act="addCur">＋ Add currency</button><button data-act="liveRates">↻ Fetch live rates</button></div></div>
      <div class="card"><b>Notifications</b><div class="actions"><button data-act="notifPerm">Enable push notifications</button></div></div>
      <div class="card"><b>Backup &amp; sync</b><p class="mut">Data is encrypted on this device with your passphrase. Backups and synced copies stay encrypted.</p>
        <div class="actions"><button data-act="exportBackup">⬇ Encrypted backup</button><button data-act="importBackup">⬆ Restore</button><input id="restore" type="file" accept=".json" hidden></div>
        <label>Cloud sync URL (your HTTPS endpoint accepting PUT/GET)<input id="syncUrl" type="url" placeholder="https://…" value="${esc(db.syncUrl)}"></label>
        <div class="actions"><button data-act="saveSync">Save URL &amp; push</button><button data-act="pullSync">Pull from cloud</button></div></div>
      <div class="card"><b>Security</b><div class="actions"><button data-act="lock">🔒 Lock now</button><button data-act="changePin">Change passphrase</button><button class="danger" data-act="wipe">Erase all data</button></div></div>`;
    }
  };
  const state = {};
  const byDate = (a, b) => b.date.localeCompare(a.date);
  function txRows(list) {
    return list.map(t => `<div class="row"><span>${esc(t.description || t.category)}${t.taxDeductible ? ' 🏷️' : ''}<br><span class="mut">${esc(t.date)} · ${esc(t.category)}</span></span>
      <span><b class="${t.type === 'income' ? 'pos' : ''}">${t.type === 'income' ? '+' : '-'}${money(t.amount, t.currency)}</b><br><button data-act="editTx" data-id="${esc(t.id)}">✎</button> <button class="danger" data-act="delTx" data-id="${esc(t.id)}">✕</button></span></div>`).join('');
  }

  function drawCharts() {
    const css = getComputedStyle(document.body), fg = css.color;
    const pie = $('#pie'); if (pie) {
      const g = pie.getContext('2d'), m = L.summary(db.txs, L.periodRange('monthly', new Date()), db.rates, db.base);
      const e = Object.entries(m.byCategory), tot = e.reduce((a, x) => a + x[1], 0); let a0 = -Math.PI / 2;
      e.forEach(([c, v], i) => { const a1 = a0 + v / tot * 2 * Math.PI; g.beginPath(); g.moveTo(180, 180); g.arc(180, 180, 160, a0, a1); g.fillStyle = `hsl(${i * 47},65%,50%)`; g.fill();
        g.fillStyle = fg; g.font = '18px sans-serif'; g.fillRect(380, 20 + i * 26, 14, 14); g.fillStyle = fg; g.fillText(c, 402, 33 + i * 26); a0 = a1; });
    }
    const bars = $('#bars'); if (bars) {
      const g = bars.getContext('2d'), now = new Date(), data = [];
      for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        data.push([d.toLocaleString(undefined, { month: 'short' }), L.summary(db.txs, L.periodRange('monthly', d), db.rates, db.base).expense]); }
      const mx = Math.max(1, ...data.map(x => x[1]));
      data.forEach(([l, v], i) => { const h = v / mx * 280; g.fillStyle = '#0f766e'; g.fillRect(20 + i * 95, 310 - h, 70, h); g.fillStyle = fg; g.font = '20px sans-serif'; g.fillText(l, 30 + i * 95, 340); g.font = '16px sans-serif'; g.fillText(Math.round(v), 25 + i * 95, 300 - h); });
    }
  }

  function render() {
    $('#tabs').innerHTML = Object.entries(TABS).map(([k, v]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${v}</button>`).join('');
    $('#view').innerHTML = views[tab](); applyBars($('#view')); drawCharts();
  }

  /* ---------- Download helper ---------- */
  function download(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- Actions ---------- */
  const A = {
    async delTx(id) { if (confirm('Delete transaction?')) { db.txs = db.txs.filter(t => t.id !== id); await save(); } },
    editTx(id) { txForm(db.txs.find(t => t.id === id)); },
    addBudget() { dialog(`<h3>New budget</h3><label>Category<select name="category"><option>All</option>${opts(L.CATEGORIES)}</select></label>
      <label>Period<select name="period">${opts(['daily', 'weekly', 'monthly', 'custom'], 'monthly')}</select></label>
      <label>Limit (${esc(db.base)})<input name="limit" type="number" step="0.01" min="0.01" required></label>
      <label>Custom start<input name="start" type="date"></label><label>Custom end<input name="end" type="date"></label>`,
      async f => { if (f.period === 'custom' && !(f.start && f.end && f.start <= f.end)) return toast('Custom budgets need valid start/end dates');
        db.budgets.push({ id: uid(), category: f.category, period: f.period, limit: +f.limit, start: f.start, end: f.end }); await save(); }); },
    async delBudget(id) { db.budgets = db.budgets.filter(b => b.id !== id); await save(); },
    addSub() { dialog(`<h3>Bill / subscription</h3><label>Name<input name="name" required></label><label>Amount<input name="amount" type="number" step="0.01" min="0.01" required></label>
      <label>Currency<select name="currency">${opts(cur(), db.base)}</select></label><label>Cycle<select name="cycle">${opts(CYCLES, 'monthly')}</select></label>
      <label>Next due<input name="nextDue" type="date" required value="${today()}"></label>`,
      async f => { db.subs.push({ id: uid(), name: f.name.trim(), amount: +f.amount, currency: f.currency, cycle: f.cycle, nextDue: f.nextDue }); await save(); checkDue(); }); },
    async paySub(id) { const s = db.subs.find(x => x.id === id);
      db.txs.push({ id: uid(), type: 'expense', amount: s.amount, currency: s.currency, description: s.name, category: L.guessCategory(s.name) === 'Other' ? 'Subscriptions' : L.guessCategory(s.name), date: today(), cardId: '', tripId: '', taxDeductible: false });
      s.nextDue = L.addCycle(s.nextDue, s.cycle); await save(); toast('Payment logged'); },
    async delSub(id) { db.subs = db.subs.filter(s => s.id !== id); await save(); },
    addTrip() { dialog(`<h3>New trip</h3><label>Name<input name="name" required></label><label>Start<input name="start" type="date" required value="${today()}"></label>
      <label>End<input name="end" type="date" required value="${today()}"></label><label>Total budget (${esc(db.base)})<input name="budget" type="number" step="0.01" min="0"></label>
      <label>Daily per-diem (${esc(db.base)})<input name="perDiem" type="number" step="0.01" min="0"></label>`,
      async f => { if (f.end < f.start) return toast('End is before start'); db.trips.push({ id: uid(), name: f.name.trim(), start: f.start, end: f.end, budget: +f.budget || 0, perDiem: +f.perDiem || 0 }); await save(); }); },
    async delTrip(id) { db.trips = db.trips.filter(t => t.id !== id); db.txs.forEach(t => { if (t.tripId === id) t.tripId = ''; }); await save(); },
    addCard() { dialog(`<h3>Add card</h3><label>Nickname<input name="name" required></label><label>Type<select name="type">${opts(['Credit', 'Debit', 'Corporate'])}</select></label>
      <label>Last 4 digits<input name="last4" pattern="\\d{4}" maxlength="4" inputmode="numeric" required></label>`,
      async f => { db.cards.push({ id: uid(), name: f.name.trim(), type: f.type, last4: f.last4 }); await save(); }); },
    async delCard(id) { db.cards = db.cards.filter(c => c.id !== id); db.txs.forEach(t => { if (t.cardId === id) t.cardId = ''; }); await save(); },
    exportTax() { download(`tax-${new Date().getFullYear()}.csv`, L.taxReport(db.txs, new Date().getFullYear(), db.rates, db.base).csv, 'text/csv'); },
    exportCsv() { const h = ['Date', 'Type', 'Description', 'Category', 'Amount', 'Currency', 'TaxDeductible'];
      download('expenses.csv', [h].concat(db.txs.slice().sort(byDate).map(t => [t.date, t.type, t.description, t.category, t.amount, t.currency, !!t.taxDeductible])).map(r => r.map(L.csvCell).join(',')).join('\n'), 'text/csv'); },
    addCur() { const c = (prompt('Currency code (e.g. SEK)') || '').toUpperCase().trim(); if (!/^[A-Z]{3}$/.test(c)) return;
      const r = +prompt('Units of ' + c + ' per 1 USD'); if (!(r > 0)) return; db.rates[c] = r; save().then(render); },
    async liveRates() { try { const r = await fetch('https://open.er-api.com/v6/latest/USD'); const j = await r.json();
        cur().forEach(c => { if (j.rates && j.rates[c] > 0) db.rates[c] = j.rates[c]; }); await save(); toast('Rates updated'); render(); } catch (e) { toast('Could not fetch rates'); } },
    async notifPerm() { if (!('Notification' in window)) return toast('Not supported'); toast('Permission: ' + await Notification.requestPermission()); checkDue(); },
    async exportBackup() { download(`expense-backup-${today()}.json`, await seal(db, key, salt), 'application/json'); },
    importBackup() { $('#restore').click(); },
    async saveSync() { db.syncUrl = $('#syncUrl').value.trim(); if (db.syncUrl && !/^https:\/\//.test(db.syncUrl)) { db.syncUrl = ''; return toast('HTTPS URL required'); } await save(); if (db.syncUrl) await push(); toast('Saved'); },
    async pullSync() { const p = prompt('Passphrase used for the cloud copy'); if (!p || !db.syncUrl) return; try { await pull(p); toast('Restored'); render(); } catch (e) { toast('Pull failed'); } },
    lock() { key = null; db = null; location.reload(); },
    changePin() { const p = prompt('New passphrase (min 4 chars)'); if (!p || p.length < 4) return; salt = crypto.getRandomValues(new Uint8Array(16));
      deriveKey(p, salt).then(k => { key = k; return save(); }).then(() => toast('Passphrase changed')); },
    wipe() { if (confirm('Erase ALL data on this device?')) { localStorage.removeItem('et.data'); location.reload(); } }
  };

  /* ---------- Events ---------- */
  document.addEventListener('click', async e => {
    const t = e.target.closest('[data-tab],[data-act]'); if (!t || !db) return;
    if (t.dataset.tab) { tab = t.dataset.tab; render(); }
    else if (A[t.dataset.act]) { await A[t.dataset.act](t.dataset.id); if (!$('#dlg').open) render(); }
  });
  document.addEventListener('input', e => {
    if (!db) return;
    if (e.target.id === 'q') { state.q = e.target.value; const p = e.target.selectionStart; render(); const q = $('#q'); q.focus(); q.setSelectionRange(p, p); }
  });
  document.addEventListener('change', async e => {
    if (!db) return;
    if (e.target.id === 'baseCur') { db.base = e.target.value; await save(); render(); }
    else if (e.target.classList.contains('rate')) { const v = +e.target.value; if (v > 0) { db.rates[e.target.dataset.c] = v; await save(); } }
    else if (e.target.id === 'restore' && e.target.files[0]) {
      const p = prompt('Passphrase of the backup'); if (!p) return;
      try { const o = await open(await e.target.files[0].text(), p); db = Object.assign(emptyDb(), o.data); await save(); toast('Restored'); render(); } catch (err) { toast('Restore failed: wrong passphrase or invalid file'); }
    }
  });
  document.addEventListener('submit', async e => {
    if (e.target.id !== 'chatForm') return; e.preventDefault();
    const q = $('#chatIn').value; state.chat = state.chat || [];
    state.chat.push({ me: true, t: q }, { t: L.assistant(q, { txs: db.txs, budgets: db.budgets, rates: db.rates, baseCur: db.base, now: new Date(), subs: db.subs }) }); render();
  });
  $('#addBtn').onclick = () => db && txForm();

  /* ---------- Lock screen ---------- */
  async function boot() {
    const blob = localStorage.getItem('et.data'), lock = $('#lock');
    lock.hidden = false; $('#pin').focus();
    if (blob) $('#lockMsg').textContent = 'Enter your passphrase to unlock.';
    $('#lockForm').onsubmit = async ev => {
      ev.preventDefault(); const p = $('#pin').value; $('#lockErr').textContent = '';
      try {
        if (blob) { const o = await open(blob, p); db = Object.assign(emptyDb(), o.data); key = o.k; salt = o.salt; }
        else { salt = crypto.getRandomValues(new Uint8Array(16)); key = await deriveKey(p, salt); db = emptyDb(); await save(); }
        $('#pin').value = ''; lock.hidden = true; render(); checkDue();
      } catch (err) { $('#lockErr').textContent = 'Wrong passphrase.'; }
    };
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  boot();
})();
