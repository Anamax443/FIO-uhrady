-- Přiřazení pohybu k osobě. Spouští uživatel:
--   npx wrangler d1 execute fio-uhrady --remote --file schema/0002_payments_match.sql
--
-- Samostatná migrace, protože 0001 už je nasazené v ostré databázi.
-- SQLite nemá "add column if not exists"; při opakovaném spuštění tyhle tři
-- příkazy skončí chybou "duplicate column name" a to je v pořádku — nic nerozbijí.

alter table payments add column member_id integer references members(id);
alter table payments add column matched_by text;      -- 'vs'|'ucet'|'komentar'|'zprava'|'uziv_ident'|'rucne'
alter table payments add column matched_value text;   -- co konkrétně se našlo, ať je vidět proč

create index if not exists idx_payments_member on payments(member_id);
