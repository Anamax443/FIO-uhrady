# FIO-uhrady

> Jednou větou: přehled o tom, kdo kolik zaplatil a kolik ještě dluží — párováno automaticky proti pohybům na účtu Fio banky.

## Co to dělá

- Stahuje pohyby z **Fio REST API** (read-only token) a ukládá je do databáze.
- Páruje příchozí platby na **předpisy** (kdo má kolik zaplatit) podle **VS**, a když plátce VS nevyplní, podle poznámky, kterou k platbě dopsal vlastník účtu v internetbankingu Fio.
- **Admin stránka** (za dvoufaktorem) — správa plátců, předpisů, ruční dopárování a nastavení.
- **Přehledová stránka** (odkaz s tokenem) — jen náhled: uhrazeno vs. dlužno, graf v čase, výpis úhrad, export.

## Stack

- **Cloudflare Workers** — aplikace i API v jednom Workeru
- **Cloudflare D1** — data (plátci, předpisy, platby, párování, nastavení)
- **Cron Trigger** — periodické stahování pohybů z Fio
- **Cloudflare Access** — 2FA před admin částí (žádný vlastní login v kódu)

## Přístup

| Část | Cesta | Kdo se dostane |
|---|---|---|
| Admin | `/admin/*` | jen za Cloudflare Access (2FA) |
| Přehled | `/v/{view_token}` | kdo má odkaz — neuhodnutelný token, bez loginu |
| API | `/api/*` | admin API za Access, veřejné čtení jen pro platný `view_token` |

Přehled je **read-only** — nic se v něm nedá změnit, jen prohlížet a exportovat (CSV / tisk).

## Konfigurace

Tajemství nikdy do gitu — zkopíruj `.dev.vars.example` na `.dev.vars` a vyplň lokálně.

| Proměnná | K čemu |
|---|---|
| `FIO_TOKEN` | read-only token k Fio API (v produkci `wrangler secret put`) |

## Spuštění / build

```powershell
npm install
npm run dev      # lokální vývoj (wrangler dev)
npm run deploy   # nasazení (ručně, žádné CI)
```

## Dokumentace

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — jak je to poskládané, včetně pravidel párování
- [docs/BUILD.md](docs/BUILD.md) — jak postavit od nuly (výrobní)
- [HANDOFF.md](HANDOFF.md) — deník stavu
