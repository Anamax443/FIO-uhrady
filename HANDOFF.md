# HANDOFF — deník stavu: FIO-uhrady

Append-only. Nejnovější záznam nahoru. Slouží k pokračování z jiného počítače / po pauze.

## 2026-08-20 — nasazení: chybějící migrace a neviditelný odkaz

Při nasazování vyplavaly dvě věci, obě starší než dnešek:

**`d1 execute --remote --file` neprojde** — Cloudflare vrací `Authentication error
[code: 10000]`, protože `--file` jde přes *import* endpoint a ten OAuth token
wranglera odmítá. **Funguje `--command`.** Kvůli tomu nikdy neproběhla ani
migrace **0008** (`members.view_token`), takže „Vytvořit odkaz" v ostré databázi
padalo od začátku. Doplněno po jednotlivých příkazech; schéma je teď kompletní
(0001–0009 ověřeno proti `sqlite_master` a `pragma_table_info`).

**`nactiOsoby` nevybíralo `view_token`**, takže Nastavení nepoznalo, že osoba
odkaz už má: klik odkaz vytvořil, stránka se načetla a vypadala stejně —
zvenčí to působilo, že tlačítko nereaguje. Opraveno; ověřeno lokálně, že se
vytvoření i zrušení hned projeví.

**Poznámka pro příště:** hláška *„Uložení se nepovedlo, zkus to prosím znovu"*
schovala chybu schématu a poslala hledat úplně jinam. Přihlášenému adminovi
by měla ukázat skutečnou příčinu (`no such column: view_token`). Neopraveno.

## 2026-08-20 — vyúčtování období (bod 4 z dohodnutého pořadí)

Kruh se uzavřel: záloha × skutečnost se teď dá **srovnat a rozdíl rozpustit
do nové zálohy**, aby trvalý příkaz mohl zůstat fixní.

**Nová stránka `/admin/vyuctovani`** (`src/settlement-page.ts`):
- Vyúčtovat jde jen **uzavřené a navazující** měsíce od počátku sledování —
  z otevřeného měsíce se počítá dnešními čísly a vyúčtování by se zpětně měnilo.
  Konec období si admin vybere ze seznamu.
- U každého: předepsané zálohy / skutečně zaplaceno / skutečný podíl → rozdíl.
- **Rozpustit do zálohy** (rozdíl / 12 k nové záloze) × **doplatit jednorázově**.
  Nedoplatek nad `prah_doplatku` appka sama rozpustit nenavrhne, radši se zeptá.
  Částku zálohy jde přepsat ručně — appka ji nikdy nestanoví sama.
- Uložení jde **jednou dávkou**: zamražené řádky + nové zálohy od dalšího měsíce
  + posun `vyuctovani_od` + audit. Čísla se počítají znovu na serveru, z prohlížeče
  se berou jen rozhodnutí.
- Zrušit jde **jen poslední** vyúčtování (starší by se nedalo vrátit, aniž by se
  novější počítalo dvakrát); sledování se vrátí na začátek období, zálohy zůstanou.

**Dvě věci, které by jinak tiše lhaly:**
1. **Platby se berou za období** (`zaplacenoOsobami` má okno). Bez toho by se peníze
   zúčtované v minulém období odečítaly od dluhu i v tom dalším — donekonečna.
2. **Vklad ze svého se počítá po měsících**, ne celou částkou (`vlozenoZeSveho`).
   Uhlí za 42 000 se rozpouští po 3 500, takže se dědovi po 3 500 i připisuje;
   jinak by v měsíci nákupu skočil do obřího přeplatku.

**Komu se co eviduje:** u toho, od koho příspěvky na účet nechodí, se **dluh
nesleduje** (drží se dřívější rozhodnutí — narůstající číslo by nic neznamenalo).
Peníze, které do domácnosti opravdu dal, se ale zapsat musí, takže se u něj
ukládá jen **záporný** zůstatek = pohledávka. Ve Vyrovnání i na osobním přehledu
je zůstatek z vyúčtování vidět zvlášť, mimo zálohu.

