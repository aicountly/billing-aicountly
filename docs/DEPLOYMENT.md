# Deploying Billing

Both environments deploy **manually only**. Nothing deploys on push, pull
request, or merge.

| Environment | Domain | Workflow | Secrets |
| --- | --- | --- | --- |
| Production | https://billing.aicountly.com | *Deploy to cPanel Production* | `PROD_SSH_*` |
| Sandbox | https://billing.gh.aicountly.com | *Deploy to cPanel Sandbox* | `SANDBOX_SSH_*` |

## How to deploy

**Production**

```
GitHub → Actions → Deploy to cPanel Production → Run workflow
```

**Sandbox**

```
GitHub → Actions → Deploy to cPanel Sandbox → Run workflow
```

Pick the branch to deploy, then **Run workflow**. The only trigger on either
file is `workflow_dispatch` — there is deliberately no `push` trigger, so
merging to `main` never deploys anything.

## Layout

```
web/          React app (Vite). Builds to web/dist.
server-php/   optional PHP API. Deployed as-is to api/. Not present yet.
docs/         this file
```

## What lands where on cPanel

| Source | Destination | Reachable at |
| --- | --- | --- |
| `web/dist/` | `<remote root>/` | https://billing.aicountly.com |
| `server-php/` | `<remote root>/api/` | https://billing.aicountly.com/api |

`<remote root>` is the `*_SSH_REMOTE_ROOT` secret, normally `public_html` for
production and the sandbox subdomain's own document root for sandbox.

The `server-php` step is guarded by `hashFiles('server-php/**')` and is skipped
entirely while that directory does not exist. Adding it later needs no
workflow change.

### Why the api folder survives a web deploy

The web deploy runs `rsync --delete` against the document root, which would
otherwise remove everything not in the build — including `api/`, if a backend
is added there later, since it lives inside the document root. The web step
therefore excludes `api/` explicitly, and the API is deployed by its own step.
Removing that exclude would delete the entire backend on the next web deploy.

## What the deploy runs

```
Manual dispatch
  → checkout
  → validate secrets and the remote root
  → Node 22, npm ci
  → npm run build            (tsc -b && vite build)
  → verify build output
  → configure SSH (pinned host key)
  → verify SSH authentication
  → rsync --delete --exclude='.env'   web/dist/ → document root
  → rsync --delete --exclude='.env'   server-php/ → api/   (if present)
  → verify files on the server
  → HTTPS health check
```

Every step fails the workflow on error: `run:` steps use the default `bash -e`,
missing secrets exit 1, a failed SSH handshake exits 1, and a non-zero `rsync`
exit fails the job. The only deliberately non-fatal step is the HTTPS health
check (see below).

### No server-side PHP commands

There are none, and none are needed. Worth being explicit, because the
convention on this platform is easy to misread:

- The app is React + Vite. It is compiled on the GitHub runner and deployed as
  static files. There is no framework on the server to invoke.
- `api` in this architecture is a **URL path and a directory** —
  `<document root>/api`, where a PHP backend is rsynced — not a PHP binary. No
  step in either workflow executes `php`, `api`, `composer`, or anything else
  on the cPanel host.
- There is no CodeIgniter, no `composer.json`, and therefore no `spark`
  commands (`spark migrate`, `spark cache:clear`) to run. `benefits-aicountly`
  runs none either.

If a PHP backend is added under `server-php/` later and it does need
server-side commands, that is the point to add them — and to first confirm what
the cPanel account actually provides, since the PHP CLI path on cPanel is
account-specific (commonly `/usr/local/bin/php` or an `ea-php8x` binary).

### Post-deploy verification

Two checks run after the files are copied:

1. **Files on the server** — over the same SSH connection, confirms the remote
   root exists and contains `index.html`, lists the document root, and reports
   whether the server-side `.env` is still present. Fails the workflow if
   `index.html` is missing.
2. **HTTPS health check** — `curl` against the environment's domain, expecting
   `200` and the app's root element. This step is `continue-on-error: true` on
   purpose: a newly created portal may not have DNS, a vhost, or a certificate
   yet, and that must not report an otherwise successful file deploy as a
   failure. It logs a warning instead. Once the domain is live, a warning here
   means something is genuinely wrong.

## Configuration: build time vs run time

This is the part worth reading carefully, because the frontend and a future
backend behave in opposite ways.

