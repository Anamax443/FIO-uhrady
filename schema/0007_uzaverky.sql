-- Měsíční uzávěrky. Spouští uživatel:
--   npx wrangler d1 execute fio-uhrady --remote --file schema/0007_uzaverky.sql
--
-- Náklady se v čase mění: internet zdraží, uhlí doběhne, rozdělení se upraví.
-- Bez uzávěrky by zpětný výpočet tvrdil, že v lednu platilo to, co platí dnes.
-- Uzávěrka zamrazí, co v daném měsíci opravdu platilo, a vyrovnání pak počítá
-- ze zamražených čísel místo z aktuálního nastavení.

create table if not exists uzaverky (
  obdobi         text primary key,          -- 'YYYY-MM'
  naklady_celkem integer not null,          -- haléře za ten měsíc
  uzavreno_at    text not null default (datetime('now')),
  uzavrel        text,
  poznamka       text
);

-- Co v tom měsíci připadlo na koho a jakou měl zálohu.
create table if not exists uzaverka_podily (
  obdobi    text    not null references uzaverky(obdobi) on delete cascade,
  member_id integer not null references members(id) on delete cascade,
  podil     integer not null,               -- skutečný podíl na nákladech
  zaloha    integer not null,               -- záloha platná v tom měsíci
  primary key (obdobi, member_id)
);

-- Z čeho se ten měsíc skládal — ať jde po letech dohledat, proč vyšel zrovna takhle.
create table if not exists uzaverka_polozky (
  id           integer primary key autoincrement,
  obdobi       text    not null references uzaverky(obdobi) on delete cascade,
  cost_item_id integer,
  nazev        text    not null,
  castka       integer not null              -- měsíční díl té položky
);
create index if not exists idx_uzaverka_polozky on uzaverka_polozky(obdobi);
