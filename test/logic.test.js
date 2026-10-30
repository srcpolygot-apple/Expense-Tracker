const test = require('node:test'); const assert = require('node:assert');
const L = require('../logic.js');
const R = L.DEFAULT_RATES, now = new Date(2025, 5, 15);
const tx = (o) => Object.assign({ type: 'expense', currency: 'USD', category: 'Food', date: '2025-06-10', amount: 10, description: 'x' }, o);

test('convert', () => { assert.equal(L.convert(92, 'EUR', 'USD', R), 100); assert.throws(() => L.convert(1, 'XXX', 'USD', R)); });
test('receipt', () => {
  const r = L.parseReceipt('Walmart Supercenter\nMilk 3.49\nSubtotal 3.49\nTax 0.20\nTOTAL 3.69\n2025-06-01');
  assert.equal(r.total, 3.69); assert.equal(r.date, '2025-06-01'); assert.equal(r.merchant, 'Walmart Supercenter'); assert.equal(r.category, 'Groceries');
});
test('periods', () => {
  assert.deepEqual(L.periodRange('weekly', now), { start: '2025-06-09', end: '2025-06-15' });
  assert.deepEqual(L.periodRange('monthly', now), { start: '2025-06-01', end: '2025-06-30' });
});
test('budget & summary', () => {
  const txs = [tx({}), tx({ amount: 92, currency: 'EUR' }), tx({ type: 'income', amount: 500 })];
  const b = L.budgetStatus({ period: 'monthly', limit: 200, category: 'Food' }, txs, R, 'USD', now);
  assert.equal(Math.round(b.spent), 110); assert.equal(L.summary(txs, b.range, R, 'USD').net, 390);
});
test('insights duplicates and outlier', () => {
  const txs = [tx({}), tx({}), ...[10, 11, 9, 10, 12, 10].map(a => tx({ amount: a, description: 'y' + a })), tx({ amount: 500, description: 'big' })];
  const t = L.insights(txs, R, 'USD', now).map(i => i.text).join('\n');
  assert.match(t, /duplicate/); assert.match(t, /Unusual Food/);
});
test('cycles', () => { assert.equal(L.addCycle('2025-01-31', 'monthly'), '2025-02-28'); assert.equal(L.addCycle('2025-06-01', 'weekly'), '2025-06-08');
  assert.equal(L.monthlyCost({ amount: 120, cycle: 'yearly' }), 10);
  assert.equal(L.dueSoon([{ nextDue: '2025-06-17' }, { nextDue: '2025-07-30' }], now, 3).length, 1); });
test('trip', () => {
  const t = { id: 't1', start: '2025-06-01', end: '2025-06-04', budget: 500, perDiem: 100 };
  const r = L.tripTotals(t, [tx({ tripId: 't1', amount: 200 })], R, 'USD'); assert.equal(r.days, 4); assert.equal(r.perDay, 50); assert.equal(r.remaining, 300);
});
test('tax csv escapes formulas', () => {
  const r = L.taxReport([tx({ taxDeductible: true, description: '=HYPERLINK("x"),a' })], 2025, R, 'USD');
  assert.equal(r.rows.length, 1); assert.ok(r.csv.includes('"\'=HYPERLINK(""x""),a"'));
});
test('assistant', () => { assert.match(L.assistant('how are my budgets', { txs: [], budgets: [], rates: R, baseCur: 'USD', now, subs: [] }), /no budgets/); });
