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
which records exactly the same purchase bill.

## Partly available: what a bill was raised for

**Money to Collect shows this when Books sends it, and "not known" when it does
not. It is never rendered as zero.**

The bill-by-bill report is an OUTSTANDING report: every row is guaranteed to
carry the balance still owed, which is what the ageing, the totals and the
follow-up list are built from. Three columns on the bill-by-bill table want more
than that:

| Column | Needs | Today |
|---|---|---|
| Bill amount | the gross value of the bill | passed through when the row carries one |
| Received | gross less balance | derived, and only when the gross is present |
| Part paid badge | the same | shown only when received is known and above zero |

`DuesService::dues()` reads the gross from the first of `bill_amount`,
`invoice_amount`, `total_amount`, `bill_value`, `grand_total` that the row
actually carries, and emits `bill_amount` and `received` as **null** when none of
them is there. Null prints as "not known".

It is deliberately not inferred. A received amount worked out from the balance
alone would be a guess, and the difference between "this customer has paid
nothing" and "Books did not tell us what the bill was for" is the difference
between ringing them and not.

### The contract that would make it complete

Owner: **Smart Books**. One additional field per row on
`GET reports/bill-by-bill`:

```
  → { data: [ {
        …the existing row…,
        bill_amount: <number>     // the gross the bill was raised for
      } ] }
```

Nothing else changes: `received` stays a subtraction Billing performs, so there
is still only one authority for either figure.

## Not available: how a customer is classified

**Money to Collect shows "Who owes it" instead of "Receivables by party type".**

A breakdown by customer type — regular, new, government, export/SEZ — needs a
classification, and nothing in this deployment has one. Books' bill-by-bill
carries no such field, `masters/accounts` carries no segment, and Billing owns
no customer master of its own to put one in.

So the donut shows what IS known exactly: the largest debtors by outstanding,
with the tail gathered into one slice. That answers the same question a party-type
chart is usually asked — *where is my money sitting* — without putting a
confident label on a guess.

### The contract that would allow the original

Owner: **Smart Books** (or whichever product comes to own the customer master).
A stable classification on the account:

```
GET masters/accounts
  → { data: [ { acc_id, acc_name, …, party_segment: <string|null> } ] }
```

It must be a value somebody in the business SET, not one derived at read time:
a segment computed from turnover changes under the chart between two page loads
and cannot be reconciled against anything.

## Not available: a document route for one bill

**Money to Collect does not link a bill number to the bill.**

Every row on the list carries Books' `voucher_id` and `voucher_uuid`, but no
route in this product addresses a Books voucher: `/sales/:id` takes a Billing
*request* id — the record of something this app asked Books to create — and a
bill raised anywhere else has no such record. Linking the two would send the
user to a page that does not exist for most rows.

The row menu therefore offers what does exist: the party's statement, a receipt
against the bill, a drafted reminder, and the bill number on the clipboard. The
same gap is why there is no "Download PDF": `BooksClient::salesInvoicePdfUrl()`
can build the URL, but no Billing route exposes it and no endpoint fetches it
with the caller's own session key.

### The contract that would allow it

Owner: **Billing**, over Books' existing voucher endpoints — a read-through
route that takes a Books voucher id, checks `sale.view`, and returns the voucher
(or streams the invoice PDF) the way `v1/parties/{id}/statement` already does for
a ledger.

## Not depended on: Aicountly Pay

Nothing in this product requires a payment gateway, and nothing in it moves
money. "Record receipt" and "Record payment" write an accounting voucher in
Smart Books against a cash or bank ledger — that is a record of something that
happened, not an instruction to a bank.

There is no `Pay now` button, no payment link, no webhook listener and no
settlement state. When Aicountly Pay is configured, it arrives as an adapter
beside the existing methods; no screen in this product has been shaped around
its absence, so none has to be reshaped by its arrival.

Money to Collect keeps the integration point visible and honest: **Share a
payment link** sits in the quick actions and in the collection-actions menu,
permanently disabled, and says why when you hover it. A live-looking button that
quietly did nothing would be the worst outcome on a collections screen — the
user believes the customer was sent a way to pay and stops chasing them.
