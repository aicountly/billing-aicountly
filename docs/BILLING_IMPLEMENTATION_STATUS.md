# Billing implementation status

What each dashboard does, what each figure means, and where the numbers come
from. Written to be read next to the screens.

## The five dashboards

| Route | Title | Permission to open | Metrics |
|---|---|---|---|
| `/dashboard/overview` | Your business, at a glance | `overview.view` | Sales (period) · To collect (as at) · To pay (as at) · Cash & bank (as at) |
| `/dashboard/biller` | Ready for your next bill | `biller.desk` | My bills today · My billed value · Bills to finish · Checks to clear |
| `/dashboard/receivables` | Turn invoices into collections | `receivable.view` | Outstanding (as at) · Overdue (as at) · Due in seven days (window) · Collected (period) |
| `/dashboard/payables` | Stay ahead of supplier dues | `payable.view` | To pay (as at) · Due in seven days (window) · Overdue (as at) · Bills needing a look (count) |
| `/dashboard/cash-compliance` | Close your day with confidence | `cash.view`, `bank.view` or `compliance.view` | Cash (as at) · Bank (as at) · Unmatched bank entries · Document exceptions |

Where a person lands is `Dashboards::landing()`: the first dashboard they may
open, top to bottom. An owner starts on the overview, a counter biller on the
biller desk. Neither is special-cased.

`Dashboards::ALL` is one list, read twice — once to build the tab bar in the
session payload, once by every endpoint through `Dashboards::assert()`. A tab
that is not shown is a URL that returns 403.

## Metric definitions

Each card carries its own definition and its **basis**, because four figures in
one typeface invite arithmetic between things that are not comparable.

| Basis | Means | Example |
|---|---|---|
| `period` | A movement between two dates | Sales this month; Collected this month |
| `as_of` | A balance at one date | To collect; Cash & bank |
| `window` | Falls due inside a future window | Due in seven days |
| `count` | A number of things, not money | Bills to finish |
| `stated` | What somebody said would happen | A promise to pay |

Specifics worth stating once:

* **Sales** is invoices at their full value **including tax**. Credit notes are
  not netted off; they have their own register.
* **Collected** is receipts. It is money that came in during the period,
  whenever the bill was raised — **it is not revenue**, and the card says so.
* **Cash & bank** is the closing balance of the cash and bank ledgers in Smart
  Books. It is not invoices less expenses.
* **Ageing** is measured from each bill's own **due date**, on the balance still
  unpaid. A bill on 60-day terms raised 45 days ago is not overdue.
* **Money in / money out** on the day-close screen excludes transfers between
  your own accounts. A cash deposit into the bank is not income and a withdrawal
  is not an expense; the transferred amount is reported separately.
* **Today** is the company's today, from `billing_settings.timezone`
  (`Asia/Kolkata` by default). A shop trading at 9pm in Kolkata is not yet on
  tomorrow just because the server is.
* **Comparisons** are against the immediately preceding window of the same
  length. A previous period of zero produces "No comparison available" rather
  than a percentage, and whether a rise is welcome is decided per metric — more
  overdue debt is amber, not green.

## Honest states

Three states, and no fourth:

* **ready** — a figure, read live.
* **loading** — a skeleton of the same shape, so nothing jumps.
* **unavailable** — no figure, plus the reason.

There is no "nought because the service did not answer". A zero and an outage
look identical on screen and one of them means a quiet day, so
`RegisterReader::total()` returns null when it cannot prove it read every row,
and a card with a null value renders as Unavailable.

A permission a user does not hold removes the card entirely rather than greying
it. A locked "Cash and bank" tells a biller the balance exists and that somebody
decided they should not have it; absence tells them nothing, which is correct.

## What Billing owns

Four things, and nobody else records any of them:

1. **Billing profiles** — who may see and do what inside this product.
2. **Business mode and timezone** — which menu this business sees, and whose day.
3. **Recurring and reminder rules** — business automation, not synchronisation.
4. **Transaction requests, promises to pay, day-close ticks** — what a person
   asked for or looked at, and the reference Books gave back.

New in this change, and why each is not a second source of truth:

* `billing_payment_promises` — what a customer *said* they would pay, and when.
  Books has no field for it because it is not an accounting fact. The promise is
  never read back as a balance: whether it was kept is decided on every request
  by asking Books what is still outstanding, and the two figures are displayed
  in separate columns so a broken promise is visible as one.
* `billing_day_close_checks` — one person saying "I have looked at this". It
  locks no period and posts no entry. Billing has no accounting period to lock.

