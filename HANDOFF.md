# HANDOFF — deník stavu: FIO-uhrady

Append-only. Nejnovější záznam nahoru. Slouží k pokračování z jiného počítače / po pauze.

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
