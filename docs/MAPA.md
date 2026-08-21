# Myšlenková mapa a vývojové diagramy — FIO-uhrady

> Jak spolu věci souvisí a v jakém pořadí se dějí.
> Anglicky: [MAP.en.md](MAP.en.md) · vykreslené v prohlížeči: [prezentace.html](prezentace.html)

## 1. Myšlenková mapa — z čeho se systém skládá

```mermaid
mindmap
  root((FIO-uhrady))
    Náklady domu
      Položka
        pravidelná / jednorázová
        rozpouštění nákupu
        kdo ji zaplatil
      Podíly na osoby
        procentem
        pevnou částkou
      Kategorie
    Lidé
      Osoba
        variabilní symbol
        číslo účtu
        posílá na účet?
      Podíl nese někdo jiný
      Rod pro oslovení
    Peníze z banky
      Fio API periods/
      Dedup podle ID pohybu
      Párování
        VS
        komentář u pohybu
        zpráva pro příjemce
        ručně
      Za který měsíc platba je
    Zálohy
      Fixní částka
      Historie se nepřepisuje
      Návrh počítá appka
      Stanoví admin
    Čas
      Měsíční uzávěrka
        zamrazí náklady a podíly
        automaticky po splatnosti
      Vyúčtování období
        rozdíl do zálohy
        nebo k doplacení
        posune počátek sledování
    Výstupy
      Přehled pro správce
      Osobní odkaz pro člena
        průběžný zůstatek
        QR platba
      Export CSV
      Audit
```

## 2. Tok informací — odkud kam tečou data

```mermaid
flowchart LR
  subgraph Vstupy
    FIO[("Fio banka<br/>REST API")]
    ADMIN["Správce<br/>zadává náklady"]
  end

  subgraph Worker["Cloudflare Worker"]
    SYNC["Stažení pohybů<br/>periods/ + dedup"]
    MATCH["Párování<br/>VS → komentář → ručně"]
    CALC["Výpočet nákladů<br/>rozpad na osoby"]
    AUTO["Automat<br/>uzávěrky a vyúčtování"]
  end

  DB[("Cloudflare D1<br/>náklady, platby,<br/>zálohy, uzávěrky")]

  subgraph Výstupy
    SPRAVA["Správa /admin<br/>za přihlášením"]
    CLEN["Osobní odkaz /v/token<br/>bez přihlášení"]
    CSV["Export CSV"]
  end

  FIO -->|"každých 15 min"| SYNC
  SYNC --> MATCH
  MATCH --> DB
  ADMIN --> CALC
  CALC --> DB
  DB --> AUTO
  AUTO --> DB
  DB --> SPRAVA
  DB --> CLEN
  DB --> CSV
  SPRAVA -.->|"ruční opravy"| DB
```

## 3. Životní cyklus měsíce — co se kdy stane

```mermaid
flowchart TD
  START([Začátek měsíce]) --> NAKLADY["Náklady běží<br/>položky se počítají<br/>z aktuálního nastavení"]
  NAKLADY --> PLATBA{"Přišla platba?"}
  PLATBA -->|ano| PRIRAD["Přiřadí se osobě<br/>a měsíci"]
  PLATBA -->|ne| CEKA["Čeká se"]
  PRIRAD --> SPLATNOST
  CEKA --> SPLATNOST

  SPLATNOST{"Den splatnosti<br/>tohoto měsíce?"}
  SPLATNOST -->|ne| NAKLADY
  SPLATNOST -->|ano| DLUH["Měsíc vstupuje do dluhu<br/>zbývá = záloha − přišlo"]

  DLUH --> ZAVRIT{"Den splatnosti<br/>měsíce NÁSLEDUJÍCÍHO?"}
  ZAVRIT -->|ne| DOZNI["Doznívají opožděné platby"]
  DOZNI --> ZAVRIT
  ZAVRIT -->|ano| UZAVERKA["UZÁVĚRKA<br/>zamrazí náklady, podíly, zálohy"]

  UZAVERKA --> OBDOBI{"Je uzavřených<br/>12 měsíců v řadě?"}
  OBDOBI -->|ne| KONEC([Čeká se na další měsíc])
  OBDOBI -->|ano| VYUCTOVANI["VYÚČTOVÁNÍ<br/>skutečnost − zaplaceno"]

  VYUCTOVANI --> ROZDIL{"Nedoplatek<br/>nad práh?"}
  ROZDIL -->|ne| ZALOHA["Rozdíl se rozpustí<br/>do nové zálohy"]
  ROZDIL -->|ano| DOPLATEK["Zůstane k doplacení<br/>mimo zálohu"]
  ZALOHA --> POSUN
  DOPLATEK --> POSUN
  POSUN["Počátek sledování se posune<br/>za konec období"] --> KONEC
```

## 4. Jak se pozná, komu platba patří

```mermaid
flowchart TD
  P([Pohyb z Fio]) --> VS{"Sedí VS<br/>na evidovanou osobu?"}
  VS -->|ano| HOTOVO["Přiřazeno — podle VS"]
  VS -->|ne| UCET{"Sedí číslo<br/>protiúčtu?"}
  UCET -->|ano| HOTOVO2["Přiřazeno — podle účtu"]
  UCET -->|ne| KOMENTAR{"Je v komentáři<br/>u pohybu známý VS?"}
  KOMENTAR -->|ano| HOTOVO3["Přiřazeno — z komentáře"]
  KOMENTAR -->|ne| ZPRAVA{"Je ve zprávě<br/>pro příjemce?"}
  ZPRAVA -->|ano| HOTOVO4["Přiřazeno — ze zprávy"]
  ZPRAVA -->|ne| IDENT{"V uživatelské<br/>identifikaci?"}
  IDENT -->|ano| HOTOVO5["Přiřazeno — z identifikace"]
  IDENT -->|ne| RUCNE["Zůstane nepřiřazené<br/>čeká na správce"]
  RUCNE -->|"správce vybere osobu"| ZAMEK["Přiřazeno ručně<br/>automat to už nepřepíše"]
```

**Z textových polí se berou jen čísla, která odpovídají některému evidovanému
VS** — jinak by se do párování chytala náhodná čísla z poznámek (datum, částka,
číslo faktury protistrany).

## 5. Vrstvy kódu

```mermaid
flowchart TD
  IDX["index.ts<br/>cesty, přihlášení, cron"]
  IDX --> DB["db.ts<br/>vrstva nad D1 + audit"]
  IDX --> STRANKY["stránky<br/>admin-page, settings-page,<br/>payments-page, closings-page,<br/>settlement-page, member-page,<br/>more-pages, docs-page"]
  IDX --> SYNC["sync.ts + fio.ts<br/>banka"]
  IDX --> AUTO["automat.ts<br/>uzávěrky a vyúčtování"]
  STRANKY --> UI["ui.ts<br/>společný shell"]
  STRANKY --> MONEY["money.ts<br/>haléře, periody, rozpad"]
  STRANKY --> TEXTY["texty.ts<br/>editovatelné věty"]
  DB --> MODEL["model.ts<br/>tvar dat"]
  AUTO --> DB
  SYNC --> DB
```
