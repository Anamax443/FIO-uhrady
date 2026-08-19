-- FIO-uhrady — počáteční schéma.
-- Spouští uživatel (zápisy do DB nedělá AI):
--   npx wrangler d1 execute fio-uhrady --remote --file schema/0001_init.sql

-- === Kdo ===

-- Osoba v domácnosti. Náklady se dělí přímo mezi osoby — kombinace se
-- u každé položky liší (Lucka s dědou, Eliška s dědou, máma s Luckou),
-- takže pevné skupiny by nefungovaly.
--
-- `vs` je variabilní symbol, kterým se poznají platby té osoby v pohybech z Fio.
-- Může chybět (kdo platí hotově, v bance se nikdy neobjeví). Spravuje se
-- v Nastavení → Identifikace plateb.
create table if not exists members (
  id         integer primary key autoincrement,
  jmeno      text    not null unique,
  vs         text    unique,
  aktivni    integer not null default 1,
  poznamka   text,
  created_at text    not null default (datetime('now'))
);

-- === Náklady domu ===

-- Položka rozpočtu. `castka_celkem` je částka za jedno období (u ročního
-- nákladu roční částka), ne měsíční průměr — ať to sedí s fakturou.
create table if not exists cost_items (
  id              integer primary key autoincrement,
  nazev           text    not null,
  kategorie       text,
  castka_celkem   integer not null default 0,   -- haléře, aby se nepočítalo s float
  perioda         text    not null default 'mesicne',  -- 'mesicne'|'ctvrtletne'|'pololetne'|'rocne'|'jednorazove'
  -- Pravidelný náklad jde do měsíčního průměru; zbylé tři jsou jednorázové
  -- a promítnou se rovnou do dlužné částky. Přeplatek dluh snižuje.
  druh            text    not null default 'pravidelny', -- 'pravidelny'|'jednorazovy'|'nedoplatek'|'preplatek'
  datum           text,                          -- 'YYYY-MM-DD' u jednorázových: kdy vznikly
  hradi_member_id integer references members(id) on delete set null,  -- kdo fakturu fyzicky platí
  poznamka        text,
  aktivni         integer not null default 1,
  created_at      text    not null default (datetime('now')),
  updated_at      text    not null default (datetime('now'))
);

-- Rozdělení položky mezi osoby. Co není rozpuštěné, se v přehledu ukáže jako
-- „nerozděleno" — mlčky to zmizet nesmí, jinak souhrn lže.
create table if not exists cost_shares (
  id           integer primary key autoincrement,
  cost_item_id integer not null references cost_items(id) on delete cascade,
  member_id    integer not null references members(id) on delete cascade,
  rezim        text    not null,          -- 'procento' | 'castka'
  hodnota      integer not null,          -- procento: setiny % (5000 = 50 %) | castka: haléře
  unique (cost_item_id, member_id)
);
create index if not exists idx_shares_item on cost_shares(cost_item_id);

-- === Předpisy a úhrady ===

-- Konkrétní předpis „tato osoba má za toto období zaplatit tolik".
-- Generuje se z pravidelných nákladů, jednorázové položky se přidávají rovnou.
create table if not exists charges (
  id           integer primary key autoincrement,
  member_id    integer not null references members(id) on delete cascade,
  cost_item_id integer references cost_items(id) on delete set null,
  obdobi       text,                      -- 'YYYY-MM' u pravidelných, null u jednorázových
  nazev        text    not null,
  castka       integer not null,          -- haléře
  splatnost    text    not null,          -- 'YYYY-MM-DD'
  created_at   text    not null default (datetime('now')),
  unique (member_id, cost_item_id, obdobi)  -- stejné období se nevygeneruje dvakrát
);
create index if not exists idx_charges_member on charges(member_id, obdobi);

-- Pohyb z Fio. PK = ID pohybu přidělené bankou (column22) → opakované stažení
-- stejného období nic nezduplikuje. Proto se dá stahovat s překryvem.
create table if not exists payments (
  fio_id          text    primary key,    -- column22
  datum           text    not null,       -- column0 → 'YYYY-MM-DD'
  castka          integer not null,       -- column1 v haléřích (kladné = příchozí)
  mena            text    not null,       -- column14
  vs              text,                   -- column5
  ks              text,                   -- column4
  ss              text,                   -- column6
  protiucet       text,                   -- column2
  protiucet_nazev text,                   -- column10
  zprava          text,                   -- column16  zpráva pro příjemce (píše plátce)
  komentar        text,                   -- column25  komentář (dopisuje vlastník účtu)
  uziv_ident      text,                   -- column7
  raw             text    not null,       -- syrový JSON pohybu pro pozdější dohledání
  imported_at     text    not null default (datetime('now'))
);
create index if not exists idx_payments_datum on payments(datum);

-- Přiřazení částky platby na předpis. Platba může pokrýt víc předpisů
-- i jen část jednoho, proto samostatná tabulka a ne sloupec v payments.
create table if not exists allocations (
  id            integer primary key autoincrement,
  payment_id    text    not null references payments(fio_id) on delete cascade,
  charge_id     integer not null references charges(id) on delete cascade,
  castka        integer not null,         -- haléře přiřazené na tento předpis
  matched_by    text    not null,         -- 'vs' | 'komentar' | 'zprava' | 'uziv_ident' | 'rucne'
  matched_value text,                     -- co konkrétně se našlo (např. '2131')
  created_at    text    not null default (datetime('now'))
);
create index if not exists idx_alloc_payment on allocations(payment_id);
create index if not exists idx_alloc_charge  on allocations(charge_id);

-- === Provoz ===

-- Nastavení: view_token, fio_token, okno stahování, …
-- Citlivé hodnoty (fio_token) se v UI nikdy nezobrazují celé.
create table if not exists settings (
  klic       text primary key,
  hodnota    text not null,
  changed_at text not null default (datetime('now')),
  changed_by text
);

-- Každá změna s identifikací: kdo (e-mail z Cloudflare Access), kdy,
-- co se změnilo a z čeho na co. Zapisuje se ve stejné dávce jako sama změna.
create table if not exists audit_log (
  id        integer primary key autoincrement,
  cas       text    not null default (datetime('now')),
  kdo       text    not null,
  akce      text    not null,             -- 'vytvoreni' | 'zmena' | 'smazani' | 'import' | 'sync'
  entita    text    not null,             -- 'polozka' | 'osoba' | 'nastaveni' | 'platba'
  entita_id text,
  popis     text    not null,             -- lidsky čitelně, ať to dá přečíst i někdo zvenčí
  pred      text,                         -- JSON stavu před změnou
  po        text                          -- JSON stavu po změně
);
create index if not exists idx_audit_cas on audit_log(cas);

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
  ('nazev_domu', 'H-R 213'),
  ('show_real_names', '0'),
  ('sync_window_days', '14');
