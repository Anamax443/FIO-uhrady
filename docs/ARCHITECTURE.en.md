# Architecture — FIO-uhrady

> Czech original: [ARCHITECTURE.md](ARCHITECTURE.md) · current state:
> [STATUS.en.md](STATUS.en.md) · diagrams: [MAP.en.md](MAP.en.md),
> [presentation.en.html](presentation.en.html)

## Overview

A single Cloudflare Worker handles four things: the cron download of transactions from
Fio, automatic closings and settlements, the administration behind sign-in, and a public
read-only overview on a tokenised link. Data lives in D1. No other server, no extra service.

## Components

- **Fio sync (cron)** — every 15 minutes it pulls transactions from the Fio REST API for a rolling window and stores new ones in `payments`.
- **Matcher** (`fio.ts`) — assigns payments to people by variable symbol and fallback fields, recording how each match came about.
- **Automation** (`automat.ts`) — closes months and settles periods without operator involvement.
- **Administration (`/admin/*`)** — costs, people, payments, advances, closings, settlements, settings.
  Cloudflare Access takes precedence; the fallback is a PIN (no passwords in the code, only a PBKDF2 hash).
- **Personal overview (`/v/{token}`)** — running balance, month by month, QR payment, yearly
  house costs. Read only, and only that person's own figures.

## Data flow

1. Cron calls `GET https://fioapi.fio.cz/v1/rest/periods/{token}/{from}/{to}/transactions.json`.
2. Each transaction is stored in `payments` with the primary key = **Fio transaction id** (`column22`), so re-fetching the same window duplicates nothing.
3. The matcher looks for a variable symbol in unassigned payments (see below) → a person.
   A payment also carries `obdobi`, the month it is **for** — pre-filled from the date, overridable by the admin.
4. Costs are split across people per item (by percentage or a fixed amount), month by month.
5. `owed = advance for months past due + carry-over from settlement − what arrived`.
   The debt **carries from month to month**; it is not tied to one particular month.
6. A closing freezes a month; a settlement closes a period and moves `settings.vyuctovani_od`.

## Automation

| When | What happens | Safeguard |
|---|---|---|
| Due date of the **following** month | The month is closed — costs, shares, advances and the item list are frozen | A closed month is never closed again |
| `vyuctovani_mesicu` (default 12) consecutive months closed | The period is settled | A completed settlement is never overwritten |

The extra month before closing is deliberate: a payment sent at the last moment lands a few
days later, and without that buffer a closing would freeze a gap that is not real. Both can
be switched off in Settings and both can be undone and redone manually; in the audit trail
automation signs itself as `automat (cron)`, so it is clear what a human did.

## Why `periods/` and not `last/`

Fio also offers `last/{token}/transactions.json`, which keeps a cursor on the bank's side.
**We do not use it.** The cursor moves even when our write to D1 fails or the Worker dies
between fetching and storing — those transactions would never be fetched again and would
silently go missing. Instead we fetch a fixed window with overlap (14 days back by default)
and rely on deduplication by transaction id. The download is therefore idempotent and can
be replayed at any time.

The Fio API allows **one request per 30 seconds** per token. A 15-minute cron fits with room
to spare, but no loops over multiple windows within one run without spacing.

## Matching rules

The variable symbol is looked for in this order; the first hit wins and is written to
`payments.matched_by`:

| Order | Source | Fio field | Who fills it in |
|---|---|---|---|
| 1 | Variable symbol | `column5` | the payer, in the payment order |
| 2 | Comment | `column25` | **the account owner**, afterwards in Fio internet banking |
| 3 | Message for the recipient | `column16` | the payer |
| 4 | Payer identification | `column7` | the payer / the bank |
| 5 | Manual assignment | — | the administrator, in the payments queue |

**Arbitrary numbers are not taken** from the free-text fields (2–4). Numeric candidates are
extracted and only one matching a **registered variable symbol** is used. Otherwise random
numbers from the text (a date, an amount, the counterparty's invoice number) would end up
driving the matching.

Every match carries `matched_by` + `matched_value` + a timestamp, so the interface shows
*"matched from the comment: 240137"* rather than a silently changed number. A manual
assignment is never overwritten by an automatic run.

## Data model

The brief moved on from the first design: the app does not track prescriptions, it tracks
**house costs** and **advances** against them (see HANDOFF.md). Tables in the schema:

- `members` — a person: name, variable symbol, account number, `je_platce` (contributions arrive from them), `pod_member_id` (someone else carries their obligation), `view_token`, `rod`
- `cost_items` — a cost item: amount per period, periodicity, kind, date, spreading (`rozpustit_od`, `rozpustit_mesicu`), `zdroj_uhrady` (household account × own pocket)
- `cost_shares` — a person's share of an item, as a percentage or a fixed amount
- `zalohy` — advance history: person, amount, valid from; **never rewritten**, so retrospective calculations hold
- `uzaverky`, `uzaverka_podily`, `uzaverka_polozky` — a frozen month: costs, shares, advances, item list
- `vyuctovani`, `vyuctovani_radky` — a closed period: prescribed / paid / actual, how the difference was handled and what was left outside the advance
- `payments` — a Fio transaction: `fio_id` (PK), date, amount, currency, VS/KS/SS, counterparty and its name, `column16`, `column25`, `column7`, raw JSON, the assigned person and how it was recognised, plus `obdobi`
- `settings` — configuration, see below
- `audit_log` — who changed what, when and from what to what; written in the same batch as the change
- `sync_runs` — a diary of runs: when, for which window, how many new, how many matched, any error

`vyuctovani_od` is critical for correctness: saving a settlement moves it past the end of
the period, so money already reconciled is not counted again.

## Configuration, not code

Anything that may change over time belongs in `settings` and is editable in the application —
thresholds, period lengths, wording. Only a **default** stays in the code, so the app runs
without configuration and the migration is not mandatory.

| Key | Purpose |
|---|---|
| `vyuctovani_od` | start of the running period; the settlement moves it |
| `den_splatnosti` | day of the month a contribution falls due (1–28) |
| `rezerva_procent` | buffer in the proposed advance for unplanned purchases |
| `prah_doplatku` | above this, a shortfall is not folded into the advance automatically |
| `auto_uzaverka`, `auto_vyuctovani` | unattended operation on/off |
| `vyuctovani_mesicu` | length of the settlement period |
| `qr_prijemce`, `qr_zprava` | what goes into the QR payment; empty = leave it out |
| `text_*` | sentences on the personal overview (defined in `src/texty.ts`) |
| `fio_token` | the bank token; never returned to the UI in full |

## Names and forms of address

The overview lives on a link that can be forwarded, so it shows only **that person's own
figures** plus the household total. Grammatical gender is **a field on the person**, not a
guess from the name — when it is empty the app speaks neutrally.

## Checks worth running

- `npm run typecheck` — tsc with no emit.
- **Syntax of generated scripts**: pages assemble JavaScript as a string, so a duplicate
  `const` kills the whole page script, not just one function. Extract `<script>` from the
  page and run `node --check`.
- **Totals after filtering** are computed in the browser; they must match the server's.

## External dependencies

- **Fio REST API** — `fioapi.fio.cz`, read-only token, one request per 30 s.
  It also returns **HTTP 500** during outages on their side; that is not a token problem.
- **Cloudflare** — Workers, D1, Cron Triggers, Access (account `bass443`).
  `d1 execute --remote --file` fails on this account with `Authentication error 10000`
  — run migrations as individual `--command` calls.
