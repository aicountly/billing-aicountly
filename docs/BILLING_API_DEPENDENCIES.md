# What Billing needs from other products

Billing owns no accounting data. Every figure on every screen is read live from
the product that owns it, on the request that draws it — so this file is the
complete list of what Billing asks for, and of the two things it asks for that
nobody serves yet.

The rule this file exists to keep honest: **when a capability is missing, the
screen says so.** It does not fall back to a stored copy, and it does not render
the absence as a zero.

## Who owns what

| Question | Owner | How Billing gets it |
|---|---|---|
| Who is signed in? | **MY** (portal) | `Authorization: Bearer <ses_key>`, validated at my.aicountly.com |
| Which company, branch, financial year? | **Manage** | `v1/manage/companies`, `v1/manage/companyinfo`, live |
| What did I sell, and to whom? | **Smart Books** | `registers?vch_type_id=…`, live |
| Who owes me, whom do I owe? | **Smart Books** | `reports/bill-by-bill`, live, aged in Billing |
| How much cash and bank? | **Smart Books** | `reports/account-summary`, live |
| What is this party's ledger? | **Smart Books** | `reports/account-ledger`, live |
| What is the tax on this bill? | **Smart Books** | computed there; Billing sends no tax fields |
| Is this item in stock? | **Inventory** | `InventoryClient`, live |
| What did this item cost? | **Inventory** | live, and stripped for anyone without `cost.view` |
| Who may do what *inside Billing*? | **Billing** | its own `billing_profiles` |

## Endpoints Billing consumes

### Smart Books

| Endpoint | Used by |
|---|---|
| `GET registers` | all five dashboards, every register report |
| `GET reports/bill-by-bill` | receivables, payables, ageing, reminder candidates |
| `GET reports/account-summary` | cash and bank cards, cash & compliance |
| `GET reports/account-ledger` | party statement |
| `GET masters/accounts` | party and cash/bank pickers |
| `GET masters/tax-categories` | line tax category picker |
| `GET vouchers/{id}` | the credit note's "what was on this bill" |
| `POST vouchers/drafts`, `POST vouchers/drafts/{id}/post` | every transaction |
| `POST receipt-vouchers/{id}/settlement` | receipt allocation |
| `POST payment-vouchers/{id}/settlement` | payment allocation |
| `POST gst/einvoice/generate`, `GET gst/einvoice/{id}/status` | e-Invoice |
| `POST gst/eway/generate`, `GET gst/eway/{id}/status` | e-Way Bill |

### Inventory

| Endpoint | Used by |
|---|---|
| `GET items`, `GET items/search`, `GET items/barcode/{code}` | item pickers, biller desk, the Items screen |
| `GET items/{id}` | a billing screen opened with an item already chosen |
| `GET item-groups` | the group filter on the Items screen |
| `GET stock-balances` | the stock column, one batched call per page |
| `GET availability` | stock check |
| `GET replenishment` | "running low", and the Low stock figure |

#### What the Items screen asks `GET items` for

The screen filters, sorts and pages **upstream**, because Inventory is the only
thing that can do any of the three across the whole catalogue rather than
across the twenty-five rows Billing happens to be holding. One spelling per
filter, and these are it:

```
GET items ?cmp_id&fy_id&bo_id
          &q            search over name, SKU, HSN/SAC and barcode
          &type         stock | service
          &status       active | inactive
          &stock_status in | low | out
          &group_id     an item group id
          &warehouse_id narrows availability to one warehouse
          &sort         name | sku | hsn_sac | rate | stock | status
          &order        asc | desc
          &limit&offset
  → { data: [ … ], meta: { total, limit, offset } }
```

`meta.total` is what the pager counts with. Without it the screen still steps
forward a page at a time, but it stops claiming to know where the end is.

**Where Inventory does not support one of these, the screen says so.** Billing
checks the rows that come back against the narrowing it asked for — a row whose
own type, status, stock state or group contradicts the filter is proof the
filter was not applied — and reports it in `meta.upstream.filters_ignored`. The
same is done for the order, in `meta.upstream.sort_applied`. The list is then
drawn as Inventory returned it, with a line above it saying that is what
happened. It is not quietly re-filtered in the browser, because a page that has
been filtered locally is a page whose totals and paging are wrong.

