# Expense Tracker

A mobile-first, installable (PWA) expense tracker. No build step or dependencies.

```
npm start   # serves on http://localhost:8080  (or any static server / GitHub Pages)
npm test    # unit tests for logic.js
```

## Features
| # | Feature | Implementation |
|---|---------|----------------|
| 1 | Mobile UI | Responsive, bottom-tab PWA, dark mode, offline via service worker |
| 2 | Receipt scanning | Tesseract.js OCR (loaded on demand, needs internet) → merchant/total/date/category |
| 3 | Spending insights | Outliers, duplicate charges, month-over-month spikes, small-purchase totals |
| 4 | Voice logging | Web Speech API, e.g. "spent 12 on lunch" |
| 5 | Financial assistant | On-device chat about budgets, top categories, bills, saving tips |
| 6 | Budget periods | Daily / weekly / monthly / custom, overall or per category |
| 7 | Summaries | Weekly & monthly totals, pie and 6-month bar charts, CSV export |
| 8 | Bills & subscriptions | Recurring cycles, due alerts, "mark paid" logs the expense |
| 9 | Tax | Deductible tag, yearly CSV report (formula-injection safe) |
| 10 | Travel | Trips with budget, per-diem and per-day tracking |
| 11 | Multi-currency | Per-transaction currency, editable/live rates, base currency |
| 12 | Cards | Nickname/type/last-4 only; spend per card |
| 13 | Notifications | Budget 80%/100% and bill-due alerts (Notification API) |
| 14 | Backup | Encrypted backup/restore, optional encrypted sync to your own HTTPS endpoint (PUT/GET) |
| 15 | Security | Encrypted at rest (PBKDF2 → AES-GCM) with your passphrase, lock screen, strict CSP |

Notes: there is no server; "AI" is on-device heuristics. A forgotten passphrase cannot be recovered.