**Ověřeno lokálně** proti místní D1 s daty (`wrangler dev`, DEV_ADMIN):
uzavřeno 2026-01 – 2026-08, vyúčtováno oběma způsoby a zrušeno.
- Rozpuštění: Lucka předepsáno 48 700, zaplaceno 42 200, skutečnost 45 851 →
  nedoplatek 3 651; záloha 6 900 (ze samotných nákladů) → 7 200 s rozdílem. Sedí ručnímu propočtu.
- Jednorázově: zůstatek 3 651 se objevil ve Vyrovnání i na `/v/{token}` včetně QR.
- Pohledávka: nákup 30 000 dědou ze svého → −25 678 zapsáno, „má k dobru" ve Vyrovnání.
- Zrušení vrátilo `vyuctovani_od` zpátky. Všech 11 stránek adminu 200, typecheck OK.

**Opraveno při testu:** vyúčtování zakládalo nulovou zálohu i tomu, kdo žádnou
neplatí — v historii záloh by ta nula přebila starší platnou částku.

**Nasazení — dělá uživatel:**
```powershell
npx wrangler d1 execute fio-uhrady --remote --file schema/0009_vyuctovani.sql
npm run deploy
```

**Zbývá:** AI (6) — čtení účtenek a komentář k vývoji, dál e-maily přes Resend,
import CSV a Cloudflare Access místo PINu.

## 2026-08-20 — zálohy, rozpouštění, uzávěrky a osobní přehled

Zadání se upřesnilo do modelu **záloh a vyúčtování** (jako u energií):
fixní částka na trvalý příkaz, rozdíl proti skutečnosti se srovná při
vyúčtování a rozpustí do nové zálohy, aby příkaz mohl zůstat fixní.
Dohodnuté pořadí prací: rozpouštění → zálohy → uzávěrky → roční vyúčtování →
stránka pro člena → AI.

**Hotovo (1, 2, 3, 5):**
- **Rozpouštění** — nákup není spotřeba. U položky se zadá, přes kolik měsíců
  a od kterého se rozpouští (uhlí 42 000 / 12 = 3 500 měsíčně). Mimo své okno
  položka do nákladů nevstupuje a po doběhnutí zmizí sama.
- **Kdo zaplatil ze svého** (`zdroj_uhrady`) — komu se částka připíše jako vklad.
  Bez tohoto rozlišení by se náklad počítal dvakrát: jako výdaj i jako vklad.
- **Zálohy** (`zalohy`) — fixní měsíční částka, historie se nepřepisuje.
  Dluh = záloha × měsíce po splatnosti − zaplaceno. Návrh počítá appka
  (odhad na 12 měsíců + rezerva, výchozí 10 %, nahoru na stovky), **stanoví admin**.
- **Splatnost** — měsíc se do dluhu započítá až dnem splatnosti (výchozí 20.).
- **Uzávěrky** (`uzaverky`) — zamrazí náklady, podíly, zálohy i soupis položek.
  Uzavřený měsíc se z aktuálního nastavení nepřepočítává.
- **Osobní přehled** `/v/{token}` — mobilní, veřejný na neuhodnutelném odkazu,
  který se vytvoří v Nastavení u kterékoli osoby. Zbývá doplatit velkým písmem,
  **QR platba (SPAYD)**, graf podílu po měsících, vlastní platby, náklady domu
  na rok po kategoriích a **položky s vlastním podílem**. O ostatních nic.
- **Číslo účtu, IBAN a zůstatek** si appka bere z Fio API, neopisuje se ručně.

**Chyby nalezené a opravené při testování** (všechny by tiše zkreslovaly čísla):
1. Jednorázové položky se při součtu přes víc měsíců počítaly do každého měsíce.
2. Stránka Vyrovnání nedostávala uzávěrky, takže zamrazení nefungovalo.
3. Kategorie ročních nákladů nesouhlasily s celkem (jednorázové × 12).
4. Uložení beze změny zapisovalo nový záznam do historie.

