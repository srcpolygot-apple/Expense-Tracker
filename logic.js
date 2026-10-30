/* Pure business logic (no DOM). Works in browser (window.Logic) and Node. */
(function (root) {
  'use strict';

  const CATEGORIES = ['Food', 'Groceries', 'Transport', 'Housing', 'Utilities', 'Entertainment',
    'Shopping', 'Health', 'Travel', 'Subscriptions', 'Education', 'Business', 'Other'];

  const KEYWORDS = {
    Food: ['restaurant', 'cafe', 'coffee', 'lunch', 'dinner', 'breakfast', 'pizza', 'burger', 'starbucks', 'mcdonald'],
    Groceries: ['grocery', 'groceries', 'supermarket', 'walmart', 'costco', 'market', 'aldi', 'tesco'],
    Transport: ['uber', 'lyft', 'taxi', 'bus', 'train', 'metro', 'fuel', 'gas', 'petrol', 'parking'],
    Housing: ['rent', 'mortgage'],
    Utilities: ['electric', 'water', 'internet', 'phone', 'utility'],
    Entertainment: ['movie', 'cinema', 'game', 'concert'],
    Shopping: ['amazon', 'clothes', 'shoes', 'mall'],
    Health: ['pharmacy', 'doctor', 'dentist', 'hospital', 'gym'],
    Travel: ['hotel', 'flight', 'airbnb', 'airline', 'hostel'],
    Subscriptions: ['netflix', 'spotify', 'subscription', 'hulu', 'disney'],
    Education: ['course', 'tuition', 'book', 'udemy'],
    Business: ['office', 'software', 'client']
  };

  // Rates relative to USD (1 USD = rate units). User-editable in the app.
  const DEFAULT_RATES = { USD: 1, EUR: 0.92, GBP: 0.79, JPY: 150, INR: 83, CAD: 1.36, AUD: 1.52, CNY: 7.2, CHF: 0.88, MXN: 17 };

  function convert(amount, from, to, rates) {
    if (from === to) return amount;
    const rf = rates[from], rt = rates[to];
    if (!rf || !rt) throw new Error('Missing exchange rate for ' + (!rf ? from : to));
    return amount / rf * rt;
  }

  function guessCategory(text) {
    const t = String(text || '').toLowerCase();
    for (const cat of Object.keys(KEYWORDS)) {
      if (KEYWORDS[cat].some(k => t.includes(k))) return cat;
    }
    return 'Other';
  }

  /** Extract merchant, total, date from OCR text of a receipt. */
  function parseReceipt(text) {
    const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const merchant = lines.find(l => /[A-Za-z]{3}/.test(l)) || '';
    let total = null;
    const totalLine = lines.slice().reverse().find(l => /\b(grand\s+)?total\b|amount due|balance due/i.test(l) && !/sub\s*total/i.test(l));
    const money = l => { const r = [...l.matchAll(/(\d+[.,]\d{2})\b/g)]; return r.length ? parseFloat(r[r.length - 1][1].replace(',', '.')) : null; };
    if (totalLine) total = money(totalLine);
    if (total === null) {
      const all = lines.map(money).filter(x => x !== null);
      if (all.length) total = Math.max(...all);
    }
    let date = null;
    const d1 = String(text).match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    const d2 = String(text).match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (d1) date = d1[1] + '-' + d1[2].padStart(2, '0') + '-' + d1[3].padStart(2, '0');
    else if (d2) date = d2[3] + '-' + d2[1].padStart(2, '0') + '-' + d2[2].padStart(2, '0');
    return { merchant, total, date, category: guessCategory(text) };
  }

  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

  /** Budget period range containing `now`. period: daily|weekly|monthly|custom */
  function periodRange(period, now, custom) {
    const n = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === 'daily') return { start: iso(n), end: iso(n) };
    if (period === 'weekly') {
      const s = new Date(n); s.setDate(n.getDate() - ((n.getDay() + 6) % 7));
      const e = new Date(s); e.setDate(s.getDate() + 6);
      return { start: iso(s), end: iso(e) };
    }
    if (period === 'custom' && custom && custom.start && custom.end) return { start: custom.start, end: custom.end };
    return { start: iso(new Date(n.getFullYear(), n.getMonth(), 1)), end: iso(new Date(n.getFullYear(), n.getMonth() + 1, 0)) };
  }

  const inRange = (t, r) => t.date >= r.start && t.date <= r.end;
  const base = (t, rates, baseCur) => convert(t.amount, t.currency || baseCur, baseCur, rates);

  function sumExpenses(txs, rates, baseCur, filter) {
    return txs.filter(t => t.type !== 'income' && (!filter || filter(t))).reduce((a, t) => a + base(t, rates, baseCur), 0);
  }

  function byCategory(txs, rates, baseCur) {
    const out = {};
    txs.filter(t => t.type !== 'income').forEach(t => { out[t.category] = (out[t.category] || 0) + base(t, rates, baseCur); });
    return out;
  }

  function summary(txs, range, rates, baseCur) {
    const sel = txs.filter(t => inRange(t, range));
    const income = sel.filter(t => t.type === 'income').reduce((a, t) => a + base(t, rates, baseCur), 0);
    const expense = sumExpenses(sel, rates, baseCur);
    return { income, expense, net: income - expense, byCategory: byCategory(sel, rates, baseCur), count: sel.length };
  }

  function budgetStatus(budget, txs, rates, baseCur, now) {
    const range = periodRange(budget.period, now, budget);
    const spent = sumExpenses(txs, rates, baseCur, t => inRange(t, range) && (!budget.category || budget.category === 'All' || t.category === budget.category));
    return { range, spent, limit: budget.limit, remaining: budget.limit - spent, pct: budget.limit ? spent / budget.limit * 100 : 0 };
  }

  /** Spending insights: outliers, category spikes vs previous month, possible duplicates, top waste. */
  function insights(txs, rates, baseCur, now) {
    const out = [];
    const exp = txs.filter(t => t.type !== 'income');
    // outliers by category (> mean + 2 sd, needs >= 5 samples)
    const groups = {};
    exp.forEach(t => (groups[t.category] = groups[t.category] || []).push(base(t, rates, baseCur)));
    for (const t of exp) {
      const g = groups[t.category];
      if (g.length < 5) continue;
      const mean = g.reduce((a, b) => a + b, 0) / g.length;
      const sd = Math.sqrt(g.reduce((a, b) => a + (b - mean) ** 2, 0) / g.length);
      const v = base(t, rates, baseCur);
      if (sd > 0 && v > mean + 2 * sd) out.push({ level: 'warn', text: `Unusual ${t.category} expense: ${v.toFixed(2)} on ${t.date} (avg ${mean.toFixed(2)}).` });
    }
    // duplicates
    const seen = {};
    for (const t of exp) {
      const k = [t.date, t.amount, t.currency, (t.description || '').toLowerCase()].join('|');
      if (seen[k]) out.push({ level: 'warn', text: `Possible duplicate charge: "${t.description}" ${t.amount} on ${t.date}.` });
      seen[k] = true;
    }
    // month over month spikes
    const cur = periodRange('monthly', now);
    const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prev = periodRange('monthly', pm);
    const a = byCategory(exp.filter(t => inRange(t, cur)), rates, baseCur);
    const b = byCategory(exp.filter(t => inRange(t, prev)), rates, baseCur);
    for (const c of Object.keys(a)) {
      if (b[c] && a[c] > b[c] * 1.5 && a[c] - b[c] > 20) out.push({ level: 'warn', text: `${c} spending is up ${Math.round((a[c] / b[c] - 1) * 100)}% vs last month.` });
    }
    // small frequent purchases ("latte factor")
    const small = exp.filter(t => inRange(t, cur) && base(t, rates, baseCur) < 10);
    if (small.length >= 10) {
      const tot = small.reduce((s, t) => s + base(t, rates, baseCur), 0);
      out.push({ level: 'info', text: `${small.length} small purchases this month total ${tot.toFixed(2)} - these add up.` });
    }
    if (!out.length) out.push({ level: 'ok', text: 'No unusual spending detected. Keep it up!' });
    return out;
  }

  /** Rule-based assistant answering from the user's data. */
  function assistant(q, ctx) {
    const { txs, budgets, rates, baseCur, now, subs } = ctx;
    const s = String(q || '').toLowerCase();
    const month = periodRange('monthly', now);
    const sum = summary(txs, month, rates, baseCur);
    const f = n => n.toFixed(2) + ' ' + baseCur;
    if (/budget|left|remain|afford/.test(s)) {
      if (!budgets.length) return 'You have no budgets yet. Create one in the Budgets tab, then I can track it for you.';
      return budgets.map(b => { const st = budgetStatus(b, txs, rates, baseCur, now);
        return `${b.category || 'All'} (${b.period}): ${f(st.spent)} of ${f(b.limit)} used, ${f(st.remaining)} left.`; }).join('\n');
    }
    if (/categor|most|biggest|top/.test(s)) {
      const top = Object.entries(sum.byCategory).sort((x, y) => y[1] - x[1]).slice(0, 3);
      return top.length ? 'Top categories this month: ' + top.map(([c, v]) => `${c} ${f(v)}`).join(', ') + '.' : 'No expenses recorded this month.';
    }
    if (/subscr|bill|recurring/.test(s)) {
      const total = (subs || []).reduce((a, x) => a + convert(monthlyCost(x), x.currency, baseCur, rates), 0);
      return `You have ${(subs || []).length} subscriptions/bills costing about ${f(total)} per month.`;
    }
    if (/save|tip|reduce|cut|advice/.test(s)) {
      const top = Object.entries(sum.byCategory).sort((x, y) => y[1] - x[1])[0];
      return top ? `Your largest category is ${top[0]} (${f(top[1])}). Try cutting it by 10% to save ${f(top[1] * 0.1)}/month. Also review subscriptions you rarely use.` : 'Log some expenses first and I will suggest where to save.';
    }
    return `This month: income ${f(sum.income)}, expenses ${f(sum.expense)}, net ${f(sum.net)}. Ask about budgets, top categories, subscriptions or saving tips.`;
  }

  function monthlyCost(sub) {
    const m = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }[sub.cycle] || 1;
    return sub.amount * m;
  }

  function addCycle(dateStr, cycle) {
    const d = parseDate(dateStr);
    const day = d.getDate();
    if (cycle === 'weekly') d.setDate(d.getDate() + 7);
    else {
      const months = cycle === 'yearly' ? 12 : cycle === 'quarterly' ? 3 : 1;
      d.setDate(1); d.setMonth(d.getMonth() + months);
      d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    }
    return iso(d);
  }

  /** Subscriptions due within `days` days (including overdue). */
  function dueSoon(subs, now, days) {
    const limit = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
    return subs.filter(s => parseDate(s.nextDue) <= limit)
      .sort((a, b) => a.nextDue.localeCompare(b.nextDue));
  }

  function tripTotals(trip, txs, rates, baseCur) {
    const sel = txs.filter(t => t.tripId === trip.id && t.type !== 'income');
    const total = sumExpenses(sel, rates, baseCur);
    const days = Math.max(1, Math.round((parseDate(trip.end) - parseDate(trip.start)) / 864e5) + 1);
    const cats = byCategory(sel, rates, baseCur);
    return { total, days, perDay: total / days, perDiemLimit: trip.perDiem || 0, budget: trip.budget || 0,
      remaining: (trip.budget || 0) - total, byCategory: cats };
  }

  const csvCell = v => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

  function taxReport(txs, year, rates, baseCur) {
    const rows = txs.filter(t => t.taxDeductible && t.type !== 'income' && t.date.startsWith(String(year)));
    const total = rows.reduce((a, t) => a + base(t, rates, baseCur), 0);
    const header = ['Date', 'Description', 'Category', 'Amount', 'Currency', 'Amount (' + baseCur + ')'];
    const csv = [header].concat(rows.map(t => [t.date, t.description, t.category, t.amount, t.currency, base(t, rates, baseCur).toFixed(2)]))
      .concat([['', '', 'TOTAL', '', '', total.toFixed(2)]]).map(r => r.map(csvCell).join(',')).join('\n');
    return { rows, total, csv };
  }

  const api = { CATEGORIES, DEFAULT_RATES, convert, guessCategory, parseReceipt, periodRange, summary, budgetStatus,
    insights, assistant, monthlyCost, addCycle, dueSoon, tripTotals, taxReport, csvCell, iso, byCategory, sumExpenses };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Logic = api;
})(typeof self !== 'undefined' ? self : this);
