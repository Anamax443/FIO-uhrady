-- Roční vyúčtování. Spouští uživatel:
--   npx wrangler d1 execute fio-uhrady --remote --file schema/0009_vyuctovani.sql
--
-- Záloha je fixní částka, skutečné náklady kolísají. Vyúčtování ten rozdíl
-- jednou za období srovná a **uzavře**: co se v něm zúčtovalo, se v dalším
-- období už znovu nepočítá. Proto se čísla zamrazí sem a `vyuctovani_od`
-- v nastavení se posune za konec období — bez toho by se stejný přeplatek
-- odečítal od dluhu donekonečna.
--
-- Klíčem je konec období: vyúčtování na sebe navazují, dvě se stejným koncem
-- nedávají smysl.

create table if not exists vyuctovani (
  obdobi_do    text    primary key,        -- 'YYYY-MM' včetně
  obdobi_od    text    not null,           -- 'YYYY-MM' včetně
  vytvoreno_at text    not null default (datetime('now')),
  vytvoril     text,
  poznamka     text
);

-- Co z toho vyšlo na koho. Ukládají se i mezisoučty, ne jen výsledek —
-- ať jde po letech přečíst, z čeho se rozdíl vzal.
create table if not exists vyuctovani_radky (
  obdobi_do   text    not null references vyuctovani(obdobi_do) on delete cascade,
  member_id   integer not null references members(id) on delete cascade,
  predepsano  integer not null,          -- součet záloh za období
  zaplaceno   integer not null,          -- co za období přišlo (banka + placené ze svého)
  skutecne    integer not null,          -- skutečný podíl na nákladech za období
  rozdil      integer not null,          -- skutecne − zaplaceno; kladné = má doplatit
  -- 'do_zalohy'   = rozdíl se rozpustí do nové zálohy (trvalý příkaz zůstane fixní)
  -- 'jednorazove' = rozdíl se doplatí nebo vrátí mimo zálohu a čeká ve `zustatek`
  zpusob      text    not null,
  nova_zaloha integer not null,          -- záloha stanovená od měsíce po období
  zustatek    integer not null,          -- mimo zálohu; + = má doplatit, − = má k dobru
  primary key (obdobi_do, member_id)
);
create index if not exists idx_vyuctovani_radky_member on vyuctovani_radky(member_id);
