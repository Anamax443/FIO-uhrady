# STATUS — FIO-uhrady

> Where the project stands **today**. History and decisions live in
> [HANDOFF.md](../HANDOFF.md); this document gets rewritten.
> Czech original: [STAV.md](STAV.md).

**As of 2026-08-21 · live `4207e8d` · <https://fio-uhrady.bass443.workers.dev>**

## What it is for

Working out what a household costs and splitting it between its members.
**This is not rent** — it is a share of what the house actually costs.
Contributions are paid as a fixed standing order; the application matches them
against transactions on a Fio bank account and, once per period, reconciles the
fixed advances against reality.

## What works

| Area | State | Note |
|---|---|---|
| House costs | ✅ | items, split per person, categories, sorting and filters with live totals |
| People and identification | ✅ | variable symbol, account number, who carries whose share, grammatical gender |
| Fio download | ✅ | `periods/` with overlap, dedup by transaction id, every run logged |
| Payment matching | ✅ | VS → comment → message → identification → manual; the reason is always visible |
| Payment's target month | ✅ | pre-filled from the payment date, admin can override |
| Advances | ✅ | history is never rewritten; the app proposes, the admin decides |
| Monthly closings | ✅ | freeze what applied that month; **automatic** once the next month falls due |
| Period settlement | ✅ | difference folded into the advance or left to pay; **automatic** once the period is complete |
| Member's personal view | ✅ | `/v/{token}`, running balance, QR payment, wording from Settings |
| Audit trail and change history | ✅ | no write without a record; its own page showing old → new values |
| AI layer | ✅ | switchable backend (free Workers AI × Claude), commentary on cost trends |
| Sign-in | ✅ | PIN (PBKDF2 + lockout); Cloudflare Access takes precedence |

## What is not there yet

| Missing | Why it is not blocking |
|---|---|
| **AI — reading receipts** | the layer and the trend commentary are done; only receipt OCR is left |
| **E-mail (Resend)** | the settlement is shown in the app and on the personal link |
| **CSV import** | export works; nobody has needed import yet |
| **Cloudflare Access instead of the PIN** | the PIN works; Access is a planned swap |
| **Admin UI in English** | documentation is bilingual, the interface is Czech only |

## Numbers

- **12 schema migrations** (`schema/0001` … `0012`), all applied to production
- **15 modules** in `src/`, type check clean
- Deployment is **manual** (`npm run deploy`), no CI; cron runs every 15 minutes

## Traps everyone hits

1. **`d1 execute --remote --file` fails** — Cloudflare returns
   `Authentication error [code: 10000]`. Migrations must be run as individual
   `--command` calls. This once left a migration half-applied in production and
   the app failed on the missing column.
2. **`osobaPodleTokenu` has its own column list.** A new column must be added
   there too, otherwise the personal view never sees it and silently behaves as
   if it were empty.
3. **A duplicate `const` in the generated script kills the whole page.** Pages
   assemble their JavaScript as a string, so a name clash does not break one
   function — it breaks everything. Check by extracting `<script>` from the page
   and running `node --check`.
4. **Fio's API also returns HTTP 500** during outages on their side. It is not a
   token problem; `periods/` fetches the whole window, so the next run catches up.

## Waiting on the owner

- **Sewerage → "paid from" = own pocket.** Grandpa pays it himself, but the item is
  set to the household account, so the 967 CZK per month is not credited to him as a
  deposit (580 CZK a month more than his own share). It has to be changed in the
  application, not via SQL — a database change would leave no audit trail.

## What comes next

1. **Reading receipts** — a photo straight into a cost item; the AI layer is ready for it.
2. **E-mail** via Resend — settlement sent to members.
3. **Cloudflare Access** replacing the PIN.
4. **CSV import** back into the application.
