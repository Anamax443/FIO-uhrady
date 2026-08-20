-- Osobní odkaz na přehled. Spouští uživatel — POZOR, `--file` na ostré databázi
-- neprojde (Authentication error 10000), příkazy se pouštějí po jednom:
--   npx wrangler d1 execute fio-uhrady --remote --command "alter table members add column view_token text"
--   npx wrangler d1 execute fio-uhrady --remote --command "create unique index if not exists idx_members_token on members(view_token)"
--
-- Každý člen může dostat vlastní neuhodnutelný odkaz. Vidí na něm jen svoje
-- čísla a souhrn za dům — ne to, jak jsou na tom ostatní.

alter table members add column view_token text;
create unique index if not exists idx_members_token on members(view_token);
