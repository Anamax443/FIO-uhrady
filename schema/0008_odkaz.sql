-- Osobní odkaz na přehled. Spouští uživatel:
--   npx wrangler d1 execute fio-uhrady --remote --file schema/0008_odkaz.sql
--
-- Každý člen může dostat vlastní neuhodnutelný odkaz. Vidí na něm jen svoje
-- čísla a souhrn za dům — ne to, jak jsou na tom ostatní.

alter table members add column view_token text;
create unique index if not exists idx_members_token on members(view_token);
