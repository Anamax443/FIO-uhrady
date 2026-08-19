# Architektura — FIO-uhrady

## Přehled

Jeden Cloudflare Worker obsluhuje tři věci: cron stahování pohybů z Fio, admin rozhraní za Cloudflare Access a veřejný read-only přehled na odkazu s tokenem. Data leží v D1. Žádný další server, žádná služba navíc.

## Komponenty

- **Fio sync (cron)** — á 15 minut natáhne pohyby z Fio REST API za posunuté okno a uloží nové do `payments`.
- **Matcher** — přiřazuje platby k předpisům podle VS a záložních polí; u každého párování zaznamená, jak vzniklo.
- **Admin (`/admin/*`)** — plátci, předpisy (paušál + jednorázové), fronta nespárovaných plateb, nastavení. Za Cloudflare Access = 2FA řeší Cloudflare, v kódu žádná hesla.
- **Přehled (`/v/{token}`)** — souhrn uhrazeno / dlužno, graf vývoje v čase, výpis úhrad, export CSV + tisková verze. Jen čtení.

## Datový tok

1. Cron zavolá `GET https://fioapi.fio.cz/v1/rest/periods/{token}/{od}/{do}/transactions.json`.
2. Každý pohyb se uloží do `payments` s primárním klíčem = **ID pohybu z Fio** (`column22`) → opakované stažení stejného období nic nezduplikuje.
3. Matcher vezme nespárované příchozí platby a hledá VS (viz níže) → plátce.
4. Částka se rozpouští na **nejstarší neuhrazené předpisy** daného plátce (FIFO); přeplatek zůstává jako kredit.
5. Přehled počítá `dlužno = součet předpisů − součet přiřazených úhrad`.

### Proč `periods/` a ne `last/`

Fio nabízí i endpoint `last/{token}/transactions.json`, který si drží kurzor na straně banky. **Nepoužíváme ho.** Kurzor se posune i tehdy, když nám selže zápis do D1 nebo Worker spadne mezi stažením a uložením — pohyby se pak už nikdy znovu nestáhnou a tiše chybí. Místo toho stahujeme pevné období s překryvem (default 14 dní zpět) a spoléháme na dedup podle ID pohybu. Stahování je tím idempotentní a kdykoli přehratelné.

Fio API má limit **1 dotaz za 30 sekund** na token — cron á 15 minut se do něj vejde s rezervou, ale žádné smyčky přes více období v jednom běhu bez rozestupu.

## Pravidla párování

Hledá se VS v tomto pořadí; první nález vyhrává a zapíše se do `matches.matched_by`:

| Pořadí | Zdroj | Pole Fio | Kdo to vyplňuje |
|---|---|---|---|
| 1 | Variabilní symbol | `column5` | plátce v příkazu |
| 2 | Komentář | `column25` | **vlastník účtu** dodatečně v internetbankingu Fio |
| 3 | Zpráva pro příjemce | `column16` | plátce |
| 4 | Uživatelská identifikace | `column7` | plátce / banka |
| 5 | Ruční přiřazení | — | admin ve frontě nespárovaných |

Z textových polí (2–4) se **neberou libovolná čísla**. Vytáhnou se číselné kandidáty a použije se jen ten, který odpovídá některému **evidovanému VS** z registru plátců. Jinak by se do párování dostala náhodná čísla z textu (datum, částka, číslo faktury cizí strany).

Každé párování nese `matched_by` + `matched_value` + čas. V přehledu i v adminu je proto vidět *„spárováno z komentáře: 240137"*, ne jen tichá změna čísla. Ruční přiřazení se od automatického vizuálně liší.

## Datový model (návrh)

- `payers` — plátce: interní označení (pseudonym), reálné jméno, jeho VS
- `plans` — paušál: plátce, částka, den splatnosti, platnost od/do
- `charges` — předpis: plátce, období, částka, splatnost, titul, původ (paušál / jednorázový)
- `payments` — pohyb z Fio: `fio_id` (PK), datum, částka, měna, VS/KS/SS, protiúčet a jeho název, `column16`, `column25`, `column7`, syrový JSON
- `allocations` — přiřazení částky platby na konkrétní předpis (platba může pokrýt víc předpisů i jen část jednoho)
- `settings` — `view_token`, `show_real_names`, okno stahování, …
- `sync_runs` — deník běhů: kdy, za jaké období, kolik nových, kolik spárovaných, případná chyba

## Zobrazování jmen

Default = **pseudonymy / VS**. Reálná jména jde zapnout přepínačem v nastavení (`show_real_names`). Přehled je na odkazu, který se dá poslat dál — proto se jména nezapínají samovolně.

## Externí závislosti

- **Fio REST API** — `fioapi.fio.cz`, read-only token, limit 1 dotaz / 30 s
- **Cloudflare** — Workers, D1, Cron Triggers, Access (účet `bass443`)