Both are covered by the release-blocking ownership tests, whose numeric-column
allow-list now names two columns explicitly rather than one.

## Money to Collect and Money to Pay

`/receivables` and `/payables` are **one screen** — `web/src/receivables/` —
because `v1/receivables` and `v1/payables` return the same shape from the same
service. The side decides the wording and which actions are offered; a second
copy would be a second place for the ageing rule to drift.

It reads once, from the endpoint that already existed, and does the rest in the
browser over the rows it was given:

| Comes from the server | Worked out here |
|---|---|
| total, overdue, due today, due this week | the COUNT of bills behind each of those |
| the five ageing buckets, and whether they reconcile | which bucket each row is in, and how many rows per bucket |
| every open bill, with its balance and days overdue | days still to run, status, filtering, sorting, paging |
| the per-party totals | the share each party holds, and the concentration of overdue |

Every derivation is against the response's own `as_on` date rather than the
browser's clock, so a row can never disagree with the totals above it. The
arithmetic lives in `src/receivables/model.ts`, which imports nothing and is
covered by `web/tests/receivables-model.test.ts`.

**Ageing is measured from the due date**, never the bill date, and calendar days
are counted at UTC midnight on both ends — dividing a millisecond difference by
86,400,000 turns "due today" into "one day overdue" for anyone an hour off UTC.

**Status is timing, and part-paid is a separate fact.** A bill that is half
settled and ninety days late is still ninety days late; one badge that could
only say "Partially paid" would hide the half that decides whether anybody rings
the customer today. So the row carries both.

**Nothing is settled from this screen.** "Record money received" navigates to the
receipt screen, which reads the open bills from Books when the party lands and
posts a receipt Books allocates. There is no status flip in the browser, and the
bulk action refuses a selection spanning more than one party because a receipt
is recorded against one.

**The collection health label is two published percentages and two thresholds** —
the share overdue and the share more than sixty days late — and the card states
both. There is no score, because a collections figure a user cannot check is a
figure they should not act on.

Three things this screen wanted and did not get are in
`BILLING_API_DEPENDENCIES.md`: what a bill was raised for (partly available, and
shown as "not known" when absent), how a customer is classified, and a document
route for one bill.

## Reports

Ten, at `/reports`, all read live: sales, purchase, credit-note and debit-note
registers; receipt and payment registers; receivables and payables ageing; cash
and bank summary; document exceptions.

Export is CSV, built on the server, and needs `export.data` **separately from**
`reports.view` — a person may be trusted to look a balance up on screen and not
to walk out with the ledger. The file is the full filtered set; when the read
could not be completed the export is refused rather than silently short. Every
text cell is neutralised against spreadsheet formula injection.

## Permissions added

| Permission | Grants |
|---|---|
| `overview.view` | The business overview |
| `biller.desk` | The biller desk |
| `compliance.view` | Document checks and the day-close checklist |
| `promise.manage` | Recording what a customer promised |
| `export.data` | Downloading a report as a file |

Shipped profiles: **Biller** holds `biller.desk` and not `overview.view` — the
counter gets a till, the owner gets the business. **Cashier** additionally holds
`compliance.view`. **Sales biller** and **Collection** hold `promise.manage`.
Only the owner profile holds `export.data`.

## AI

There is none on these screens, deliberately. Every figure, bucket, duplicate
flag and priority is deterministic arithmetic over live rows, and each one can
be checked by adding the numbers up. Nothing carries a confidence score, because
a number nobody can reproduce is worse than no number.

The places a model would genuinely help — reading a supplier's PDF, explaining
an ambiguous bank match — are the two capabilities this deployment does not
have, and both are documented in `BILLING_API_DEPENDENCIES.md` rather than
approximated.

## Verification

* `server-php/tests/run.sh` — 64 passing, 0 failing, against a real PostgreSQL
  and a stub standing in for Books and Inventory.
* `npm test` in `web/` — the ageing, status, filter, summary and export rules,
  run by node's own test runner against `src/receivables/model.ts`. No test
  framework is installed; that file imports nothing, so node runs it directly.
* `npm run build` in `web/` — `tsc -b` clean, seven lazy chunks.
* Visual pass at 1920, 1366, 820 and 414 px across the five dashboards and both
  dues screens, via `web/visual.html` — a development-only entry point that
  mounts the real components against fixtures. `vite build` does not include it,
  and no fake record is written anywhere. `?state=empty|error|slow` exercises the
  three states the screens must survive, and `?as=biller` the permission-limited
  profile.
