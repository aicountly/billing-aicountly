# Billing gap audit

Written by inspecting the repository, not from the brief. Every "missing" below
was checked in the code first; several things that looked missing were already
there and are recorded as such, because an audit that only lists failures is an
audit nobody can trust about the successes.

Baseline before this work: **29 integration tests passing**, `tsc -b` clean.
After: **56 passing**, `tsc -b` and `vite build` clean.

## Classification

| | Meaning |
|---|---|
| **OK** | Implemented correctly; verified in the code |
| **Partial** | Present but incomplete or wrong in a specific way |
| **Missing** | Not implemented |
| **Wrong** | Implemented in a way that produced an incorrect result |
| **Blocked** | Cannot be completed here; an external product must provide something |

---

## Architecture and ownership

| Requirement | Before | Evidence | After |
|---|---|---|---|
| Live APIs only, no cross-app DB sync | **OK** | `docs/ARCHITECTURE.md`; `001_billing_core.sql` has no voucher, ledger, receivable or stock table; release-blocking tests read `information_schema` | Unchanged. The two new tables were added to the same tests' allow-list one column at a time |
| Books owns tax | **OK** | `TransactionService::documentPayload()` sends no tax fields; a test asserts the payload | Unchanged |
| Idempotency on retry | **OK** | `IntegrationCommand::open()` mints the key before the first call; `post()` replays it | Unchanged |
| Permissions enforced server-side | **OK** | `Permissions::assert()` in services, not controllers; a test calls the service directly | Extended to the five dashboards via `Dashboards::assert()` |
| Aicountly Pay not depended on | **OK** | No gateway, no payment link, no webhook anywhere in the tree | Unchanged; stated explicitly in `BILLING_API_DEPENDENCIES.md` |

## The five dashboards

| Requirement | Before | Evidence | After |
|---|---|---|---|
| Business Overview | **Partial** | `pages/Home.tsx` — six stat cards, no definitions, no trend, no recent invoices, no quick-action grid | **Done.** `dashboards/Overview.tsx` + `OverviewService` |
| Biller Desk | **Missing** | A biller landed on `Home` and saw two sales cards. No counter workflow existed | **Done.** `dashboards/BillerDesk.tsx` + `BillerDeskService`, scoped to the signed-in user's own `created_by` |
| Receivables | **Partial** | `pages/Dues.tsx` had ageing and party/bill tables. No collections figure, no follow-up priorities, no promises, no reminder draft | **Done.** `dashboards/Receivables.tsx` + `CollectionsService`; the bill-by-bill list stays at `/receivables` |
| Purchases & Payables | **Partial** | The same `DuesScreen` with `side="payable"`. No upcoming-payment timeline, no review queue, no duplicate detection, no cash impact | **Done.** `dashboards/Payables.tsx` + `SupplierDuesService` |
| Cash & Compliance | **Missing** | No such screen. `BankCashOverview` in `Misc.tsx` listed balances only | **Done.** `dashboards/CashCompliance.tsx` + `ComplianceService` |
| Metric definitions and time basis | **Missing** | `StatCard` took `label`, `value`, `hint`. Nothing said whether a figure was a period movement or a balance | **Done.** `Domain/Metric.php` carries `basis` + `definition`; every card renders both |
| Never render a failure as ₹0 | **Partial** | `Home.tsx` used `readNumber(...) ?? 0`, so an unreachable Books drew ₹0.00 for sales | **Fixed.** `BooksReadings::number()` returns null for an absent field; `Metric::unavailable()` is the only other state |

## Routing and navigation

| Requirement | Before | Evidence | After |
|---|---|---|---|
| Menu entries lead somewhere | **Wrong** | `SettingsController::menu()` offered `/items`, `/parties` and `/reports`; none had a route in `App.tsx`, so all three hit the "That page does not exist" catch-all | **Fixed.** All three now have screens (`pages/Directory.tsx`, `pages/Reports.tsx`) |
| Credit note reachable | **Wrong** | `/more/credit-note` was in `AppShell`'s quick actions with no route behind it | **Fixed.** `SaleEditor` handles `credit_note` and `debit_note`; both routed |
| A biller lands on their own screen | **Missing** | Everyone landed on `/` | **Done.** `Dashboards::landing()` decides server-side; `/` redirects to it |
| Dashboard tabs match what the API allows | **Missing** | No tabs existed | **Done.** One list (`Dashboards::ALL`) builds the tabs and guards the endpoints |
| Heavier routes lazy-loaded | **Missing** | Everything in one chunk | **Done.** Five dashboards + Reports are separate chunks |

## Transactions

| Requirement | Before | Evidence | After |
|---|---|---|---|
| Sale, purchase, receipt, payment, contra | **OK** | `TransactionService::KINDS`, tested per voucher type | Unchanged |
| Service-only lines, no stock movement | **OK** | A line with no `item_id` becomes a `service_line` | Unchanged |
| Partial receipt, multi-bill allocation, on-account | **OK** | `MoneyMovement.tsx` + `settlementPayload()`; tested | Unchanged |
| Deposit/withdrawal are contra, not revenue | **OK** | Voucher type 1; a test asserts it | **Strengthened.** A new test asserts a contra is counted in neither the money-in nor the money-out figure |
| Credit/debit notes | **Partial** | The backend accepted both kinds; nothing in the UI could create one | **Done.** Original-document picker (`GET v1/original-documents`), reason codes, "value adjustment only" |
| Original-document reference on a note | **Missing** | `against_voucher_id` was accepted but never sent | **Done.** Sent with the document number; over-adjustment is flagged before saving |
| Price adjustment without a physical return | **Missing** | — | **Done.** A value-only note posts one described line and no item |

