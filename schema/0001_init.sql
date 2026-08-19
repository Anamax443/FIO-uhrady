-- FIO-uhrady — počáteční schéma.
-- Spouští uživatel (zápisy do DB nedělá AI):
--   wrangler d1 execute fio-uhrady --remote --file schema/0001_init.sql

-- Plátce. `label` je pseudonym do veřejného přehledu, `jmeno` vidí jen admin
-- (nebo přehled, když se v nastavení zapne show_real_names).
create table if not exists payers (
  id          integer primary key autoincrement,
  label       text    not null,
  jmeno       text,
  vs          text    not null unique,   -- variabilní symbol, kterým se plátce pozná
  aktivni     integer not null default 1,
  poznamka    text,
  created_at  text    not null default (datetime('now'))
);

-- Paušál: opakovaný předpis, ze kterého se generují jednotlivé předpisy.
create table if not exists plans (
  id           integer primary key autoincrement,
  payer_id     integer not null references payers(id) on delete cascade,
  nazev        text    not null,
  castka       integer not null,          -- v haléřích, aby se nepočítalo s float
  den_splatnosti integer not null default 15,
  plati_od     text    not null,          -- 'YYYY-MM'
  plati_do     text,                      -- null = bez konce
  created_at   text    not null default (datetime('now'))
);

-- Konkrétní předpis „tento plátce má za toto období zaplatit tolik".
-- Vzniká z paušálu (plan_id) nebo ručně jako jednorázový (plan_id null).
create table if not exists charges (
  id          integer primary key autoincrement,
  payer_id    integer not null references payers(id) on delete cascade,
  plan_id     integer references plans(id) on delete set null,
  obdobi      text,                       -- 'YYYY-MM' u paušálu, null u jednorázových
  nazev       text    not null,
  castka      integer not null,           -- haléře
  splatnost   text    not null,           -- 'YYYY-MM-DD'
  created_at  text    not null default (datetime('now')),
  unique (payer_id, plan_id, obdobi)      -- paušál nevygeneruje stejné období dvakrát
);

-- Pohyb z Fio. PK = ID pohybu přidělené bankou (column22) → opakované stažení
-- stejného období nic nezduplikuje. Proto se dá stahovat s překryvem.
create table if not exists payments (
  fio_id        text    primary key,      -- column22
  datum         text    not null,         -- column0 → 'YYYY-MM-DD'
  castka        integer not null,         -- column1 v haléřích (kladné = příchozí)
  mena          text    not null,         -- column14
  vs            text,                     -- column5
  ks            text,                     -- column4
  ss            text,                     -- column6
  protiucet     text,                     -- column2
  protiucet_nazev text,                   -- column10
  zprava        text,                     -- column16  zpráva pro příjemce (píše plátce)
  komentar      text,                     -- column25  komentář (dopisuje vlastník účtu)
  uziv_ident    text,                     -- column7
  raw           text    not null,         -- syrový JSON pohybu pro pozdější dohledání
  imported_at   text    not null default (datetime('now'))
);

-- Přiřazení částky platby na předpis. Platba může pokrýt víc předpisů
-- i jen část jednoho, proto samostatná tabulka a ne sloupec v payments.
create table if not exists allocations (
  id            integer primary key autoincrement,
  payment_id    text    not null references payments(fio_id) on delete cascade,
  charge_id     integer not null references charges(id) on delete cascade,
  castka        integer not null,         -- haléře přiřazené na tento předpis
  matched_by    text    not null,         -- 'vs' | 'komentar' | 'zprava' | 'uziv_ident' | 'rucne'
  matched_value text,                     -- co konkrétně se našlo (např. '240137')
  created_at    text    not null default (datetime('now'))
);
create index if not exists idx_alloc_payment on allocations(payment_id);
create index if not exists idx_alloc_charge  on allocations(charge_id);

-- Nastavení: view_token, show_real_names, okno stahování, kurzor…
create table if not exists settings (
  klic     text primary key,
  hodnota  text not null,
  changed_at text not null default (datetime('now'))
);

-- Deník běhů cronu. Aby bylo i zvenčí poznat, jestli sync čeká, běží, nebo spadl.
create table if not exists sync_runs (
  id            integer primary key autoincrement,
  zacatek       text    not null default (datetime('now')),
  konec         text,
  obdobi_od     text,
  obdobi_do     text,
  novych        integer not null default 0,
  sparovanych   integer not null default 0,
  stav          text    not null default 'bezi',  -- 'bezi' | 'ok' | 'chyba'
  detail        text
);

insert or ignore into settings (klic, hodnota) values
  ('show_real_names', '0'),
  ('sync_window_days', '14');
