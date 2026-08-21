# STAV — FIO-uhrady

> Kde to stojí **dnes**. Historie a rozhodnutí jsou v [HANDOFF.md](../HANDOFF.md),
> tenhle dokument se přepisuje. Anglicky: [STATUS.en.md](STATUS.en.md).

**Stav k 2026-08-21 · živě `ZIVY_HASH` · <https://fio-uhrady.bass443.workers.dev>**

## K čemu to je

Kalkulace nákladů domácnosti a rozpad na jednotlivé členy. **Není to nájem** —
je to podíl na tom, co dům stojí. Příspěvky se platí fixní zálohou na trvalý
příkaz, aplikace je páruje s pohyby na účtu u Fio banky a jednou za období
srovná zálohy se skutečností.

## Co funguje

| Oblast | Stav | Poznámka |
|---|---|---|
| Náklady domu | ✅ | položky, rozpad na osoby, kategorie, řazení a filtry se součty |
| Osoby a identifikace | ✅ | VS, číslo účtu, kdo za koho nese podíl, rod pro oslovení |
| Stahování z Fio | ✅ | `periods/` s překryvem, dedup podle ID pohybu, každý běh v logu |
| Párování plateb | ✅ | VS → komentář → zpráva → identifikace → ruční; vždy je vidět čím |
| Přiřazení platby k měsíci | ✅ | předvyplní se z data, admin může přepsat |
| Zálohy | ✅ | historie se nepřepisuje, návrh počítá appka, stanoví admin |
| Měsíční uzávěrky | ✅ | zamrazí, co v měsíci platilo; **automaticky** po splatnosti dalšího měsíce |
| Vyúčtování období | ✅ | rozdíl do zálohy nebo k doplacení; **automaticky** po naplnění období |
| Osobní přehled pro člena | ✅ | `/v/{token}`, průběžný zůstatek, QR platba, texty z Nastavení |
| Audit a historie změn | ✅ | žádný zápis bez záznamu; vlastní stránka se starou → novou hodnotou |
| AI vrstva | ✅ | přepínatelný backend, klíč ke Claude se vkládá v Nastavení; při selhání placeného zaskočí free |
| Dotazy pro AI | ✅ | okno na Nákladech domu; čísla počítá appka, věta s cizím číslem se označí ⚠ |
| Přihlášení | ✅ | PIN (PBKDF2 + zámek po chybách); Cloudflare Access má přednost |

## Co ještě není

| Chybí | Proč to není blokující |
|---|---|
| **AI — čtení účtenek** | vrstva, komentář i dotazy hotové; zbývá jen OCR účtenek |
| **E-maily (Resend)** | vyúčtování se dnes ukazuje v appce a na osobním odkazu |
| **Import CSV** | export funguje, import zatím nikdo nepotřeboval |
| **Cloudflare Access místo PINu** | PIN je funkční záloha, Access je hotový plán |
| **Překlad celé správy do angličtiny** | dokumentace anglicky je, UI zatím jen česky |

## Čísla

- **12 migrací** schématu (`schema/0001` … `0012`), všechny nasazené v ostré databázi
- **25 modulů** v `src/`, typecheck bez chyb
- Nasazení **ručně** (`npm run deploy`), žádné CI; cron každých 15 minut

## Zádrhely, na které narazí každý

1. **`d1 execute --remote --file` neprojde** — Cloudflare vrací
   `Authentication error [code: 10000]`. Migrace se pouštějí **po jednotlivých
   `--command`**. Kvůli tomu jednou v produkci neproběhla celá migrace a appka
   padala na chybějícím sloupci.
2. **`osobaPodleTokenu` má vlastní seznam sloupců.** Nový sloupec je potřeba
   doplnit i tam, jinak o něm osobní přehled neví a tváří se, že je prázdný.
3. **Duplicitní `const` v generovaném skriptu shodí celou stránku.** Stránky
   skládají JavaScript do řetězce; kolize jména proto neshodí jen tu funkci,
   ale všechno. Kontrola: vytáhnout `<script>` ze stránky a pustit `node --check`.
4. **`element.hidden = true` neschová prvek, který má v CSS `display`.** Vlastní
   pravidlo přebije `[hidden]` z prohlížeče a schovaná hláška zůstane viset i s textem,
   který už neplatí. Ke každé takové třídě patří i `.trida[hidden] { display: none }`.
5. **Workers AI nejde vyzkoušet v `wrangler dev` lokálně** („Binding AI needs to be run
   remotely"). Na zkoušku dočasně `"ai": { "binding": "AI", "experimental_remote": true }`
   a pak vrátit zpátky.
6. **Fio API vrací i HTTP 500**, když je na jejich straně výpadek. Není to
   chyba tokenu; `periods/` se stahuje za celé období, takže další běh výpadek dožene.

## Kudy dál

1. **Čtení účtenek** — z fotky rovnou položka; AI vrstva už na to je připravená.
2. **E-maily** přes Resend — vyúčtování na e-mail členům.
3. **Cloudflare Access** místo PINu.
4. **Import CSV** zpátky do aplikace.
