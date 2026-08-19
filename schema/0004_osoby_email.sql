-- E-mail a role u osoby + začátek vyúčtování. Spouští uživatel:
--   npx wrangler d1 execute fio-uhrady --remote --file schema/0004_osoby_email.sql
--
-- SQLite nemá "add column if not exists"; při opakovaném spuštění tyhle příkazy
-- skončí chybou "duplicate column name" a nic nerozbijí.

alter table members add column email text;
alter table members add column je_admin integer not null default 0;

-- Od kterého měsíce se počítají příspěvky. Bez toho by nešlo říct,
-- kolik už kdo měl dohromady zaplatit.
insert or ignore into settings (klic, hodnota)
  values ('vyuctovani_od', strftime('%Y-%m', 'now'));
