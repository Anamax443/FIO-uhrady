-- Rod pro oslovení. POZOR: `--file` na ostré databázi neprojde
-- (Authentication error 10000), příkaz se pouští takhle:
--   npx wrangler d1 execute fio-uhrady --remote --command "alter table members add column rod text"
--
-- Aplikace dřív odhadovala rod z toho, jestli jméno končí na „a". To je
-- nespolehlivé (Nikola, Saša, Jarda) a v kódu to nemá co dělat. Když rod
-- není vyplněný, mluví appka **neutrálně** — nic se nehádá.

alter table members add column rod text;   -- 'zena' | 'muz' | null = mluvit neutrálně
