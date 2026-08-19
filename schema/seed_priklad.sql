-- Volitelná výplň: osoby a náklady z tabulky „Náklady bydlení v H-R 213".
-- Spouští uživatel:
--   npx wrangler d1 execute fio-uhrady --remote --file schema/seed_priklad.sql
--
-- Rozdělení mezi osoby je odhad podle tabulky — po nasazení se doupraví v aplikaci.
-- Variabilní symboly jsou vymyšlené, přepiš je v Nastavení na skutečné.
-- Pustit až po 0001_init.sql. Opakované spuštění nic nezduplikuje.

insert or ignore into members (id, jmeno, vs) values
  (1, 'máma',   '2131'),
  (2, 'děda',   null),
  (3, 'Lucka',  '2133'),
  (4, 'Eliška', '2134');

-- Pravidelné náklady
insert or ignore into cost_items (id, nazev, kategorie, castka_celkem, perioda, druh, hradi_member_id, poznamka) values
  (1,  'Inkaso (elektřina, plyn)',    'Energie', 800000, 'mesicne',    'pravidelny', 3, null),
  (2,  'VaK (voda)',                  'Energie',  70000, 'mesicne',    'pravidelny', 3, 'měsíční záloha'),
  (3,  'Stočné',                      'Energie',      0, 'rocne',      'pravidelny', 2, 'platí děda — částku doplnit'),
  (4,  'Uhlí',                        'Energie',      0, 'rocne',      'pravidelny', 2, 'platí děda — částku doplnit'),
  (5,  'Internet (FTTx 1000)',        'Služby',   29900, 'mesicne',    'pravidelny', 3, 'bude dražší za 2 měsíce'),
  (6,  'Pojištění domu',              'Dům',     182100, 'ctvrtletne', 'pravidelny', 3, null),
  (7,  'Televize, rozhlas (poplatky)','Služby',   20500, 'mesicne',    'pravidelny', 1, null),
  (8,  'Odpady obci',                 'Dům',     240000, 'rocne',      'pravidelny', 3, '800 Kč za osobu a rok'),
  (9,  'Daň z nemovitostí',           'Dům',     380700, 'rocne',      'pravidelny', 3, 'platí se z pachtovného (4 659 Kč za r. 2025), platí ZEV Šaratice na mBank'),
  (10, 'Magenta — televize',          'Služby',   19900, 'mesicne',    'pravidelny', 3, 'bude dražší za 2 měsíce'),
  (11, 'Netflix',                     'Služby',    9900, 'mesicne',    'pravidelny', 3, 'přes Štěpána');

-- Jednorázové: do měsíčního průměru nevstupují, do dlužné částky ano
insert or ignore into cost_items (id, nazev, kategorie, castka_celkem, perioda, druh, datum, hradi_member_id, poznamka) values
  (12, 'Vyúčtování elektřiny 2025', 'Energie', 431200, 'jednorazove', 'nedoplatek',  '2026-03-14', 3, 'nedoplatek z ročního vyúčtování'),
  (13, 'Vyúčtování vody 2025',      'Energie', 118000, 'jednorazove', 'preplatek',   '2026-04-02', 3, 'přeplatek — snižuje dlužnou částku'),
  (14, 'Oprava kotle',              'Dům',     650000, 'jednorazove', 'jednorazovy', '2026-01-22', 3, 'výměna čerpadla');

-- Rozdělení: procenta v setinách procenta (5000 = 50 %), částky v haléřích
insert or ignore into cost_shares (cost_item_id, member_id, rezim, hodnota) values
  (1, 3, 'procento', 5000), (1, 1, 'procento', 2500), (1, 4, 'procento', 2500),
  (2, 3, 'procento', 5000), (2, 1, 'procento', 5000),
  (3, 2, 'procento', 10000),
  (4, 2, 'procento', 10000),
  (5, 3, 'procento', 10000),
  (6, 3, 'procento', 5000), (6, 2, 'procento', 5000),
  (7, 1, 'procento', 10000),
  (8, 3, 'castka', 80000), (8, 1, 'castka', 80000), (8, 4, 'castka', 80000),
  (9, 3, 'procento', 5000), (9, 2, 'procento', 5000),
  (10, 3, 'procento', 10000),
  (11, 3, 'procento', 5000), (11, 4, 'procento', 5000),
  (12, 3, 'procento', 5000), (12, 1, 'procento', 2500), (12, 4, 'procento', 2500),
  (13, 3, 'procento', 5000), (13, 1, 'procento', 5000),
  (14, 4, 'procento', 5000), (14, 2, 'procento', 5000);

insert into audit_log (kdo, akce, entita, entita_id, popis)
  values ('seed', 'import', 'polozka', null, 'Naplněna ukázková data z tabulky Náklady bydlení v H-R 213');
