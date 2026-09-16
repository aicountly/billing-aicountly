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

Four things, and nobody else records any of them:

1. **Billing profiles** — who may see and do what *inside this product*.
2. **Business mode** — which menu this business sees.
3. **Recurring and reminder rules** — the schedules below.
4. **Transaction requests** — what the user asked for, its state, and the
   reference Books returned.

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

## The one numeric column

`billing_reminder_log.amount_at_send` — a record of **what we told a customer**,
worth having when they ring up about it. Nothing reads it back as a balance; the
reminder screen re-reads Books every time. A test asserts it is the only numeric
column outside the rule tables.

## Running the tests

```bash
server-php/tests/run.sh
```

Against a real PostgreSQL and a stub standing in for Books and Inventory,
including release-blocking ownership tests that read `information_schema`.
