# FIO-uhrady

> In one sentence: what the household costs, how much of it falls on whom — and whether it
> has reached the account.
> *Česky: [README.md](README.md)*

**Live:** <https://fio-uhrady.bass443.workers.dev> · state and plan in
[docs/STATUS.en.md](docs/STATUS.en.md)

## What it does

- **Records house costs** — items with different frequencies, categories, split across
  individual people by percentage or a fixed amount. A purchase can be spread over months,
  because coal worth 42,000 is not one month's cost.
- **Downloads transactions from Fio bank** (read-only token) and **matches them** by
  variable symbol; when that is missing it looks for a known symbol in the transaction
  comment and in the message for the recipient. Every payment shows **how** it was matched.
- **Tracks advances** — the contribution is paid as a fixed standing order. The application
  proposes the amount, the administrator sets it.
- **Closes months and settles periods on its own.** The difference against reality is folded
  into the new advance so the standing order can stay fixed.
- **A personal overview for each member** on an unguessable link — running balance, month by
  month, QR payment, yearly house costs. They see only their own figures.

This is not rent. It is **a share of what the house costs**.

## Stack

- **Cloudflare Workers** — application and API in a single Worker
- **Cloudflare D1** — data (costs, shares, payments, advances, closings, settlements, audit)
- **Cron Trigger** — every 15 minutes: Fio download and automatic closings
- **Cloudflare Access** (planned) / **PIN** — protects administration; no passwords in the code

## Access

| Part | Path | Who gets in |
|---|---|---|
| Administration | `/admin/*` | behind sign-in (Access takes precedence, otherwise a PIN) |
| Personal overview | `/v/{token}` | whoever has the link — unguessable token, no login |
| API | `/api/*` | the same sign-in as administration |
| Landing page | `/` | anyone — no data, only whether the app is alive |

The personal overview is **read-only** and shows only that one person's figures plus the
household total.

## Configuration

Secrets never go into git — copy `.dev.vars.example` to `.dev.vars` and fill it in locally.
Operational settings (thresholds, period length, QR wording, sentences for members) are
**not edited in code** but in the application's Settings.

| Variable | Purpose |
|---|---|
| `FIO_TOKEN` | read-only Fio API token for the probe; in production the token is stored in Settings |
| `DEV_ADMIN` | administration bypass for local development only, effective on localhost alone |

## Running it

```powershell
npm install
npm run dev        # local development (wrangler dev)
npm run typecheck  # tsc --noEmit
npm run probe      # Fio API probe, read only
npm run deploy     # deployment (manual, no CI)
```

## Documentation

| Document | Contents |
|---|---|
| [docs/STATUS.en.md](docs/STATUS.en.md) · [cs](docs/STAV.md) | what works, what does not, what comes next |
| [docs/ARCHITECTURE.en.md](docs/ARCHITECTURE.en.md) · [cs](docs/ARCHITECTURE.md) | how it fits together, matching rules, data model |
| [docs/MAP.en.md](docs/MAP.en.md) · [cs](docs/MAPA.md) | mind map and flow charts |
| [docs/presentation.en.html](docs/presentation.en.html) · [cs](docs/prezentace.html) | graphical presentation of the information flow |
| [docs/management-summary.en.html](docs/management-summary.en.html) · [cs](docs/manazerske-shrnuti.html) | one-page A4 summary for management |
| [docs/BUILD.en.md](docs/BUILD.en.md) · [cs](docs/BUILD.md) | how to build it from scratch |
| [HANDOFF.md](HANDOFF.md) | running log — why each decision was made (Czech) |

Documentation inside the application: `/admin/documentation` (English),
`/admin/dokumentace` (Czech).
