# FIO-uhrady

> Jednou větou: co domácnost stojí, kolik z toho padá na koho — a jestli to dorazilo na účet.
> *In English: [README.en.md](README.en.md)*

**Živě:** <https://fio-uhrady.bass443.workers.dev> · stav a plán v [docs/STAV.md](docs/STAV.md)

## Co to dělá

- **Eviduje náklady domu** — položky s různou periodicitou, kategorie, rozpad na jednotlivé
  osoby procentem nebo pevnou částkou. Nákup se dá rozpustit do měsíců, protože uhlí za
  42 000 není náklad jednoho měsíce.
- **Stahuje pohyby z Fio banky** (read-only token) a **páruje je** podle variabilního symbolu;
  když chybí, hledá známý VS v komentáři u pohybu a ve zprávě pro příjemce. U každé platby
  je vidět, **čím** se poznala.
- **Vede zálohy** — příspěvek se platí fixní částkou na trvalý příkaz. Návrh počítá aplikace,
  stanoví ho správce.
- **Zavírá měsíce a vyúčtovává období sama.** Rozdíl proti skutečnosti se rozpustí do nové
  zálohy, aby trvalý příkaz mohl zůstat fixní.
- **Osobní přehled pro člena** na neuhodnutelném odkazu — průběžný zůstatek, měsíc po měsíci,
  QR platba, náklady domu na rok. Vidí jen svoje čísla.

Není to nájem. Je to **podíl na tom, co dům stojí**.

## Stack

- **Cloudflare Workers** — aplikace i API v jednom Workeru
- **Cloudflare D1** — data (náklady, podíly, platby, zálohy, uzávěrky, vyúčtování, audit)
- **Cron Trigger** — á 15 minut: stahování z Fio a automatické uzávěrky
- **Cloudflare Access** (výhledově) / **PIN** — ochrana správy; v kódu žádná hesla

## Přístup

| Část | Cesta | Kdo se dostane |
|---|---|---|
| Správa | `/admin/*` | za přihlášením (Access má přednost, jinak PIN) |
| Osobní přehled | `/v/{token}` | kdo má odkaz — neuhodnutelný token, bez loginu |
| API | `/api/*` | za stejným přihlášením jako správa |
| Rozcestník | `/` | kdokoli — žádná data, jen jestli aplikace žije |

Osobní přehled je **read-only** a ukazuje jen čísla té jedné osoby plus souhrn za dům.

## Konfigurace

Tajemství nikdy do gitu — zkopíruj `.dev.vars.example` na `.dev.vars` a vyplň lokálně.
Provozní nastavení (prahy, délka období, texty do QR, věty pro členy) se **needituje v kódu**,
ale v aplikaci v Nastavení.

| Proměnná | K čemu |
|---|---|
| `FIO_TOKEN` | read-only token k Fio API pro sondu; v provozu se token ukládá v Nastavení |
| `DEV_ADMIN` | únik do správy jen pro lokální vývoj, platí pouze na localhostu |

## Spuštění

```powershell
npm install
npm run dev        # lokální vývoj (wrangler dev)
npm run typecheck  # tsc --noEmit
npm run probe      # sonda do Fio API, jen čte
npm run deploy     # nasazení (ručně, žádné CI)
```

## Dokumentace

| Dokument | Obsah |
|---|---|
| [docs/STAV.md](docs/STAV.md) · [STATUS.en.md](docs/STATUS.en.md) | co funguje, co ne, kudy dál |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [en](docs/ARCHITECTURE.en.md) | jak je to poskládané, pravidla párování, datový model |
| [docs/MAPA.md](docs/MAPA.md) · [en](docs/MAP.en.md) | myšlenková mapa a vývojové diagramy |
| [docs/prezentace.html](docs/prezentace.html) · [en](docs/presentation.en.html) | grafická prezentace toku informací |
| [docs/manazerske-shrnuti.html](docs/manazerske-shrnuti.html) · [en](docs/management-summary.en.html) | shrnutí na jednu A4 pro vedení |
| [docs/BUILD.md](docs/BUILD.md) · [en](docs/BUILD.en.md) | jak to postavit od nuly |
| [HANDOFF.md](HANDOFF.md) | deník stavu — proč se co rozhodlo |

Dokumentace v samotné aplikaci: `/admin/dokumentace` (česky), `/admin/documentation` (anglicky).
