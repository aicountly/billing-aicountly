# billing-aicountly

Billing for Aicountly — a React single-page app built with Vite and TypeScript,
with a small PHP API alongside it. Both halves deploy to cPanel.

| Environment | App | API |
| --- | --- | --- |
| Production | https://billing.aicountly.com | https://billing.aicountly.com/api |
| Sandbox | https://billing.gh.aicountly.com | https://billing.gh.aicountly.com/api |

## What this app does today

Login → the dashboard your Billing profile starts on. An owner lands on the
business overview; a counter biller lands on the biller desk and is never shown
the other four.

Five dashboards, all reading live from Smart Books and Inventory:

| | |
|---|---|
| **Overview** | sales, what you are owed, what you owe, what is in hand, and one counted line about what needs a decision today |
| **Biller desk** | the counter screen — the next bill, and this user's own work |
| **Receivables** | ageing, who to chase, what they promised |
| **Payables** | what falls due, and bills worth a second look |
| **Cash & compliance** | the day's money, the day-close checklist, document status |

And the two bill-by-bill screens the dashboards link into — **Money to Collect**
and **Money to Pay** — where the ageing, the follow-up list and the collection
actions are: aged buckets you can click into, who owes what, filters that live in
the address bar, and a reminder, a receipt or a statement one step away.

Behind them: sales and purchases, credit and debit notes with their original
document, receipts and payments with allocation, bank deposits and withdrawals,
ten live reports with CSV export behind a searchable Reports screen, and
Billing profiles deciding who sees what.

**Money to Pay** (`/payables`) is the payables workspace the fourth dashboard
links into: the headline figures, the ageing, what falls due next and the
category split, over a searchable, filterable, sortable, paged list of every
outstanding supplier bill — all from one reading of Smart Books per request.

**Parties** (`/parties`) is the directory beside them — every customer and
supplier with what they owe next to the name, searchable, filterable and
exportable. It is composed from Smart Books on each request and stores nothing:
no party table, no balance, no sync. A figure Books does not carry is drawn as
"—" with the reason on it, never as a zero.

Behind those, `/settings` is a hub over twelve categories — company, documents,
users, taxes, money, preferences, items, parties, automation, security,
integrations and advanced. Each row says plainly whether the setting lives in
Billing, in the product that owns it, or nowhere yet, and the setup checklist on
it is worked out from your actual configuration rather than fixed. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#settings).

See [docs/BILLING_IMPLEMENTATION_STATUS.md](docs/BILLING_IMPLEMENTATION_STATUS.md)
for what each figure means, and
[docs/BILLING_API_DEPENDENCIES.md](docs/BILLING_API_DEPENDENCIES.md) for the
capabilities no product in this deployment serves yet — each one a place where a
screen says so rather than showing a zero.

Signing in is the AICOUNTLY portal's job, the same as every other AICOUNTLY
SaaS: the app redirects to the portal, the portal returns an `auth_token`, and
the app exchanges it for a short-lived session key. A user who is already signed
in to another AICOUNTLY product lands straight on the dashboard.

See [docs/auth/AICOUNTLY_AUTH_WORKFLOW.md](docs/auth/AICOUNTLY_AUTH_WORKFLOW.md).

## Layout

```
web/          React app (Vite). Builds to web/dist, deployed to the document root.
mobile/       iOS/Android app (Expo + React Native). See mobile/README.md.
server-php/   PHP API. Deployed to the api/ folder inside the document root.
docs/         deployment and auth notes
```

## Getting started

Requires Node.js 22 or newer.

```bash
cd web
npm install
cp ../.env.example ../.env
npm run dev
```

The dev server runs on http://localhost:5173 and signs in through the **sandbox**
portal. Point `VITE_API_BASE_URL` at the deployed sandbox API
(`https://billing.gh.aicountly.com/api`) so the token exchange has somewhere to
go — and add `http://localhost:5173` to `CORS_ALLOWED_ORIGINS` in that server's
`api/.env`, since localhost is the one case where the app and API are not
same-origin.

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server on http://localhost:5173 |
| `npm run build` | Type-check, then build to `web/dist/` |
| `npm run typecheck` | Type-check only |
| `npm test` | Unit tests, on Node's own runner — no framework, no build step |
| `npm run preview` | Serve the production build locally |

`web/visual.html` is a development-only photo booth: it mounts the real page
components against fixtures so the screens can be checked at any width without a
portal session or a company's data. `?screen=` picks one — the five dashboards,
`money-in`, `money-out`, `expense`, `credit-note`, `bank-withdrawal`, `sale`,
`items`, `purchase`, `settings`, `dues` (Money to Collect), `money-to-pay`
(Money to Pay),
`reports` (the Reports discovery screen) or `report` (one report, open) —
`?as=biller` narrows the profile, and `?fail=recent,categories` makes those
endpoints answer 503, which is how the "one panel is down, the form still
works" states get checked. `?fail=overview` and `?fail=briefing` are the
overview's two halves, so "the dashboard is down" and "only the written summary
is down" can be checked apart from each other. The credit note screen adds
`bills`, `bill-lines`, `warehouses`, `trend` and `issue` to that list, the
bank-withdrawal screen adds `balance`, `withdrawals` and `withdrawal-summary`,
the Items screen adds `items`, `stats` and `groups`, and the Reports screens
add `reports` and `report`, so their degraded states are reachable too. `?at=` sets the screen's OWN query string
(`?screen=items&at=stock_status%3Dlow`), which is the only way to photograph a
screen that keeps its state in the address bar in its filtered, sorted or paged
states. The settings hub
adds `&category=` for its twelve detail pages
(`?screen=settings&category=taxes`). `vite build` takes `index.html` only, so
none of it reaches the deployed bundle.