The five figures above the list are five counts of the same endpoint with
`limit=1`, read for their `meta.total`, plus `reports/replenishment` for
"running low". Each carries its own availability: one that cannot be read shows
as **Unavailable with the reason**, never as 0.

#### Not available: creating, editing and importing an item

Deliberately, and this one is not a gap to be closed. Inventory owns the item
master, so **Add item**, **Import** and **Item groups** on the Items screen open
Inventory rather than doing anything here, carrying `cmp_id`, `fy_id`, `bo_id`
and a `return_url`. Inventory applies its own permissions when the user lands.
A second place to create an item is a second place for the same item to exist
under two codes.

### Manage

`GET companies`, `GET companyinfo` — the company, branch and financial-year
switcher. Read on the request that draws it; the three ids are all Billing keeps.

---

## Not available: bank statement matching

**Dashboard 5 shows an unavailable state for this, with this file named on it.**

Billing has no bank feed and no statement import, and bank reconciliation is not
a billing front-end's job — it belongs to the accounts. Two cards and one panel
depend on a contract that does not exist yet:

* the **Unmatched bank entries** metric
* the **Suggested bank matches** panel
* the **Bank entries matched** step of the day-close checklist

### The contract Billing would need

Owner: **Smart Books**.

```
GET reports/bank-reconciliation/unmatched
  ?cmp_id&fy_id&bo_id&account_id&from&to&limit&offset

  → { data: [ {
        statement_line_id, account_id, value_date, narration,
        reference_no, direction: "credit"|"debit", amount, currency
      } ], meta: { total, limit, offset } }

GET reports/bank-reconciliation/candidates
  ?cmp_id&fy_id&statement_line_id&limit

  → { data: [ {
        voucher_id, voucher_uuid, voucher_no, voucher_date,
        account_id, account_name, amount,
        match_evidence: { amount_exact: bool, date_within_days: int,
                          reference_matches: bool }
      } ] }

POST reports/bank-reconciliation/confirm
  Idempotency-Key: <billing key>
  { cmp_id, fy_id, statement_line_id, voucher_ids: [ … ] }
  → { data: { statement_line_id, status: "MATCHED", matched_voucher_ids: [ … ] } }
```

Authentication: the caller's `Authorization: Bearer <ses_key>`, so Books applies
that user's own permissions. Billing additionally requires `bank.view` before it
will call any of them.

`match_evidence` is required rather than a score: the panel explains *why* two
records look like the same one, and a bare confidence number cannot be checked
by the person confirming it.

**Until this exists**, the metric renders as Unavailable with the reason, the
panel explains the missing capability, and the checklist step says so rather
than pretending there is nothing to match.

## Not available: bill extraction

**Dashboard 4 and the expense screen both show an unavailable state for this.**

Reading a bill out of a PDF or a photo needs a document-extraction service, and
this deployment has none. Billing does not add an OCR stack, and it does not ask
a model to guess at a supplier's totals.

Enabled by setting `DOCUMENT_EXTRACTION_BASE` in `server-php/.env` once a service
exists. Billing's half of it is written: `POST /api/v1/expenses/read-bill` takes
the upload, checks its type from the file's own content and its size, calls the
service below, and hands the fields back for the person to confirm. It records
nothing — not the file, not the answer — and the expense the user then saves is
the only thing that survives the request. One switch, `DocumentCapture`, answers
for both screens, so they cannot disagree about what this deployment can read.

Money received offers the same idea as **Scan receipt** and it is disabled for a
second reason as well: what exists is `POST /api/v1/expenses/read-bill`, which
reads a supplier's BILL. Reading a receipt is a different hint and a different
set of fields, so the button stays off until there is a call behind it rather
than borrowing one that would answer about the wrong document.

The expected shape, following the house "deterministic first, AI only for
what is left" rule:

