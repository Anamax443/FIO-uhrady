-- Zálohy a rozpouštění jednorázových nákupů. Spouští uživatel:
--   npx wrangler d1 execute fio-uhrady --remote --file schema/0006_zalohy.sql
--
-- SQLite nemá "add column if not exists"; při opakovaném spuštění tyhle příkazy
-- skončí chybou "duplicate column name" a nic nerozbijí.

-- Nákup není spotřeba. Uhlí za 42 000 Kč se protopí za rok, takže se do nákladů
-- nedává celé v měsíci nákupu, ale rozpouští se po `rozpustit_mesicu` měsících
-- od `rozpustit_od`. Mimo to okno položka do měsíčních nákladů nevstupuje.
alter table cost_items add column rozpustit_od text;        -- 'YYYY-MM'
alter table cost_items add column rozpustit_mesicu integer; -- null = nerozpouští se

-- Odkud peníze šly. 'ucet' = ze společného účtu (financovaného zálohami),
-- 'osoba' = někdo to zaplatil ze svého a vzniká mu tím kredit.
-- Bez tohohle rozlišení by se náklad počítal dvakrát: jako výdaj i jako vklad.
alter table cost_items add column zdroj_uhrady text not null default 'ucet';

-- Historie záloh. Záloha je fixní částka na trvalý příkaz; platí od svého
-- měsíce, dokud ji nevystřídá novější. Nikdy se nepřepisuje — jinak by
-- zpětný výpočet dluhu tvrdil, že se platilo něco jiného, než se platilo.
create table if not exists zalohy (
  id          integer primary key autoincrement,
  member_id   integer not null references members(id) on delete cascade,
  castka      integer not null,          -- haléře za měsíc
  plati_od    text    not null,          -- 'YYYY-MM'
  poznamka    text,
  created_at  text    not null default (datetime('now')),
  created_by  text,
  unique (member_id, plati_od)
);
create index if not exists idx_zalohy_member on zalohy(member_id, plati_od);

insert or ignore into settings (klic, hodnota) values
  -- Rezerva na neplánované nákupy (drogerie, opravy), aby vyúčtování
  -- nekončilo pokaždé nedoplatkem.
  ('rezerva_procent', '10'),
  -- Nedoplatek do téhle výše se rozpustí do nové zálohy; nad ni se appka zeptá.
  ('prah_doplatku', '500000');