Money to Collect and Money to Pay add two more: `?state=empty|error|slow` for
the three states they must survive — nothing outstanding, Books unreachable, and the skeletons
in between — and `?router=browser`, which swaps the memory router for the real
one so the filters that live in the address bar can be exercised through the
browser's own back and forward buttons.

The PHP API has no build step and no dependencies. To run it locally:

```bash
cd server-php
cp .env.example .env      # set APP_ENV=local
php -S localhost:8000
```

## Environment variables

`.env` is git-ignored and is never deployed — `.env.example` is the tracked
template. There are two of them, and they work in opposite ways:

| File | Read | Used by |
| --- | --- | --- |
| `.env.example` | **Build time**, inlined into the bundle | `web/` |
| `server-php/.env.example` | **Runtime**, on every request | `server-php/` |

| Variable | Description |
| --- | --- |
| `VITE_API_BASE_URL` | API base URL. Empty = this app's own origin + `/api` |
| `VITE_APP_NAME` | Display name shown in the UI |
| `VITE_APP_ENV` | `local`, `sandbox`, or `production` |
| `VITE_PRODUCT_KEY` | Portal product key. Derived from the hostname when unset |
| `VITE_PORTAL_LOGIN_URL` | Login portal override. Local development only |
| `VITE_FEATURE_REPORT_*` | Reports controls with no endpoint behind them yet. See `.env.example` |

Only `VITE_`-prefixed variables reach the browser bundle, and Vite inlines them
at build time, so **treat every one of them as public**. Never put a secret,
token, or password in a `VITE_` variable.

### These are build-time values, not runtime values

This matters for how you change an endpoint in production.

Vite substitutes each `VITE_*` value into the JavaScript bundle when the app is
compiled. The deployed result is plain static files — **the app never reads a
`.env` from disk at runtime**, so placing a `.env` next to it in the cPanel
document root has no effect. Changing an endpoint means rebuilding and
redeploying.

This is the opposite of `server-php`, which is PHP and does read its own `.env`
on every request.

## Deployment

Deployment is **manual only**. Nothing deploys on push or merge — both
workflows trigger exclusively via `workflow_dispatch`.

To deploy: **Actions** → pick a workflow → **Run workflow** → pick a branch →
**Run**.

| Workflow | Deploys | To |
| --- | --- | --- |
| Deploy to cPanel Production | `web/dist/` then `server-php/` | document root, then `api/` inside it |
| Deploy to cPanel Sandbox | `web/dist/` then `server-php/` | document root, then `api/` inside it |

Production and sandbox deploy separately, so releasing to one cannot disturb
the other. Within one environment, web and API deploy together in the same
run — they always change in step, so there is no separate "API only" workflow
to remember to run. Source, `node_modules`, and `.env` never reach the server.

Before deploying, each workflow checks that every required SSH secret is set and
that the remote root is a safe path, so a misconfigured repository fails in
seconds instead of part-way through a deploy.

### Configuration

These repository **secrets** must be set (Settings → Secrets and variables →
Actions → Secrets):

`PROD_SSH_HOST`, `PROD_SSH_PORT`, `PROD_SSH_USER`, `PROD_SSH_PRIVATE_KEY`,
`PROD_SSH_REMOTE_ROOT` — and the same five with a `SANDBOX_` prefix.

`*_SSH_REMOTE_ROOT` is the document root to deploy into. It may be relative,
which is the usual cPanel form — `public_html` resolves against the SSH user's
home directory, giving `/home/<user>/public_html`. An absolute path works too.
Because the deploy runs with `--delete`, the workflow refuses a value that would
resolve to the home directory itself (`.`, `~`, empty), a system directory, or
anything containing `..`.

The repository **variables** `PROD_API_BASE_URL` and `SANDBOX_API_BASE_URL` are
optional. Unset, the app calls its own origin + `/api` — which is where the same
workflow puts the API. Set one only to point the app at a different API domain.

### Notes on the rsync steps

Each workflow runs two `rsync --delete` steps, one after the other, and the
excludes are what make that safe.

The **web** step syncs the document root and excludes:

- `api/` — the PHP backend lives inside the document root and is deployed by the
  next step in the same run. **Without this exclude the web step would delete
  the entire API.**
- `.well-known/` — Let's Encrypt / AutoSSL validation; removing it breaks
  certificate renewal
- `cgi-bin/` — cPanel-managed, present in every document root
- `.env`, `.env.*`, `.git*` — never published

The **API** step syncs `api/` and excludes `.env`, `.env.*` and `.git*`: the
API's `.env` is created once on the server and read at runtime, so it must
survive every deploy. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

`web/public/.htaccess` ships with the build and provides the SPA history
fallback — which is also what serves the portal's `/auth/callback` landing — plus
cache headers (`index.html` uncached, hashed assets cached for a year).
