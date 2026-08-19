-- Den splatnosti měsíčního příspěvku. Spouští uživatel:
--   npx wrangler d1 execute fio-uhrady --remote --file schema/0005_splatnost.sql
--
-- Měsíc se do dlužné částky započítá až tím dnem — do té doby ještě není
-- co dlužit. Bez toho by appka hlásila dluh hned prvního.

insert or ignore into settings (klic, hodnota) values ('den_splatnosti', '20');
