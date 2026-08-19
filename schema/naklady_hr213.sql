-- Skutečné náklady z tabulky „Náklady bydlení v H-R 213" (stav k 13. 8. 2026).
--   npx wrangler d1 execute fio-uhrady --remote --file schema/naklady_hr213.sql
--
-- Částky, periody a poznámky jsou opsané z tabulky. **Rozdělení mezi osoby
-- se tu nevyplňuje** — z tabulky nejde vyčíst, kdo se na čem skládá, a hádat
-- by znamenalo tvářit odhad jako fakt. Položky se proto v přehledu ukážou
-- jako „nerozděleno" a rozdělení se naklikne v aplikaci.
--
-- Opakované spuštění nic nezduplikuje.

insert or ignore into members (id, jmeno, je_platce, vs, pod_member_id) values
  (1, 'máma',   0, null,        null),
  (2, 'děda',   0, null,        null),
  (3, 'Lucka',  1, '213002003', null),   -- VS z testovacích plateb, v Nastavení lze změnit
  (4, 'Eliška', 0, null,        1);      -- nezletilá, podíl nese máma

insert or ignore into cost_items
  (id, nazev, kategorie, castka_celkem, perioda, druh, hradi_member_id, poznamka) values
  (1,  'Inkaso (elektřina, plyn)',     'Energie', 800000, 'mesicne',    'pravidelny', null, 'v tabulce: celkem 8 000 Kč, z toho mé náklady 4 000 Kč'),
  (2,  'VaK (voda)',                   'Energie',  70000, 'mesicne',    'pravidelny', null, 'měsíční záloha'),
  (3,  'Stočné',                       'Energie',      0, 'rocne',      'pravidelny', 2,    'platí děda — částku doplnit'),
  (4,  'Uhlí',                         'Energie',      0, 'rocne',      'pravidelny', 2,    'platí děda — částku doplnit'),
  (5,  'Internet',                     'Služby',   29900, 'mesicne',    'pravidelny', null, 'bude dražší za 2 měsíce'),
  (6,  'Pojištění domu',               'Dům',     182100, 'ctvrtletne', 'pravidelny', null, null),
  (7,  'Televize, rozhlas (poplatky)', 'Služby',   20500, 'mesicne',    'pravidelny', null, null),
  (8,  'Odpady obci',                  'Dům',     240000, 'rocne',      'pravidelny', null, '800 Kč za osobu a rok'),
  (9,  'Daň z nemovitostí',            'Dům',     380700, 'rocne',      'pravidelny', null, 'platí se z pachtovného (4 659 Kč za r. 2025), platí ZEV Šaratice na mBank'),
  (10, 'Magenta — televize',           'Služby',   19900, 'mesicne',    'pravidelny', null, 'bude dražší za 2 měsíce'),
  (11, 'Netflix',                      'Služby',    9900, 'mesicne',    'pravidelny', null, 'přes Štěpána');

insert into audit_log (kdo, akce, entita, entita_id, popis)
  values ('import', 'import', 'polozka', null,
          'Nahrány náklady z tabulky Náklady bydlení v H-R 213 (11 položek, bez rozdělení mezi osoby)');