### React (web/) — build time

Vite inlines every `VITE_*` value into the JavaScript bundle when the app is
compiled. The deployed result is plain static files that **never read a `.env`
from disk**. Putting a `.env` in the document root has no effect on the
frontend.

To change a frontend value: update the repository *variable*
`PROD_API_BASE_URL` or `SANDBOX_API_BASE_URL`, then re-run the workflow. The
rebuild applies it.

Never put a secret in a `VITE_` variable — anything inlined into the bundle is
public to anyone who views the page source.

### server-php — run time

PHP reads its `.env` on **every request**. So the API's `.env` belongs on the
server, and only on the server.

Create it once by hand — cPanel File Manager or SSH — at
`<remote root>/api/.env`:

```
DB_HOST=localhost
DB_NAME=<cpaneluser>_<dbname>
DB_USER=<cpaneluser>_<dbuser>
DB_PASS=<password>
APP_ENV=production
```

## Environment files

Each environment keeps its own `.env` on its own server path:

```
Production   billing.aicountly.com      → <PROD_SSH_REMOTE_ROOT>/.env
Sandbox      billing.gh.aicountly.com   → <SANDBOX_SSH_REMOTE_ROOT>/.env
```

They are never committed, never uploaded, and never deleted:

- `.gitignore` excludes `.env` and `.env.*`, keeping only `.env.example`.
- Every rsync step passes `--exclude='.env' --exclude='.env.*'`, so a
  `--delete` deploy leaves the server-side files untouched.
- The build-output check refuses to deploy if a `.env` somehow ends up in
  `web/dist` or a committed one appears in `server-php/`.

`.env.example` is the tracked template and contains placeholder values only —
never real credentials.

### Protecting .env over HTTP

`web/public/.htaccess` ships with the build and ends with:

```apache
RedirectMatch 404 /\.(?!well-known)
```

so any dotfile in the document root, including `.env`, returns 404 rather than
its contents. If `server-php/` is added later it needs its own `.htaccess` with
the same rule, because the document root's rules stop applying once the API's
own rules take over inside `api/`.

### Database on cPanel

Create the database and user under **MySQL Databases**. cPanel prefixes both
with the account name, so a database entered as `app` becomes
`<cpaneluser>_app` — use the full prefixed names in `.env`.

After creating the user, **add it to the database and grant ALL PRIVILEGES**. A
user that exists but was never attached to the database is a common cause of a
connection failing with no obvious reason.

`DB_HOST` is `localhost` on cPanel; the database is on the same machine.

## Required secrets

Set under Settings → Secrets and variables → Actions → Secrets. Values are
never printed by the workflows and must not be recorded here.

| Production | Sandbox |
| --- | --- |
| `PROD_SSH_HOST` | `SANDBOX_SSH_HOST` |
| `PROD_SSH_PORT` | `SANDBOX_SSH_PORT` |
| `PROD_SSH_USER` | `SANDBOX_SSH_USER` |
| `PROD_SSH_PRIVATE_KEY` | `SANDBOX_SSH_PRIVATE_KEY` |
| `PROD_SSH_REMOTE_ROOT` | `SANDBOX_SSH_REMOTE_ROOT` |

Each workflow validates its own four required secrets before building, and
verifies SSH authentication before writing anything to the server. `*_SSH_PORT`
is optional and defaults to 22.

The host key is fetched with `ssh-keyscan` and pinned in `known_hosts` with
`StrictHostKeyChecking yes` — host verification is never disabled. The private
key is written to the runner with mode 600 and removed in an `always()` cleanup
step.

## Manual cPanel setup, once per environment

The workflows deploy files; they do not create hosting. Before the first
deploy each environment needs:

1. The domain or subdomain created in cPanel (`billing.aicountly.com`,
   `billing.gh.aicountly.com`) with its document root noted — that path is the
   `*_SSH_REMOTE_ROOT` secret value.
2. DNS pointing at the server, and AutoSSL / Let's Encrypt issued for the
   domain.
3. SSH access enabled, with the deploy key's **public** half imported *and
   authorised* under SSH Access → Manage SSH Keys. cPanel treats importing and
   authorising as two separate actions; an imported-but-unauthorised key fails
   exactly like a wrong key.
4. `mod_rewrite` and `mod_headers` available (standard on cPanel) for the
   shipped `.htaccess`.
