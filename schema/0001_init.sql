-- FIO-uhrady — počáteční schéma.
-- Spouští uživatel (zápisy do DB nedělá AI):
--   wrangler d1 execute fio-uhrady --remote --file schema/0001_init.sql

-- === Kdo ===

-- Osoba v domácnosti (máma, děda, Lucka, Eliška…).
create table if not exists members (
  id          integer primary key autoincrement,
  jmeno       text    not null unique,
  aktivni     integer not null default 1,
  created_at  text    not null default (datetime('now'))
);

-- Platební jednotka = na koho se náklad dělí a od koho chodí platba.
-- Buď jeden člověk, nebo kumulace víc lidí („máma + Eliška").
-- `vs` je variabilní symbol, kterým se poznají její platby z Fio (může chybět —
-- třeba děda platí hotově a v bance se nikdy neobjeví).
create table if not exists units (
  id          integer primary key autoincrement,
  label       text    not null unique,     -- pseudonym do veřejného přehledu
  nazev       text,                        -- reálné pojmenování, vidí admin
  vs          text    unique,              -- null = nechodí přes účet
  aktivni     integer not null default 1,
  poznamka    text,
  created_at  text    not null default (datetime('now'))
);

-- Které osoby jednotka pokrývá.
create table if not exists unit_members (
  unit_id    integer not null references units(id) on delete cascade,
  member_id  integer not null references members(id) on delete cascade,
  primary key (unit_id, member_id)
);

-- === Náklady domu ===

-- Položka rozpočtu: co dům stojí. `castka_celkem` je částka za jedno období
-- (u ročního nákladu roční částka), ne měsíční průměr — ať to sedí s fakturou.
create table if not exists cost_items (
  id            integer primary key autoincrement,
  nazev         text    not null,
  kategorie     text,
  castka_celkem integer not null,          -- haléře, aby se nepočítalo s float
  perioda       text    not null,          -- 'mesicne'|'ctvrtletne'|'pololetne'|'rocne'|'jednorazove'
  hradi_unit_id integer references units(id) on delete set null,  -- kdo to fyzicky posílá
  poznamka      text,                      -- „bude dražší za 2 měsíce", „platí se z pachtovného"
  plati_od      text,                      -- 'YYYY-MM-DD', null = odjakživa
  plati_do      text,                      -- null = pořád
  aktivni       integer not null default 1,
  poradi        integer not null default 0,
  created_at    text    not null default (datetime('now')),
  updated_at    text    not null default (datetime('now'))
);

-- Rozpad položky na jednotky. Co není rozpuštěné, se v přehledu ukáže jako
-- „nerozděleno" — mlčky to zmizet nesmí, jinak souhrn lže.
create table if not exists cost_shares (
  id           integer primary key autoincrement,
  cost_item_id integer not null references cost_items(id) on delete cascade,
  unit_id      integer not null references units(id) on delete cascade,
  rezim        text    not null,           -- 'procento' | 'castka'
  hodnota      integer not null,           -- procento: setiny % (5000 = 50 %) | castka: haléře
  unique (cost_item_id, unit_id)
);
create index if not exists idx_shares_item on cost_shares(cost_item_id);

-- === Předpisy a úhrady ===

-- Paušál: opakovaný předpis, ze kterého se generují jednotlivé předpisy.
create table if not exists plans (
  id             integer primary key autoincrement,
  unit_id        integer not null references units(id) on delete cascade,
  nazev          text    not null,
  castka         integer not null,         -- haléře
  den_splatnosti integer not null default 15,
  plati_od       text    not null,         -- 'YYYY-MM'
  plati_do       text,
  created_at     text    not null default (datetime('now'))
);

-- Konkrétní předpis „tato jednotka má za toto období zaplatit tolik".
create table if not exists charges (
  id          integer primary key autoincrement,
  unit_id     integer not null references units(id) on delete cascade,
  plan_id     integer references plans(id) on delete set null,
  obdobi      text,                        -- 'YYYY-MM' u paušálu, null u jednorázových
  nazev       text    not null,
  castka      integer not null,            -- haléře
  splatnost   text    not null,            -- 'YYYY-MM-DD'
  created_at  text    not null default (datetime('now')),
  unique (unit_id, plan_id, obdobi)        -- paušál nevygeneruje stejné období dvakrát
);

-- Pohyb z Fio. PK = ID pohybu přidělené bankou (column22) → opakované stažení
-- stejného období nic nezduplikuje. Proto se dá stahovat s překryvem.
create table if not exists payments (
  fio_id          text    primary key,     -- column22
  datum           text    not null,        -- column0 → 'YYYY-MM-DD'
  castka          integer not null,        -- column1 v haléřích (kladné = příchozí)
  mena            text    not null,        -- column14
  vs              text,                    -- column5
  ks              text,                    -- column4
  ss              text,                    -- column6
  protiucet       text,                    -- column2
  protiucet_nazev text,                    -- column10
  zprava          text,                    -- column16  zpráva pro příjemce (píše plátce)
  komentar        text,                    -- column25  komentář (dopisuje vlastník účtu)
  uziv_ident      text,                    -- column7
  raw             text    not null,        -- syrový JSON pohybu pro pozdější dohledání
  imported_at     text    not null default (datetime('now'))
);

-- Přiřazení částky platby na předpis. Platba může pokrýt víc předpisů
-- i jen část jednoho, proto samostatná tabulka a ne sloupec v payments.
create table if not exists allocations (
  id            integer primary key autoincrement,
  payment_id    text    not null references payments(fio_id) on delete cascade,
  charge_id     integer not null references charges(id) on delete cascade,
  castka        integer not null,          -- haléře přiřazené na tento předpis
  matched_by    text    not null,          -- 'vs' | 'komentar' | 'zprava' | 'uziv_ident' | 'rucne'
  matched_value text,                      -- co konkrétně se našlo (např. '240137')
  created_at    text    not null default (datetime('now'))
);
create index if not exists idx_alloc_payment on allocations(payment_id);
create index if not exists idx_alloc_charge  on allocations(charge_id);

-- === Provoz ===

create table if not exists settings (
  klic       text primary key,
  hodnota    text not null,
  changed_at text not null default (datetime('now'))
);

-- Deník běhů cronu. Aby bylo i zvenčí poznat, jestli sync čeká, běží, nebo spadl.
create table if not exists sync_runs (
  id          integer primary key autoincrement,
  zacatek     text    not null default (datetime('now')),
  konec       text,
  obdobi_od   text,
  obdobi_do   text,
  novych      integer not null default 0,
  sparovanych integer not null default 0,
  stav        text    not null default 'bezi',  -- 'bezi' | 'ok' | 'chyba'
  detail      text
);

insert or ignore into settings (klic, hodnota) values
  ('show_real_names', '0'),
  ('sync_window_days', '14');
