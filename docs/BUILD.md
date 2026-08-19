# BUILD — jak postavit FIO-uhrady od nuly

> **Test hotovosti:** dostane se nový člověk (nebo já po výměně PC) JEN z tohoto dokumentu
> k běžící aplikaci? Když ne, doplň, co chybělo.

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
npx wrangler d1 execute fio-uhrady --local  --file schema/0001_init.sql   # vývojová
npx wrangler d1 execute fio-uhrady --remote --file schema/0001_init.sql   # ostrá
```
Schéma je psané `create table if not exists` — pustit znovu nic nerozbije.

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
- **Admin (`/admin/*`)** — chráněno **Cloudflare Access** (Zero Trust → Access → Applications):
  aplikace na `fio-uhrady.bass443.workers.dev/admin`, politika = konkrétní e-mail, druhý faktor
  podle nastavení Zero Trust. V kódu žádná hesla.
- **Přehled (`/v/{token}`)** — bez loginu, chrání ho jen neuhodnutelnost odkazu.
  Token se generuje `crypto.randomUUID()` a leží v `settings.view_token`. Kdo odkaz dostane, vidí přehled.
- **Fio token** — read-only, jen secret ve Workeru.

## 8. Ověření jádra (než se staví dál)
```powershell
node scripts/fio-probe.mjs
```
Sonda jen čte z Fio API a vypíše, která pole jsou obsazená. Musí potvrdit, že se v odpovědi
objevuje `column25` (komentář dopsaný vlastníkem účtu) — na něm stojí záložní párování.