**Zbývá:** roční vyúčtování (4) a rozpuštění rozdílu do nové zálohy, **AI** (6)
— čtení účtenek a komentář k vývoji, dál e-maily přes Resend, import CSV
a Cloudflare Access místo PINu.

## 2026-08-19 — banka napojená, přihlášení PINem, živý provoz

**https://fio-uhrady.bass443.workers.dev** — commit `fa1e32c`.

**Napojení na Fio ověřené proti reálnému účtu** (3 pohyby, běh syncu):
VS v příkazu → přiřazeno podle VS; VS chybí a je dopsaný v komentáři u pohybu →
přiřazeno z komentáře; ani jedno → zůstane nepřiřazené a čeká na ruční přiřazení.
Tím padla poslední nepotvrzená domněnka celého návrhu.

- `src/fio.ts` + `src/sync.ts` — `periods/` s překryvem, dedup podle ID pohybu,
  každý běh (i prázdný, i spadlý) v `sync_runs` se srozumitelným popisem.
  Ruční přiřazení (`matched_by = 'rucne'`) automatický běh nepřepíše.
- Stránka **Úhrady z Fio** — co přišlo, komu to patří a **čím** se to poznalo.
- **Přihlášení PINem** (`src/auth.ts`) jako záloha, když není Access. PIN se neukládá,
  jen otisk PBKDF2 (100k iterací) se solí; po 5 chybách zámek na 15 min, po 10 na hodinu;
  cookie podepsaná HMAC, platnost 12 h. Access má dál přednost — dává e-mail do auditu.
  PIN se mění `node scripts/set-pin.mjs <pin>` → SQL do D1.
- Kořen `/` je veřejný rozcestník, ne holá věta.

**Ověřeno na živé adrese:** `/admin` bez přihlášení 302 → `/admin/prihlaseni`,
špatný PIN 401, správný 303 + cookie, `/admin` s cookie 200.

**Ostrá databáze je prázdná** (schéma + PIN, žádná data). Výplň volitelně:
`npx wrangler d1 execute fio-uhrady --remote --file schema/seed_priklad.sql`.

**Další v pořadí (zadané, nepostavené):**
1. **Resend + e-maily** — u každé osoby e-mail a příznak *admin*; rozesílá se celkové
   vyúčtování za všechny, nebo jen za ty, které admin vybere.
2. **Stránka pro Lucku** — měsíční závazek, jeho vývoj v čase, historie a **QR platba**
   (SPAYD; potřebuje číslo účtu domácnosti v nastavení).
3. **MFA jako volba v Nastavení** (dvoufaktor k PINu).
4. Import CSV zpátky, předpisy a porovnání „kolik měla × kolik zaplatila".

## 2026-08-19 — ŽIVĚ na Cloudflare

**https://fio-uhrady.bass443.workers.dev** — nasazeno, commit `34f0fdd`.

- D1 `fio-uhrady` (region EEUR, id `7f116705-6320-4ea2-9f89-5722800d8efa`), schéma nahrané.
  **Databáze je prázdná** — ukázková data se nenasazují sama; kdo je chce, pustí
  `npx wrangler d1 execute fio-uhrady --remote --file schema/seed_priklad.sql`.
- Ověřeno naživo: `/api/version` vrací `34f0fdd` (sedí s gitem), `/api/health` hlásí `db: ok`,
  `/admin` vrací **403** — Cloudflare Access ještě není nastavený a aplikace je fail-closed.
- V hlavičce běží čas a je vidět nasazený commit.

**BLOKUJE:**
1. **Cloudflare Access** na `/admin` — bez něj se do správy nedostane nikdo (ani vlastník).
   Zero Trust → Access → Applications → aplikace na `fio-uhrady.bass443.workers.dev/admin`.
2. **Cron trigger nenasazen** — účet bass443 má vyčerpaný free limit **5 cron triggerů na účet**
   (Cloudflare error 10072). V `wrangler.jsonc` je proto zakomentovaný. Před zapnutím syncu z Fio
   je potřeba buď Workers Paid, nebo uvolnit cron u jiného Workeru; do té doby se bude
   stahování spouštět ručně z admina.

