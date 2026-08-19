# HANDOFF — deník stavu: FIO-uhrady

Append-only. Nejnovější záznam nahoru. Slouží k pokračování z jiného počítače / po pauze.

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