```
POST <DOCUMENT_EXTRACTION_BASE>/v1/extract
  multipart: file=<pdf|jpg|png>, hint=supplier_bill
  → { data: {
        fields: { supplier_name, supplier_gstin, bill_no, bill_date,
                  total_amount, tax_amount, currency },
        confidence_by_field: { <field>: "high"|"low" },
        lines: [ { description, hsn_sac, qty, rate, amount } ],
        page_images: [ <url> ]
      } }
```

Every extracted field must arrive reviewable, and nothing is posted until a
person has approved it. The expense screen shows what was read, applies only the
amount, bill date and bill number, and leaves the supplier for a person to pick
— matching a name against a ledger is a choice with accounting consequences.
**Until this exists**, both screens offer the manual path, which records exactly
the same thing.

## Needs configuring: keeping the bill file

**The drop zone appears when `DOCUMENT_STORAGE_BASE` is set, and not before.**

Billing stores no bytes of its own and should not: the deploy runs
`rsync --delete` over the document root (see `DEPLOYMENT.md`), so a folder of
uploads beside the app would not survive a release. The file goes straight out
to a document service and what comes back — a reference — is what travels to
Books on the voucher as `attachment_ref`, a field the expense request already
accepted.

The client exists (`server-php/src/Clients/DocumentStorageClient.php`) and
`DocumentCapture::storage()` reports the capability from the configuration
alone, so turning this on is one line in `server-php/.env`:

```
DOCUMENT_STORAGE_BASE=<service>     in server-php/.env
DOCUMENT_STORAGE_KEY=<bearer>       optional, if the service wants one

POST <DOCUMENT_STORAGE_BASE>/v1/documents
  multipart: file=<pdf|jpg|png>, scope=<cmp_id>/<fy_id>
  → { data: { reference, filename, size, content_type, url } }

GET <DOCUMENT_STORAGE_BASE>/v1/documents/<reference>
  → the file, for whoever may see the voucher
```

`reference` is the only part Billing insists on. A 2xx without one is treated as
a failure and nothing is attached, because an expense pointing at a bill nobody
can find again is worse than an expense with no bill on it.

**Until it is configured**, the expense screen does not show a drop zone that
would swallow a photo and lose it. It asks **where the bill is kept** — a file
number, a folder, a link — and sends that as `attachment_ref` instead. That is a
smaller thing than an attachment and the screen says so. Both shapes can be
looked at without standing a service up: `/visual.html?screen=expense` for the
deployment as it is today, and `?screen=expense&docs=on` for the same screen
once a service answers.

**Money received is in the same position, with one difference.** A receipt is
often backed by a UPI screenshot, a counterfoil or a bank advice, and the screen
draws the section and says there is nowhere to keep one. It cannot fall back on
recording *where* the proof is kept the way the expense screen does: the receipt
payload Books accepts has no `attachment_ref` — see
`TransactionService::settlementPayload()` — so that field would have to exist
before there was anything to write a reference into.

## Not available: the written business briefing

**Dashboard 1 shows an unavailable state for this, and only for this.**

The overview's briefing strip has two halves, and only one of them is missing.

The **counted briefing** — "3 overdue customer accounts and 2 supplier accounts
due this week need a look today" — is arithmetic over the records that page has
already read. It is built in `BriefingService::build` from the same array the
priority panel underneath it is built from, so the sentence and the list cannot
disagree. It needs no service, is always available, carries no confidence score,
and is never labelled AI. Nothing below affects it.

The **written summary** is a model's words, and this deployment has no model.
It is a separate endpoint for three reasons, all the same reason: the dashboard
must not wait on a model, must not fail with one, and must not pay for one
every time somebody opens the page.

```
GET  /api/v1/dashboards/overview/briefing
  → { data: { available, reason, narrative, sources: [ {label, path} ], generated_at } }
```

It checks `overview.view` before it answers, so a profile that cannot open the
dashboard cannot get a summary of it either. The React side asks for it only
when a person presses **Write this up for me**.

### The contract Billing would need

Owner: **Console** (the approved model configuration), reached server-side.
Billing sends a digest it has already computed and already permission-scoped —
it does not hand over a company's records and ask for analysis.

