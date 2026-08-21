# Mind map and flow charts — FIO-uhrady

> How the pieces relate and in what order things happen.
> Czech original: [MAPA.md](MAPA.md) · rendered in a browser:
> [presentation.en.html](presentation.en.html)

## 1. Mind map — what the system is made of

```mermaid
mindmap
  root((FIO-uhrady))
    House costs
      Cost item
        recurring / one-off
        spreading a purchase
        who paid for it
      Shares per person
        by percentage
        by fixed amount
      Categories
    People
      Person
        variable symbol
        account number
        pays into the account?
      Share carried by someone else
      Grammatical gender
    Money from the bank
      Fio API periods/
      Dedup by transaction id
      Matching
        variable symbol
        comment on the transaction
        message for the recipient
        manual
      Which month a payment is for
    Advances
      Fixed amount
      History is never rewritten
      App proposes
      Admin decides
    Time
      Monthly closing
        freezes costs and shares
        automatic once due
      Period settlement
        difference into the advance
        or left to pay
        moves the tracking start
    Outputs
      Administrator's overview
      Member's personal link
        running balance
        QR payment
      CSV export
      Audit trail
```

## 2. Information flow — where the data comes from and goes

```mermaid
flowchart LR
  subgraph Inputs
    FIO[("Fio bank<br/>REST API")]
    ADMIN["Administrator<br/>enters costs"]
  end

  subgraph Worker["Cloudflare Worker"]
    SYNC["Download transactions<br/>periods/ + dedup"]
    MATCH["Matching<br/>VS → comment → manual"]
    CALC["Cost calculation<br/>split per person"]
    AUTO["Automation<br/>closings and settlement"]
  end

  DB[("Cloudflare D1<br/>costs, payments,<br/>advances, closings")]

  subgraph Outputs
    SPRAVA["Admin /admin<br/>behind sign-in"]
    CLEN["Personal link /v/token<br/>no sign-in"]
    CSV["CSV export"]
  end

  FIO -->|"every 15 min"| SYNC
  SYNC --> MATCH
  MATCH --> DB
  ADMIN --> CALC
  CALC --> DB
  DB --> AUTO
  AUTO --> DB
  DB --> SPRAVA
  DB --> CLEN
  DB --> CSV
  SPRAVA -.->|"manual corrections"| DB
```

## 3. Life cycle of a month

```mermaid
flowchart TD
  START([Month begins]) --> NAKLADY["Costs accrue<br/>items calculated from<br/>current settings"]
  NAKLADY --> PLATBA{"Payment arrived?"}
  PLATBA -->|yes| PRIRAD["Assigned to a person<br/>and a month"]
  PLATBA -->|no| CEKA["Waiting"]
  PRIRAD --> SPLATNOST
  CEKA --> SPLATNOST

  SPLATNOST{"Due date of<br/>this month?"}
  SPLATNOST -->|no| NAKLADY
  SPLATNOST -->|yes| DLUH["Month enters the balance<br/>owed = advance − received"]

  DLUH --> ZAVRIT{"Due date of the<br/>NEXT month?"}
  ZAVRIT -->|no| DOZNI["Late payments still landing"]
  DOZNI --> ZAVRIT
  ZAVRIT -->|yes| UZAVERKA["CLOSING<br/>freezes costs, shares, advances"]

  UZAVERKA --> OBDOBI{"12 consecutive<br/>months closed?"}
  OBDOBI -->|no| KONEC([Wait for the next month])
  OBDOBI -->|yes| VYUCTOVANI["SETTLEMENT<br/>actual − paid"]

  VYUCTOVANI --> ROZDIL{"Shortfall above<br/>the threshold?"}
  ROZDIL -->|no| ZALOHA["Difference folded<br/>into the new advance"]
  ROZDIL -->|yes| DOPLATEK["Left to pay<br/>outside the advance"]
  ZALOHA --> POSUN
  DOPLATEK --> POSUN
  POSUN["Tracking start moves<br/>past the end of the period"] --> KONEC
```

## 4. Working out whose payment it is

```mermaid
flowchart TD
  P([Transaction from Fio]) --> VS{"Variable symbol matches<br/>a known person?"}
  VS -->|yes| HOTOVO["Matched — by VS"]
  VS -->|no| UCET{"Counterparty account<br/>matches?"}
  UCET -->|yes| HOTOVO2["Matched — by account"]
  UCET -->|no| KOMENTAR{"Known VS in the<br/>transaction comment?"}
  KOMENTAR -->|yes| HOTOVO3["Matched — from the comment"]
  KOMENTAR -->|no| ZPRAVA{"In the message<br/>for the recipient?"}
  ZPRAVA -->|yes| HOTOVO4["Matched — from the message"]
  ZPRAVA -->|no| IDENT{"In the payer's<br/>identification?"}
  IDENT -->|yes| HOTOVO5["Matched — from identification"]
  IDENT -->|no| RUCNE["Stays unmatched<br/>waiting for the administrator"]
  RUCNE -->|"administrator picks a person"| ZAMEK["Matched manually<br/>automation will not overwrite it"]
```

**Only numbers that match a registered variable symbol are taken from free-text
fields** — otherwise matching would latch onto random numbers in notes (a date,
an amount, the counterparty's invoice number).

## 5. Code layers

```mermaid
flowchart TD
  IDX["index.ts<br/>routes, sign-in, cron"]
  IDX --> DB["db.ts<br/>layer over D1 + audit"]
  IDX --> STRANKY["pages<br/>admin-page, settings-page,<br/>payments-page, closings-page,<br/>settlement-page, member-page,<br/>more-pages, docs-page"]
  IDX --> SYNC["sync.ts + fio.ts<br/>the bank"]
  IDX --> AUTO["automat.ts<br/>closings and settlement"]
  STRANKY --> UI["ui.ts<br/>shared shell"]
  STRANKY --> MONEY["money.ts<br/>hellers, periods, splitting"]
  STRANKY --> TEXTY["texty.ts<br/>editable wording"]
  DB --> MODEL["model.ts<br/>shape of the data"]
  AUTO --> DB
  SYNC --> DB
```
