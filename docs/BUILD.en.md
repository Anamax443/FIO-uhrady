# BUILD — building FIO-uhrady from scratch

> **Readiness test:** can a new person (or I, after replacing my PC) get from THIS document
> alone to a running application? If not, add what was missing.
> *Česky: [BUILD.md](BUILD.md)*

## 1. Prerequisites
- **Node.js 20+** (verified on v24.13.1)
- **Wrangler** — installed as a devDependency, no global install needed
- a **Cloudflare** account, `bass443` (`npx wrangler login`)
- a **Fio bank** account able to issue an API token

## 2. Getting the code
```powershell
gh repo clone Anamax443/FIO-uhrady
cd FIO-uhrady
npm install
```

## 3. Configuration and secrets
1. `copy .dev.vars.example .dev.vars` and fill in `FIO_TOKEN`.
   - The token: Fio internet banking → Settings → API. Issue it **read-only** — the
     application only reads transactions.
2. In production the bank token is stored in the application's Settings, not in
   `wrangler.jsonc` and never in git.

## 4. Database (D1)
```powershell
npx wrangler d1 create fio-uhrady          # returns database_id → put it in wrangler.jsonc
```

Migrations live in `schema/` and run **in order, 0001 … 0012**. Most are written as
`create table if not exists`, so re-running breaks nothing; an `alter table` on a second run
fails with "duplicate column name", which is also fine.

**Local database** — the file form works:
```powershell
npx wrangler d1 execute fio-uhrady --local --file schema/0001_init.sql
```

**Production database — do NOT use `--file`.** Cloudflare rejects it on the `bass443`
account (`Authentication error [code: 10000]`) because it goes through the import endpoint.
Run the statements one at a time with `--command`; every migration's header carries the
ready-made wording to copy. This once left a migration half-applied in production and the
application failed on the missing column, so verify what the database actually contains
after each migration:
```powershell
npx wrangler d1 execute fio-uhrady --remote --command "select name from sqlite_master where type='table' order by name"
npx wrangler d1 execute fio-uhrady --remote --command "select group_concat(name,', ') from pragma_table_info('members')"
```

Optional sample data: `schema/seed_priklad.sql`.

## 5. Build and run locally
```powershell
npm run types      # generates worker-configuration.d.ts from wrangler.jsonc
npm run typecheck  # tsc --noEmit
npm run dev        # http://127.0.0.1:8787
```
Confirming it is alive:
- `GET /api/version` → `{ "app": "fio-uhrady", "commit": "dev" }`
- `GET /api/health` → `{ "db": "ok" }` (proves the D1 binding really works)

For local administration without Cloudflare Access:
`npx wrangler dev --var DEV_ADMIN:1` — the bypass only works on localhost.

## 6. Deploying to production
Target: `fio-uhrady.bass443.workers.dev` (no custom domain yet). Deployment is **manual**,
there is no CI:
```powershell
npm run deploy
```
The script refuses to deploy a dirty working tree and stamps the short commit hash into the
Worker.

**Verify after deploying:** `GET /api/version` must return the hash you deployed. Cloudflare
takes tens of seconds to propagate, so a first check may still show the previous version.

## 7. Access and permissions
- **Administration (`/admin/*`)** — **Cloudflare Access** takes precedence (Zero Trust →
  Access → Applications): the application at `fio-uhrady.bass443.workers.dev/admin`, policy =
  a specific e-mail address. Without Access, a **PIN** gets you in — the database holds only
  a salted PBKDF2 hash (100,000 iterations); five failures lock it for 15 minutes, ten for an
  hour. No passwords in the code.
  ```powershell
  node scripts/set-pin.mjs 1258   # prints two ready --command statements to run
  ```
- **Personal overview (`/v/{token}`)** — no login; its protection is that the link cannot be
  guessed (128 bits of randomness in `members.view_token`). It is created per person in
  Settings and can be revoked.
- **Fio token** — read-only, stored in Settings; never returned to the UI in full.

## 8. Verifying the core (before building further)
```powershell
npm run probe
```
The probe only reads from the Fio API and reports which fields are populated, plus describes
the token (length, unexpected characters) without printing it. It must confirm that
`column25` appears in the response — the comment added by the account owner, on which the
fallback matching depends.

`HTTP 500` from Fio **does not mean a bad token** — an outage on their side looks the same.
The limit is one request per 30 s, so retrying immediately is pointless.

## 9. Checks before deploying
```powershell
npm run typecheck
```
It is also worth verifying **the syntax of the scripts the pages generate**. Pages assemble
JavaScript as a string, so a duplicate `const` does not break one function — it breaks the
whole page script, and with it every button. Extract `<script>` from the running page and
run `node --check`; this once broke filtering and item saving at the same time.

## 10. Unattended operation
The cron runs every 15 minutes and does two independent things: it downloads from Fio and
catches up on closings and settlements. Neither a missing token nor a bank outage may stop
months from closing, so the two are separated in the code. Automation can be switched off
with the toggles on the Closings and Settlement pages.
