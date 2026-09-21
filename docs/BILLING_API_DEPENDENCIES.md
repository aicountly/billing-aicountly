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
**Until this exists**, both screens offer the manual path, which records exactly
the same thing.

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

## Not depended on: Aicountly Pay

Nothing in this product requires a payment gateway, and nothing in it moves
money. "Record receipt" and "Record payment" write an accounting voucher in
Smart Books against a cash or bank ledger — that is a record of something that
happened, not an instruction to a bank.

There is no `Pay now` button, no payment link, no webhook listener and no
settlement state. When Aicountly Pay is configured, it arrives as an adapter
beside the existing methods; no screen in this product has been shaped around
its absence, so none has to be reshaped by its arrival.
