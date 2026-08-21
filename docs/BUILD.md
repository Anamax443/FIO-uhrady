# BUILD — jak postavit FIO-uhrady od nuly

> **Test hotovosti:** dostane se nový člověk (nebo já po výměně PC) JEN z tohoto dokumentu
> k běžící aplikaci? Když ne, doplň, co chybělo.
> *In English: [BUILD.en.md](BUILD.en.md)*

## 1. Závislosti
- **Node.js 20+** (ověřeno na v24.13.1)
- **Wrangler** — instaluje se jako devDependency, netřeba globálně
- účet **Cloudflare** `bass443` (`npx wrangler login`)
- účet **Fio banka** s možností vydat API token

## 2. Získání kódu
```powershell
gh repo clone Anamax443/FIO-uhrady
cd FIO-uhrady
npm install
```

## 3. Konfigurace a secrety
1. `copy .dev.vars.example .dev.vars` a vyplň `FIO_TOKEN`.
   - Token: internetbanking Fio → Nastavení → API. Vydat **read-only** — aplikace jen čte pohyby.
2. Do produkce token jako secret (nikdy do gitu, nikdy do wrangler.jsonc):
   ```powershell
   npx wrangler secret put FIO_TOKEN
   ```

## 4. Databáze (D1)
```powershell
npx wrangler d1 create fio-uhrady          # vrátí database_id → doplnit do wrangler.jsonc
```

Migrace jsou v `schema/`, pouštějí se **v pořadí 0001 … 0012**. Většina je psaná
`create table if not exists`, takže opakované spuštění nic nerozbije; `alter table`
při druhém běhu skončí chybou „duplicate column name" a to je taky v pořádku.

**Lokální databáze** — soubor jde použít:
```powershell
npx wrangler d1 execute fio-uhrady --local --file schema/0001_init.sql
```

**Ostrá databáze — `--file` NEPOUŽÍVAT.** Cloudflare ho na účtu `bass443` odmítá
(`Authentication error [code: 10000]`), protože jde přes import endpoint. Příkazy se
pouštějí po jednom přes `--command`; hlavička každé migrace má hotové znění k zkopírování.
Kvůli tomuhle jednou v produkci neproběhla celá migrace a aplikace padala na chybějícím
sloupci — po každé migraci si ověř, co v databázi opravdu je:
```powershell
npx wrangler d1 execute fio-uhrady --remote --command "select name from sqlite_master where type='table' order by name"
npx wrangler d1 execute fio-uhrady --remote --command "select group_concat(name,', ') from pragma_table_info('members')"
```

Volitelná ukázková data: `schema/seed_priklad.sql`.

## 5. Build a spuštění lokálně
```powershell
npm run types      # vygeneruje worker-configuration.d.ts z wrangler.jsonc
npm run typecheck  # tsc --noEmit
npm run dev        # http://127.0.0.1:8787
```
Ověření, že kostra žije:
- `GET /api/version` → `{ "app": "fio-uhrady", "commit": "dev" }`
- `GET /api/health` → `{ "db": "ok" }` (potvrzuje, že binding na D1 opravdu funguje)

## 6. Nasazení do produkce
Cíl: `fio-uhrady.bass443.workers.dev` (vlastní doména zatím ne). Nasazuje se **ručně**, žádné CI:
```powershell
npm run deploy
```
Skript odmítne nasadit špinavý pracovní strom a otiskne do Workeru krátký hash commitu.

**Ověření po nasazení:** `GET /api/version` musí vrátit hash toho commitu, který jsi nasazoval.

## 7. Přístupy a práva
- **Správa (`/admin/*`)** — přednost má **Cloudflare Access** (Zero Trust → Access →
  Applications): aplikace na `fio-uhrady.bass443.workers.dev/admin`, politika = konkrétní
  e-mail. Když Access není, pustí dovnitř **PIN** — v databázi jen otisk PBKDF2 (100 000
  iterací) se solí, po 5 chybách zámek na 15 min, po 10 na hodinu. V kódu žádná hesla.
  ```powershell
  node scripts/set-pin.mjs 1258   # vypíše dva hotové --command příkazy k spuštění
  ```
- **Osobní přehled (`/v/{token}`)** — bez loginu, chrání ho jen neuhodnutelnost odkazu
  (128 bitů náhody v `members.view_token`). Vytváří se v Nastavení u osoby a jde zrušit.
- **Fio token** — read-only, ukládá se v Nastavení; z databáze se do UI nikdy nevrací celý.

## 8. Ověření jádra (než se staví dál)
```powershell
npm run probe
```
Sonda jen čte z Fio API a vypíše, která pole jsou obsazená, plus popíše token (délka,
znaky navíc), aniž by ho vypsala. Musí potvrdit, že se v odpovědi objevuje `column25`
(komentář dopsaný vlastníkem účtu) — na něm stojí záložní párování.

`HTTP 500` z Fio **neznamená špatný token** — takhle se ozve i výpadek na jejich straně.
Limit je 1 dotaz / 30 s, takže opakovat hned nemá smysl.

## 9. Kontroly před nasazením
```powershell
npm run typecheck
```
Navíc se vyplatí ověřit **syntax skriptů, které stránky generují**. Stránky skládají
JavaScript do řetězce, takže duplicitní `const` neshodí jednu funkci, ale celý skript
stránky — a s ním všechna tlačítka. Vytáhni `<script>` z běžící stránky a pusť
`node --check`; jednou to takhle rozbilo filtrování i ukládání položek naráz.

## 10. Automatický provoz
Cron běží každých 15 minut a dělá dvě nezávislé věci: stahuje z Fio a dohání uzávěrky
s vyúčtováním. Chybějící token ani výpadek banky nesmí zastavit zavírání měsíců, proto
jsou v kódu oddělené. Automatiku lze vypnout přepínači na stránkách Uzávěrky a Vyúčtování.
