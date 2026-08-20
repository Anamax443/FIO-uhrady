-- Ke kterému měsíci platba patří. POZOR: `--file` na ostré databázi neprojde
-- (Authentication error 10000), příkazy se pouštějí po jednom:
--   npx wrangler d1 execute fio-uhrady --remote --command "alter table payments add column obdobi text"
--   npx wrangler d1 execute fio-uhrady --remote --command "update payments set obdobi = substr(datum, 1, 7) where obdobi is null"
--
-- Datum připsání a měsíc, za který se platí, nemusí sedět: zálohu za prosinec
-- pošle člověk 3. ledna. Bez tohohle sloupce by prosinec zůstal s dírou
-- a leden vypadal jako předplacený. Předvyplňuje se měsícem data platby,
-- admin ho může v Úhradách přepsat.
--
-- Prázdná hodnota není chyba — u starých plateb se použije měsíc z data.

alter table payments add column obdobi text;   -- 'YYYY-MM', null = ber měsíc z data
update payments set obdobi = substr(datum, 1, 7) where obdobi is null;
