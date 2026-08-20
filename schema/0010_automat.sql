-- Bezobslužný provoz: měsíc se uzavře sám, období se samo vyúčtuje.
-- Spouští uživatel — POZOR, `--file` na ostré databázi neprojde
-- (Authentication error 10000), příkazy se pouštějí po jednom:
--   npx wrangler d1 execute fio-uhrady --remote --command "insert or ignore into settings (klic, hodnota) values ('auto_uzaverka', '1')"
--   npx wrangler d1 execute fio-uhrady --remote --command "insert or ignore into settings (klic, hodnota) values ('auto_vyuctovani', '1')"
--   npx wrangler d1 execute fio-uhrady --remote --command "insert or ignore into settings (klic, hodnota) values ('vyuctovani_mesicu', '12')"
--
-- Měsíc se zavírá až **den splatnosti následujícího měsíce** — do té doby
-- můžou dorazit opožděné platby a zamrazit ho dřív by znamenalo zamrazit
-- neúplný obrázek. Admin může uzávěrku i vyúčtování kdykoli zrušit a udělat
-- znovu; automat nikdy nepřepisuje to, co už je hotové.

insert or ignore into settings (klic, hodnota) values
  ('auto_uzaverka', '1'),      -- zavírat měsíce samo
  ('auto_vyuctovani', '1'),    -- vyúčtovat období samo, jakmile je celé uzavřené
  ('vyuctovani_mesicu', '12'); -- délka vyúčtovacího období v měsících
