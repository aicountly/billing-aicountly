# What Billing needs from other products

Billing owns no accounting data. Every figure on every screen is read live from
the product that owns it, on the request that draws it — so this file is the
complete list of what Billing asks for, and of the things it asks for that
nobody serves yet.

The rule this file exists to keep honest: **when a capability is missing, the
screen says so.** It does not fall back to a stored copy, and it does not render
the absence as a zero.

Four of them are reported to the browser by `GET v1/session` as `capabilities`,
each with the reason printed on the screen that needs it, so one missing service
is not described five different ways in five components.

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
| `GET items`, `GET items/search`, `GET items/barcode/{code}` | item pickers, biller desk |
| `GET availability` | stock check |
| `GET replenishment` | "running low" |
| `GET warehouses` | where returned goods go back in, on a debit note |

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
**Until this exists**, all three screens offer the manual path, which records
exactly the same thing: the debit note screen disables *Scan & add (AI)*,
*Use AI to fill the items* and *Import* and carries this reason on each, rather
than looking live and doing nothing.

---

## Not available: the lines of an original document

**Purchases → Debit note shows this on its "Add from invoice" button.**

A debit note is usually part of a bill coming back, so the natural move is to
pick the supplier's bill and tick the lines being returned. Billing cannot offer
it. `GET registers` returns one row per voucher — number, date, party, amount,
settlement status — and no lines, so there is nothing to tick.

The screen therefore asks for the item, the quantity and the rate, and does
**not** default the rate to the item's selling price: an MRP on a purchase being
reversed would quietly overstate the note. Where Inventory sends a purchase rate
— which it does only for a user with `cost.view` — that is used instead, and
otherwise the rate starts at zero and is typed from the bill.

### The contract Billing would need

Owner: **Smart Books**.

```
GET vouchers/{voucher_id}/lines
  ?cmp_id&fy_id&bo_id

  → { data: [ {
        line_id, item_id, description, hsn_sac,
        unit_id, unit_name, qty, rate, discount_pc,
        tax_cat_id, amount,
        qty_already_returned          // across every note against this voucher
      } ] }
```

`qty_already_returned` is the part that cannot be computed here: Billing can see
the notes it raised itself, never the ones raised in Books or by another
product, and a screen offering "8 of 10 still returnable" from a partial view is
worse than one that asks.

**Until this exists**, the button is disabled with this reason and the lines are
entered by hand. Books still validates the quantity when the note is posted.

---

## Not available: an unfinished document kept on the server

**Purchases → Debit note says this wherever it mentions a draft.**

`POST vouchers/drafts` and `POST vouchers/drafts/{id}/post` are one step from
Billing's point of view: `TransactionService` creates the request row and posts
it in the same request, and `billing_transaction_requests` has no DRAFT state —
its unfinished rows are PENDING, POSTING or FAILED, which mean "on its way to
Books", not "still being typed".

So *Save as draft* keeps the form in `localStorage`, under the company and
financial year it was typed in, and the screen says exactly that: kept in this
browser, not on the server, not visible to anybody else. It is offered back when
the screen is next opened, and thrown away once the note posts.

### The contract Billing would need

Owner: **Billing**, not Books — a half-typed document is not an accounting
record and should never reach the ledger. It needs a `billing_document_drafts`
table and three endpoints (`GET` / `PUT` / `DELETE v1/drafts/{kind}`), scoped to
the company, the financial year and the user.

**Until that exists**, the local draft is the honest version: it works, it is
labelled, and it cannot leave a half-made voucher anywhere near the accounts.

---

## Not available: files attached to a document

**Purchases → Debit note shows this in place of its dropzone.**

A return challan, a photograph of damaged goods or the supplier's own credit
note all belong with the debit note, and there is nowhere to put them. This is
the same gap the expense screen has — see *Not available: keeping the bill
file*, below — and `DocumentCapture::storage()` is the single switch that
answers for both: absent a `DOCUMENT_STORAGE_BASE`, it is `false` regardless of
what the environment says, because Billing has no client that sends a file to
one yet. The debit note screen reads the same answer through
`GET v1/session`'s `capabilities.transaction_attachments`, so it cannot
disagree with the expense screen about what this deployment can keep.

**Until that client exists**, the dropzone here is replaced by a statement that
attachments are not available, and why — the debit note's own "Reference No."
field is the nearest thing to the expense screen's `attachment_ref`: a place to
record where the document is kept, not the document itself.

---

## Not available: the ledger effect before posting

**Purchases → Debit note shows this in its Accounting impact card.**

Which ledgers a debit note touches depends on the reason on the note, the bill
it is raised against, whether goods physically came back, the company's GST
registration and its own account settings — all of which live in Smart Books.
Books posts the voucher and answers with what it did; it has no endpoint that
answers what it *would* do.

The card therefore states what is certain, in words — that charging the supplier
back reduces what is owed to them, and whether any stock moves — and then says
the ledgers are decided when the note posts. **It does not draw two plausible
ledger rows**, because a guess printed where somebody looks for a fact is the
thing this file exists to prevent.

### The contract Billing would need

Owner: **Smart Books**.

```
POST vouchers/preview
  { cmp_id, fy_id, bo_id, vch_type_id, <the same payload as vouchers/drafts> }

  → { data: {
        entries: [ { acc_id, acc_name, side: "debit"|"credit", amount } ],
        tax: [ { tax_cat_id, component, rate, amount } ],
        round_off, total,
        warnings: [ { code, message } ]
      } }
```

It must compute nothing of its own and write nothing — the same code path as
posting, run without the write — or the preview and the posting will disagree,
which is worse than having no preview at all.

---

## Not available: keeping the bill file

**The expense screen shows a reference field instead.**

There is nowhere in this deployment to put a PDF or a photo of a bill and get it
back later, and Billing is the wrong place to build one: the deploy runs
`rsync --delete` over the document root (see `DEPLOYMENT.md`), so a folder of
uploads beside the app would not survive a release.

So the expense screen records **where the bill is kept** — a file number, a
folder, a link — and sends it to Books as `attachment_ref` on the voucher, which
is a field the expense request already accepted. That is a smaller thing than an
attachment and it is honest about being one.

Two pieces are needed to turn it into a real attachment, and the first is
configuration:

```
DOCUMENT_STORAGE_BASE=<service>     in server-php/.env

POST <DOCUMENT_STORAGE_BASE>/v1/documents
  multipart: file=<pdf|jpg|png>, scope=<cmp_id>/<fy_id>
  → { data: { reference, filename, size, content_type, url } }

GET <DOCUMENT_STORAGE_BASE>/v1/documents/<reference>
  → the file, for whoever may see the voucher
```

The second is a client for it in `server-php/src/Clients/`, and one line in
`DocumentCapture::storage()`. Until both exist that method answers `false`
whatever the environment says, because configuring a service Billing cannot call
would put a drop zone on screen that swallows a photo and loses it.

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
