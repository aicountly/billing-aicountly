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

## Money to Pay — the payables workspace

`/payables`, permission `payable.view`. Not a dashboard: the bill-by-bill list
the payables dashboard summarises and links to, rebuilt as somewhere a person
actually settles suppliers from.

**One reading of Books draws all of it.** `GET v1/payables` reads
`reports/bill-by-bill` once and, over that one answer, works out the four
headline figures, the ageing, what falls due in the next thirty days, the
category split and the due-date calendar — then searches, filters, sorts and
pages the rows. Filtering does not ask Books again per view, and the browser is
never handed every bill in order to slice twenty-five out of it.

| Part | What it shows |
|---|---|
| Total payables | Everything still owed, with the change against the same day last month |
| Overdue / Due today / Due this week | The three windows, each a click onto the matching filter |
| Payables ageing | Not yet due · 1–30 · 31–60 · 61–90 · over 90 · no due date, each a filter |
| Upcoming payments | The next thirty days, soonest first; "View all" narrows the table to the same window |
| Payable by category | Books' own classification, or a plain statement that it has none |
| The table | Bill no. · Date · Supplier · Reference · Due date · Days · Amount · Status, sorted and paged on the server |

**The cards describe the position; the table describes a query.** Narrowing to
one supplier changes the rows and leaves "Total payables" alone — a headline
that moved with the filter would be a different number every time somebody
searched, and nobody could quote it.

**Two things this screen says rather than guesses.** A bill is "part paid" only
where Books states the bill's value as well as its balance; where it does not,
no part payment is claimed either way. And the change on the headline card is
two readings of Books, today's and last month's, on a separate endpoint — so a
keystroke in the search box does not re-read a month of history, and a failure
leaves the card without a trend rather than without a total.

**Days** reads "30 overdue", "Today" or "6 days" rather than a bare number:
a column where 6 might mean six days late or six days away is a column somebody
acts on backwards.

`GET v1/payables/export` is the same filtered set as CSV — the whole of it, not
the page on screen — and needs `export.data` on top of `payable.view`, exactly
as the reports do.

"Import bills" has no extraction service in this deployment and says so, with
the manual path beside it. "View calendar" is a month view of the due dates this
screen already read; it schedules nothing and saves nothing.

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

* `server-php/tests/run.sh` — 72 passing, 0 failing, against a real PostgreSQL
  and a stub standing in for Books and Inventory.
* `npm run build` in `web/` — `tsc -b` clean, seven lazy chunks.
* Visual pass at 1440, 1180, 860 and 414 px across all five dashboards and Money
  to Pay, via `web/visual.html` — a development-only entry point that mounts the
  real components against fixtures. `?state=empty|error|slow` reaches the empty,
  failed and loading states, which are hard to arrange in a real company.
  `vite build` does not include any of it, and no fake record is written
  anywhere.