## Metrics and data quality

| Requirement | Before | Evidence | After |
|---|---|---|---|
| Ageing buckets reconcile to the total | **OK** | Every bill lands in exactly one bucket | **Strengthened.** `ageing_reconciles` is computed and asserted; the UI refuses to draw the bar when it is false |
| Undated bills are not filed as healthy | **Wrong** | A bill with no due date was added to `current` — the green bucket — so a possibly months-late bill looked fine | **Fixed.** `no_due_date` is its own bucket and still reconciles |
| Comparisons handle a zero denominator | **Missing** | No comparisons existed | **Done.** `Metric::compare()` returns "No comparison available" |
| A rise is not assumed to be good | **Missing** | — | **Done.** `riseIsGood` is a required argument; +14% overdue is amber, not green |
| Company timezone, not the server's | **Missing** | `gmdate('Y-m-d')` throughout: a shop open at 9pm in Kolkata was already on tomorrow | **Fixed.** `billing_settings.timezone`, resolved by `Domain/Period.php` |
| Internal transfers excluded from flows | **Missing** | No cash-flow view existed | **Done.** Contra is read, reported separately, and in neither total |
| A part-paid invoice never reads as Paid | **Missing** | No status was derived | **Done.** `BooksReadings::settlementStatus()`; `PARTIALLY_PAID` is its own badge |
| A page total is never a page's worth of a month | **Missing** | — | **Done.** `RegisterReader` refuses to total an incomplete read |

## Reports and export

| Requirement | Before | Evidence | After |
|---|---|---|---|
| Registers, ageing, cash summary, exceptions | **Missing** | `reports.view` existed as a permission with nothing behind it | **Done.** `Domain/ReportService.php`, ten reports |
| CSV export | **Missing** | — | **Done.** Server-side, with its own `export.data` permission |
| Export is the full filtered set | **Missing** | — | **Done.** Refuses rather than writing a short file |
| CSV formula injection neutralised | **Missing** | — | **Done.** `=`, `+`, `-`, `@` prefixed; leading tabs stripped first; tested |

## Shell and design

| Requirement | Before | Evidence | After |
|---|---|---|---|
| Company / branch / FY in the header | **Partial** | `CompanyPicker` was a collapsed button opening a form | **Done.** Three inline selects (`shell/ScopeBar.tsx`) |
| Scoped global search | **Missing** | — | **Done.** `shell/GlobalSearch.tsx`; debounced, cancelled on context change, scoped by the server |
| Notifications | **Missing** | — | **Done.** Reads the same `v1/insights` the overview acts on |
| User menu | **Partial** | A bare log-out icon | **Done.** |
| Accessible mobile navigation | **Wrong** | Below 48rem the sidebar was `display: none` and a bottom bar showed `menu.slice(0, 5)` — the other entries were unreachable on a phone | **Fixed.** `shell/Drawer.tsx`: focus trap, Escape, focus restored, every destination |
| Green/white/mint, light only | **Missing** | Zinc palette with a dark-mode block | **Done.** `index.css` rewritten; `color-scheme: light` |
| Charts from real values | **Missing** | No charts | **Done.** `dashboards/Chart.tsx`, computed from props, with a screen-reader table |
| No horizontal page scroll on a phone | **Wrong** | Found by the visual pass at 390px: a `.billing-sr-only` label inside a wide table is absolutely positioned, and with no positioned ancestor it escaped the table's `overflow-x: auto` and dragged the whole page 243px sideways | **Fixed.** `position: relative` on the scroller and the panel |

## Blocked

| Requirement | Why | User-visible fallback |
|---|---|---|
| Unmatched bank entries; suggested matches | No bank feed or statement import exists, and reconciliation is Books' to own. Contract written in `BILLING_API_DEPENDENCIES.md` | The metric reads Unavailable with the reason; the panel names the missing capability and the owning product; the checklist step says so |
| Bill extraction (Upload → Extract → Review) | No document-extraction service in this deployment. Billing's half is written and switched off with it: `POST v1/expenses/read-bill` | The payables panel and the expense screen's AI Bill Reader both explain it and offer manual entry, which records the same thing |
| Keeping the bill file itself | No document store is configured for this deployment; a folder beside the app would not survive an `rsync --delete` deploy, so Billing stores no bytes. Billing's half is written and switched off with it: `DocumentStorageClient` and `POST v1/expenses/bill`, live as soon as `DOCUMENT_STORAGE_BASE` is set | Until then the expense screen shows no drop zone — it records where the bill is kept, and sends that to Books as `attachment_ref` on the voucher |
| Sending a reminder | No message-delivery service configured | The draft is composed and shown for review with a Copy button, and says plainly that it cannot be sent from here |