## 2026-08-19 — admin napojený na databázi, nastavení s VS, audit

Admin už nekreslí ukázková data — čte a zapisuje do D1.

**Hotové a ověřené lokálně (proti místní D1 se schématem i výplní):**
- `src/db.ts` — čtení přehledu, uložení/smazání položky, VS u osob, token do Fio.
  **Žádný zápis bez záznamu do `audit_log`**: změna i její záznam jdou jednou `db.batch()`,
  takže nemůže vzniknout změna, u které není vidět kdo a kdy.
- `src/ui.ts` — společný shell (menu, hamburger, tokeny), stránky dodávají jen obsah.
- `/admin/nastaveni` — VS u každé osoby (podle něj se poznají platby), vložení tokenu do Fio
  a posledních 20 změn z logu. Uložený token se z databáze do UI nikdy nevrací, jen náznak `••••1234`.
- `/admin/export.csv` — středníky, BOM a desetinná čárka, aby to Excel otevřel rovnou.
- Zápis přijímáme jen z vlastní stránky (kontrola `Origin`) — ověřeno, že bez ní přijde 403.
- Ověřeno naživo: `/api/health` hlásí 14 položek, souhrn z databáze sedí na dřívější ruční propočet
  (10 626 Kč/měs, saldo +9 632 Kč), úprava položky se zapsala a objevila se v auditu,
  kolize VS i nesmyslný VS vrací srozumitelnou hlášku, krátký token appka odmítne.
- Opraveno: rozdělení procent se dopočítává metodou největšího zbytku, takže „rovným dílem"
  u 299 Kč nenechá viset haléř a nesvítí „nerozděleno −0 Kč".

**Zbývá k tomuhle kroku:** import CSV zpátky (export hotový), stránka Osoby (zakládání osob),
Log synchronizace jako samostatná stránka.

**Nasazení — dělá uživatel** (AI nesahá na ostrá data ani nezakládá zdroje):
```powershell
npx wrangler d1 create fio-uhrady                                    # database_id → wrangler.jsonc
npx wrangler d1 execute fio-uhrady --remote --file schema/0001_init.sql
npx wrangler d1 execute fio-uhrady --remote --file schema/seed_priklad.sql   # volitelné
npm run deploy
```
Pak Cloudflare Access na `/admin` a token do Fio vložit v Nastavení.

## 2026-08-19 — admin v IT-ops shellu, podíly na osoby, jednorázové položky