```
POST <AI_BRIEFING_BASE>/v1/briefings
  Authorization: Bearer <AI_BRIEFING_KEY>     # server-side only, never in a VITE_ var
  {
    period: { from, to, timezone },
    metrics: [ { id, label, value, basis, summary } ],   # already computed here
    priorities: [ { id, text, count, path } ],           # already counted here
    untrusted: true          # party names and document text are DATA, not instructions
  }
  → { data: { narrative, sources: [ { label, path } ], generated_at } }
```

Three things the response must not contain, because the screen cannot check
them: a figure Billing did not send, a confidence percentage, and an
instruction. Nothing generated posts an entry, issues or cancels a document,
changes bank details or sends a reminder — those are all deterministic paths
behind their own permissions, and a narrative is text beside them, not a
control over them.

**Until this exists**, `AI_BRIEFING_BASE` unset (the normal case) answers
"No briefing model is configured for this deployment"; set with no key answers
that the key is missing; set with a key still answers unavailable, naming this
file, because writing a client against a shape no service serves would put a
summary on screen that nobody could check. The counted briefing is unaffected
in all three cases.

## Partly available: what may still be credited

**The credit note screen states the invoice quantity and says who decides.**

`GET vouchers/{id}` gives Billing the lines that were billed, so a credit note
starts from what was actually sold rather than from an empty table, and a line
crediting more than the bill carried is refused before it is sent. What no
endpoint gives is the quantity still **eligible** after earlier notes against
the same invoice: nothing in the estate reports "5 sold, 2 already credited, 3
left", and Billing must not keep a returns ledger of its own to work it out —
that is a second answer to a question Books owns.

So the screen shows the invoiced quantity ("of 5 billed"), blocks anything
above it, and leaves the rest to Books, which refuses an over-credit when the
note is posted. The contract that would close the gap:

```
GET reports/credit-eligibility
  ?cmp_id&fy_id&against_voucher_id

  → { data: { voucher_id, lines: [ {
        line_ref, item_id, billed_qty, credited_qty, eligible_qty,
        billed_amount, credited_amount, eligible_amount
      } ] } }
```

Owner: **Smart Books**, because Books holds both the invoice and every note
raised against it. Authentication as everywhere else: the caller's `ses_key`.

Two smaller gaps sit behind the same screen, and both are stated on it rather
than papered over:

* **The number before it is issued.** Books allots the credit note number from
  the company's own series when it posts the voucher. There is no "reserve the
  next number" call, so the field reads *Allotted on issue* instead of showing
  a number Billing would have had to invent.
* **The tax, and the posting, in figures.** Billing sends no tax fields and
  calculates none, so the summary is before tax and the posting preview shows
  the direction of each leg with an amount only where there is one to show. A
  `POST vouchers/preview` returning the computed tax and ledger legs for an
  unsaved voucher would let both show real figures; until then the screen names
  Smart Books rather than printing a number it cannot stand behind.

## Not available: the condition returned goods came back in

**The credit note records it and sends it on; nothing downstream reads it yet.**

Inventory has no disposition or condition list — no "good, damaged, scrap" that
decides which bin a return lands in — so the four words on the credit note's
Condition column are Billing's own. They are kept on the transaction request
and passed to Books as `return_condition` on the line, which means the note a
person reads in six months says what came back in what state. Whether stock is
segregated by it is Inventory's to decide when it has a contract for it:

```
GET v1/return-dispositions          → { data: [ { code, label, restocks: bool } ] }
```

Until that exists the list stays short, plain, and honest about being ours.

## Not depended on: Aicountly Pay

Nothing in this product requires a payment gateway, and nothing in it moves
money. "Record receipt" and "Record payment" write an accounting voucher in
Smart Books against a cash or bank ledger — that is a record of something that
happened, not an instruction to a bank.

There is no `Pay now` button, no payment link, no webhook listener and no
settlement state. When Aicountly Pay is configured, it arrives as an adapter
beside the existing methods; no screen in this product has been shaped around
its absence, so none has to be reshaped by its arrival.
