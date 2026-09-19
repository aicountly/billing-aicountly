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

## Not available: supplier-bill extraction

**Dashboard 4 shows an unavailable state for this.**

Reading a bill out of a PDF or a photo needs a document-extraction service, and
this deployment has none. Billing does not add an OCR stack, and it does not ask
a model to guess at a supplier's totals.

Enabled by setting `DOCUMENT_EXTRACTION_BASE` in `server-php/.env` once a service
exists. The expected shape, following the house "deterministic first, AI only for
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
person has approved it. **Until this exists**, the panel offers the manual path,
which records exactly the same purchase bill. The debit note screen does the
same: *Scan & add (AI)*, *Use AI to fill the items* and *Import* are disabled
there and carry this reason, rather than looking live and doing nothing.

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
note all belong with the debit note, and there is nowhere to put them. Billing
has no file storage, and neither Books nor Inventory exposes one to it. The one
attachment field in this product — `attachment_ref` on an expense — is a text
reference to a file somebody else is holding.

### The contract Billing would need

Owner: whichever service takes on document storage for the fleet.

```
POST <STORAGE_BASE>/v1/files
  multipart: file=<pdf|jpg|png>, cmp_id, scope=billing.debit_note
  → { data: { file_id, filename, size, content_type, url } }

DELETE <STORAGE_BASE>/v1/files/{file_id}
```

Billing would then send `attachment_ids` with the transaction and let the owning
service hold the bytes. **Until this exists**, the dropzone is replaced by a
statement that attachments are not available, and why.

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

## Not depended on: Aicountly Pay

Nothing in this product requires a payment gateway, and nothing in it moves
money. "Record receipt" and "Record payment" write an accounting voucher in
Smart Books against a cash or bank ledger — that is a record of something that
happened, not an instruction to a bank.

There is no `Pay now` button, no payment link, no webhook listener and no
settlement state. When Aicountly Pay is configured, it arrives as an adapter
beside the existing methods; no screen in this product has been shaped around
its absence, so none has to be reshaped by its arrival.
