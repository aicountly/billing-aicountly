# Aicountly Billing — architecture

Billing is a **lightweight operational UI over Smart Books and Inventory**. It
is not a second accounting system, and the schema is the proof: there is no
sales voucher here, no purchase voucher, no receipt, no payment, no ledger, no
receivable, no payable, no stock and no GST figure.

When a shopkeeper presses Save, **Books creates the voucher**. What Billing
keeps is the voucher uuid, so the screen can find it again.

## The rule

**Authoritative data owned by another product is read LIVE, on the request that
needs it. It is never copied into this database.**

No synchronisation job, no reconciliation cron, no mirror table, no cache table.

| Question | Answered by | How Billing gets it |
|---|---|---|
| How much did I sell today? | **Smart Books** | `BooksClient`, live |
| Who owes me, whom do I owe? | **Smart Books** | `reports/bill-by-bill`, live, aged here |
| How much cash and bank? | **Smart Books** | `reports/account-summary`, live |
| Is this item in stock? | **Inventory** | `InventoryClient`, live |
| Who may see and do what *here*? | **Billing** | its own tables |

## What Billing owns

Five things, and nobody else records any of them:

1. **Billing profiles** — who may see and do what *inside this product*.
2. **Business mode and timezone** — which menu this business sees, and whose day
   "today" means. A shop trading at 9pm in Kolkata is not on tomorrow because a
   UTC server is.
3. **Recurring and reminder rules** — the schedules below.
4. **Transaction requests** — what the user asked for, its state, and the
   reference Books returned.
5. **Conversations and checks** — what a customer said they would pay, and which
   steps of today's close somebody has looked at.

The fifth is the newest and the easiest to get wrong, so it is worth being
precise. A **promise to pay** is not a receivable: Books has no field for "they
rang and said the 15th" because it is not an accounting fact, and it is exactly
what decides who gets chased on Monday. It is never read back as a balance —
whether it was kept is decided on every request by asking Books what is still
outstanding, and the screen shows the two in separate columns so a promise that
was not kept is visible as one. A **day-close tick** is one person saying they
looked; it locks no period and posts no entry, because Billing has no accounting
period to lock and inventing one would be a second answer to a question Books
already owns.

## The five dashboards

`Dashboards::ALL` is one list, read twice: the session endpoint builds the tab
bar from it, and every dashboard endpoint checks against it. A tab that is not
shown is a URL that returns 403 — which is the difference between a hidden menu
and a control.

| Dashboard | Who lands here |
|---|---|
| Business overview | an owner |
| Biller desk | a counter biller — and nothing else |
| Receivables, Payables, Cash & Compliance | whoever holds the dues or balance permissions |

Every figure carries a **basis** (a movement over a period, a balance at a date,
a future window, a count) and a definition in a sentence. Four numbers in one
typeface otherwise invite arithmetic between things that are not comparable, and
"Sales this month" plus "To collect" is not a number.

There are exactly three states: ready, loading, and unavailable-with-a-reason.
There is no fourth, and in particular no "nought because Books did not answer" —
a zero and an outage look identical on screen and one of them means a quiet day.

## Billing profiles

The problem, in the shopkeeper's words: *"I want my counter staff to make bills,
but I don't want them seeing what I paid for the goods, what I make on them, or
what's in the bank."*

Six profiles ship. **Biller** is the important one: sell, take money, generate an
e-Invoice — and no cost, no profit, no payables, no bank.

Enforced in the backend on every route, and `CatalogController` strips cost and
margin from anything it relays to a user without `cost.view`. A test calls the
API directly, past the UI, to prove the control holds:

```
check('the permission check is in the service, not the screen', …)
```

Smart Books has its own permissions for its own screens. Neither replaces the
other: a Biller profile here is not the run of Books.

## Business automation is not data synchronisation

This is the one place in the product where a schedule exists at all, so the
distinction is worth stating precisely:

| Allowed — and this is all of it | Prohibited |
|---|---|
| "On the 1st, raise this month's rent invoice" | "Every hour, copy Books' invoices into Billing" |
| "Three days after a bill is due, chase it" | "Every night, refresh the customer list" |
| | "Every morning, recompute the receivables table" |

The test: **if the job's purpose is to make two databases agree, it is
prohibited.** Nothing here makes two databases agree, because there is no second
copy of anything.

Two consequences:

- A recurring rule triggers the **Books** Sales API. It never creates a Billing
  invoice and pushes it later — there is no Billing invoice.
- A reminder reads the **current** outstanding from Books before it sends. A
  reminder chasing a bill paid last week is worse than no reminder, and a stored
  receivable is exactly how that happens.

Month-end billing keeps its anchor day: 31 Jan → 28 Feb → **31 Mar**, not
28 Mar for ever. PHP's `+1 month` from 31 January lands on 3 March, so clamping
is necessary; clamping alone causes drift, so the day of the month is carried.

## Idempotency

`TransactionService` splits `create()` from `post()` so a **retry drives the
original request row** and presents the original idempotency key. That is the
defence against the commonest small-business complaint: the network hiccuped,
they pressed Save again, and the customer got two invoices.

When Books cannot be reached the message says so in words a shopkeeper can act
on — *"Could not save this bill right now. No duplicate has been created —
please retry."* — not a stack trace.

## No tax is computed here

Books calculates the GST, splits CGST/SGST/IGST, determines place of supply,
rounds, and files the return. A test asserts the payload Billing sends carries
none of those fields. A second tax engine in a product aimed at people who do not
want to learn accounting is the worst possible place for one.

## The two numeric columns

Outside the rule tables, exactly two columns in this schema hold an amount, and
both are records of **something a person said** rather than balances:

- `billing_reminder_log.amount_at_send` — what we told a customer they owed,
  when we told them. Worth having when they ring up about it.
- `billing_payment_promises.promised_amount` — what they said back.

Nothing reads either one as a balance. The reminder screen re-reads Books every
time, and whether a promise was kept is decided by asking Books what is still
outstanding — which is exactly why a broken promise is visible at all: the
promise is ours, the outstanding is Books', and the disagreement between them is
the signal.

A release-blocking test names both columns one at a time, so a third is a
deliberate act with a justification attached rather than a migration nobody
queried.

## Running the tests

```bash
server-php/tests/run.sh
```

Against a real PostgreSQL and a stub standing in for Books and Inventory,
including release-blocking ownership tests that read `information_schema`.