**Vzhled:** převzatý ze [Interface-Par](https://github.com/Anamax443/Interface-Par) — hustý WinBox shell
(titulní lišta → boční menu → toolbar → grid → stavový řádek), tokeny `:root` odtamtud.
**Material UI se nepoužilo**, a to podle rozboru v tom samém repu: MUI se vyplatí až u resize
a přeuspořádání sloupců myší, inline editace buňky a virtualizovaného scrollu přes tisíce řádků.
Tady je 14 položek a CSS vrstva by zůstala stejná. Kdyby přišel požadavek na DataGrid, je to
přechod na Vite + React + `@mui/x-data-grid` a bundle ~380 kB gzip.

**Model — zásadní oprava:** podíly ukazují na **osoby**, ne na pevné platební jednotky.
Kombinace se u každé položky liší (Lucka s dědou, Eliška s dědou, máma s Luckou), takže pevné
skupiny nefungují. Kdo platí ze svého účtu za koho (a pod jakým VS) je samostatná vrstva
a řeší se až s napojením plateb z Fio.

**Druhy položek:** `pravidelny` (jde do měsíčního průměru) × `jednorazovy` / `nedoplatek` /
`preplatek` (nejdou do průměru, jdou rovnou do dlužné částky; přeplatek se znaménkem mínus).

**Hotové a ověřené:** typecheck OK, `wrangler dev` vrátil `/admin` 200; součty osob dají přesně
celek (10 626 Kč/měs = máma 2 622 + děda 462 + Lucka 5 426 + Eliška 2 116) a jednorázové saldo
+9 632 Kč sedí (nedoplatek 4 312 − přeplatek 1 180 + oprava 6 500). Mobil: hamburger, výsuvné
menu, detail pod seznamem, na úzkém displeji se sloupce osob skrývají a nese je detail.

**Zadání, které přišlo a ještě není postavené:**
1. **Přehledová stránka je hlavně pro Lucku** — kolik činí její měsíční závazek, že se v čase mění
   a jak vypadal historicky (graf + historie, ne jen aktuální číslo).
2. **Token do Fio se zadává v adminu** (Nastavení), ne jen `wrangler secret`. Pozor: token v D1 je
   citlivý — zapsat, číst jen pro sync, v UI nikdy nezobrazovat celý, jen poslední znaky + „přepsat".
3. **Export do CSV pro Excel a zpětný import** téhož.
4. **Každá změna se loguje s identifikací** — kdo (e-mail z Cloudflare Access), kdy, co se změnilo
   z čeho na co. Tabulka `audit_log`, zapisuje se ve stejné transakci jako změna.

## 2026-08-19 — frontend admina (náklady domu)

Zadání upřesněno: appka nemá jen párovat platby, ale nejdřív **evidovat náklady domu** —
ze stránky musí být vidět celkové náklady a kolik z nich padá na jednotlivé členy.
Postup podle uživatele: **nejdřív frontend admina, vazby (databáze) až potom.**

**Model:** osoby (máma, děda, Lucka, Eliška) × **platební jednotky**. Jednotka je jeden člověk
nebo kumulace („máma + Eliška"); dělí se na jednotky, protože od jednotky chodí platba s jedním VS.
Rozpad je **per položka**, ne globální procento — děda může mít jen stočné a uhlí.
Podíl se zadává procentem nebo pevnou částkou. Zbytek se ukazuje jako „nerozděleno".

**Hotové:**
- `src/money.ts` — haléře, periody → měsíční ekvivalent, rozpad na jednotky.
- `src/admin-page.ts` — přehled: souhrnné dlaždice, matice položka × jednotka, formulář položky.
- `src/index.ts` — `/admin` fail-closed za Cloudflare Access (`ctx.access`); `DEV_ADMIN`
  funguje jen na localhostu, takže ani omylem nasazená proměnná ochranu neobejde.
- Schéma 0001 přepsáno (nikde nenasazené, tak se nemigruje): `members`, `units`,
  `unit_members`, `cost_items`, `cost_shares`; `payers` → `units`.
- Ověřeno: typecheck OK, `wrangler dev` vrátil `/admin` 200 a souhrn sedí ručnímu propočtu
  (Lucka 5 839 + máma & Eliška 4 787 = 10 626 Kč měsíčně na vzorových datech).

**Rozpracované:** stránka se kreslí z `src/sample.ts`; ukládání je vypnuté a je to na stránce vidět.

**Další krok:** vazba na D1 — `nactiPrehled()` místo `vzorovyPrehled()`, POST handlery
položky a jednotek, CSRF/origin kontrola u zápisů.

**Otevřené k doptání:** v tabulce „Náklady bydlení" je Celkem 6 909 Kč, ale součet sloupce
„mé náklady" je 13 530 Kč a jeho měsíční ekvivalent 6 626 Kč — ani jedno nesedí; ujasnit,
jak se to počítalo, ať přehled navazuje na to, co uživatel zná.

## 2026-08-19 — kostra Workeru stojí a ověřená

Doména: stačí `fio-uhrady.bass443.workers.dev`, vlastní zatím ne.

**Hotové a ověřené lokálně:**
- `wrangler.jsonc` (D1 binding `DB`, cron `*/15`, observability, `GIT_COMMIT` var), `package.json`, `tsconfig.json`.
- `src/index.ts` — `/api/version`, `/api/health`; `/admin/*` a `/v/*` zatím poctivě vrací 503 „nepostaveno".
- `schema/0001_init.sql` — 7 tabulek, pustěno proti **lokální** D1, tabulky sedí.
- `npm run typecheck` prochází; `wrangler dev` odpověděl `{"commit":"dev"}` a `{"db":"ok"}`.
- `scripts/deploy.mjs` — otiskne krátký hash commitu do `/api/version`, odmítne špinavý strom.

**Nenasazeno.** Ostrá D1 nevytvořená (`database_id` ve wrangler.jsonc je placeholder), Access nenastavený.
Na Cloudflare zatím nevzniklo nic — žádný Worker, žádná databáze.

**Čeká na uživatele — bez toho se nedá dál:**
1. **Read-only token z Fio** → `.dev.vars` → `npm run probe`. Sonda musí potvrdit `column25`.
   Když v posledních 30 dnech není u žádné platby komentář, dopsat ho v internetbankingu k jedné
   a spustit znovu — jinak nepoznáme „pole neexistuje" od „nikdo ho nevyplnil".
2. **Ostrá D1:** `npx wrangler d1 create fio-uhrady` → `database_id` doplnit do `wrangler.jsonc`.
3. **Cloudflare Access** na `/admin` (Zero Trust → Access → Applications), až bude co chránit.

Zápisy do databáze i vytváření zdrojů na Cloudflare dělá uživatel; AI dodá hotové bloky k spuštění.

**Stav roadmapy** (číslování podle záznamu níž): 1 ⏳ čeká na token · 2 ✅ hotovo · 3–6 ⚪ nezačato ·
7 ✅ docs/BUILD.md napsán (doplní se po prvním ostrém nasazení).

**Stav gitu k tomuto záznamu:** `6b90450` na `origin/main`, pracovní strom čistý.

## 2026-08-19 — zadání a návrh

Cíl: přehled uhrazeno / dlužno proti reálným pohybům na účtu Fio banky. Dvě stránky — admin za 2FA a read-only přehled s grafem a exportem.

**Rozhodnuto:**
- Stack: Cloudflare Worker + D1 + Cron Trigger. Nasazení ručně (`npm run deploy`), žádné CI.
- Admin za **Cloudflare Access** (2FA řeší Cloudflare, v kódu žádná hesla).
- Přehled na **odkazu s neuhodnutelným tokenem** (`/v/{view_token}`), bez loginu, jen čtení + export.
- Předpisy = **paušál + jednorázové položky**.
- Jména plátců: default **pseudonymy / VS**, reálná jména **přepínatelná v nastavení**.
- Párování: VS → komentář vlastníka účtu (`column25`) → zpráva pro příjemce (`column16`) → uživatelská identifikace (`column7`) → ruční. Z textových polí se berou jen čísla, která odpovídají evidovanému VS. Každé párování nese stopu `matched_by`.
- Stahování přes `periods/` s překryvem a dedupem podle ID pohybu — **ne** `last/` (kurzor v bance se posune i při chybě a pohyby by tiše zmizely).

**Hotové:**
- Repo založené podle standardu, README + docs/ARCHITECTURE.md popisují návrh.
- `scripts/fio-probe.mjs` — sonda pro ověření jádra (jen čte).

**Rozpracované:** —

**Zbývá — v tomto pořadí:**
1. **Ověřit jádro:** read-only token z Fio → `.dev.vars` → `node scripts/fio-probe.mjs`. Potvrdit, že API vrací `column25` (komentář dopsaný vlastníkem účtu v internetbankingu). Dokud tohle nesedí, záložní párování z poznámky nestavět.
2. Kostra Workeru + D1 schéma (`payers`, `plans`, `charges`, `payments`, `allocations`, `settings`, `sync_runs`).
3. Cron sync z Fio + dedup.
4. Matcher + fronta nespárovaných.
5. Admin UI za Access.
6. Přehled: souhrn, graf, výpis, export CSV + tisk.
7. docs/BUILD.md — postup od nuly.
