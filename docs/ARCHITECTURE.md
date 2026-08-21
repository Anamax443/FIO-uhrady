# Architektura — FIO-uhrady

> Anglicky: [ARCHITECTURE.en.md](ARCHITECTURE.en.md) · aktuální stav: [STAV.md](STAV.md) ·
> diagramy: [MAPA.md](MAPA.md), [prezentace.html](prezentace.html)

## Přehled

Jeden Cloudflare Worker obsluhuje čtyři věci: cron stahování pohybů z Fio, automatické
uzávěrky a vyúčtování, správu za přihlášením a veřejný read-only přehled na odkazu
s tokenem. Data leží v D1. Žádný další server, žádná služba navíc.

## Komponenty

- **Fio sync (cron)** — á 15 minut natáhne pohyby z Fio REST API za posunuté okno a uloží nové do `payments`.
- **Matcher** (`fio.ts`) — přiřazuje platby k osobám podle VS a záložních polí; u každého párování zaznamená, jak vzniklo.
- **Automat** (`automat.ts`) — zavírá měsíce a vyúčtovává období bez zásahu obsluhy.
- **Správa (`/admin/*`)** — náklady, osoby, platby, zálohy, uzávěrky, vyúčtování, nastavení.
  Cloudflare Access má přednost; záložní přihlášení je PIN (v kódu žádná hesla, jen otisk PBKDF2).
- **Osobní přehled (`/v/{token}`)** — průběžný zůstatek, měsíc po měsíci, QR platba,
  náklady domu na rok. Jen čtení a jen svoje čísla.

## Datový tok

1. Cron zavolá `GET https://fioapi.fio.cz/v1/rest/periods/{token}/{od}/{do}/transactions.json`.
2. Každý pohyb se uloží do `payments` s primárním klíčem = **ID pohybu z Fio** (`column22`) → opakované stažení stejného období nic nezduplikuje.
3. Matcher hledá u nepřiřazených plateb VS (viz níže) → osoba. Platba dostane i `obdobi`,
   tedy měsíc, **za který** je — předvyplní se z data a admin ho může přepsat.
4. Náklady se rozpadají na osoby per položka (procentem nebo pevnou částkou), měsíc po měsíci.
5. `zbývá = záloha za splatné měsíce + zůstatek z vyúčtování − co přišlo`. Dluh se
   **přenáší z měsíce na měsíc**, není vázaný na konkrétní měsíc.
6. Uzávěrka zamrazí měsíc, vyúčtování uzavře období a posune `settings.vyuctovani_od`.

## Automatika

| Kdy | Co se stane | Pojistka |
|---|---|---|
| Den splatnosti **následujícího** měsíce | Uzavře se měsíc — zamrazí náklady, podíly, zálohy, soupis položek | Hotový měsíc se nikdy nezavírá znovu |
| Uzavřeno `vyuctovani_mesicu` (výchozí 12) měsíců v řadě | Vyúčtuje se období | Hotové vyúčtování se nepřepisuje |

Měsíc navíc před uzávěrkou je schválně: platba poslaná na poslední chvíli se připíše až za
pár dní a bez té rezervy by uzávěrka zamrazila díru, která žádná není. Obojí jde vypnout
v Nastavení a obojí jde zrušit a udělat ručně; v auditu je automat podepsaný jako
`automat (cron)`, takže je poznat, co dělal člověk.

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

## Datový model

Zadání se od prvního návrhu posunulo: appka neeviduje předpisy, ale **náklady domu**
a **zálohy** na ně (viz HANDOFF.md). Tabulky ve schématu:

- `members` — osoba: jméno, VS, číslo účtu, `je_platce` (chodí od ní příspěvek na účet), `pod_member_id` (za koho nese závazek někdo jiný), `view_token`
- `cost_items` — položka nákladů: částka za období, perioda, druh, datum, rozpouštění (`rozpustit_od`, `rozpustit_mesicu`), `zdroj_uhrady` (účet × ze svého)
- `cost_shares` — podíl osoby na položce, procentem nebo pevnou částkou
- `zalohy` — historie záloh: osoba, částka, platnost od; **nepřepisuje se**, aby zpětný výpočet seděl
- `uzaverky`, `uzaverka_podily`, `uzaverka_polozky` — zamražený měsíc: náklady, podíly, zálohy, soupis položek
- `vyuctovani`, `vyuctovani_radky` — uzavřené období: předepsáno / zaplaceno / skutečnost, jak se rozdíl vypořádal a co zbylo mimo zálohu
- `payments` — pohyb z Fio: `fio_id` (PK), datum, částka, měna, VS/KS/SS, protiúčet a jeho název, `column16`, `column25`, `column7`, syrový JSON, přiřazená osoba a čím se poznala
- `settings` — `vyuctovani_od` (počátek běžícího období), `den_splatnosti`, `rezerva_procent`, `prah_doplatku`, okno stahování, token do Fio, …
- `audit_log` — kdo, kdy, co změnil a z čeho na co; zapisuje se ve stejné dávce jako změna
- `sync_runs` — deník běhů: kdy, za jaké období, kolik nových, kolik spárovaných, případná chyba

`vyuctovani_od` je klíčové pro správnost: uložením vyúčtování se posune za konec období,
takže se jednou zúčtované peníze v dalším období nepočítají znovu.

## Co je konfigurace, ne kód

Cokoli, co se může časem změnit, patří do `settings` a jde nastavit v aplikaci —
prahy, délky období, texty. V kódu zůstává jen **výchozí hodnota**, aby appka běžela
i bez nastavení a migrace nebyla povinná.

| Klíč | K čemu |
|---|---|
| `vyuctovani_od` | počátek běžícího období; vyúčtování ho posouvá |
| `den_splatnosti` | kolikátého je příspěvek splatný (1–28) |
| `rezerva_procent` | rezerva v návrhu zálohy na neplánované nákupy |
| `prah_doplatku` | nad tuhle výši se nedoplatek do zálohy sám nerozpouští |
| `auto_uzaverka`, `auto_vyuctovani` | bezobslužný provoz zapnutý/vypnutý |
| `vyuctovani_mesicu` | délka vyúčtovacího období |
| `qr_prijemce`, `qr_zprava` | co jde do QR platby; prázdné = nedávat tam nic |
| `text_*` | věty na osobním přehledu (definice v `src/texty.ts`) |
| `fio_token` | token do banky; z databáze se do UI nikdy nevrací celý |

## Zobrazování jmen a oslovení

Přehled je na odkazu, který se dá poslat dál, takže se na něm ukazují jen **vlastní čísla**
té osoby a souhrn za dům. Rod pro oslovení je **údaj u osoby**, ne odhad z jména —
nevyplněný znamená, že appka mluví neutrálně.

## Kontroly, které se vyplatí dělat

- `npm run typecheck` — tsc bez emitu.
- **Syntax generovaných skriptů**: stránky skládají JavaScript do řetězce, takže
  duplicitní `const` shodí celý skript stránky, ne jen jednu funkci. Vytáhnout
  `<script>` ze stránky a pustit `node --check`.
- **Součty po filtrování** se počítají v prohlížeči; musí vyjít stejně jako serverové.

## Externí závislosti

- **Fio REST API** — `fioapi.fio.cz`, read-only token, limit 1 dotaz / 30 s.
  Vrací i **HTTP 500** při výpadku na jejich straně; není to chyba tokenu.
- **Cloudflare** — Workers, D1, Cron Triggers, Access (účet `bass443`).
  `d1 execute --remote --file` na tomhle účtu končí na `Authentication error 10000`
  — migrace se pouštějí po jednotlivých `--command`.
