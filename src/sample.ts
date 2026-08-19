/**
 * Vzorová data pro frontend admina.
 *
 * Zatím se stránka kreslí z tohoto souboru — vazba na D1 přijde potom.
 * Až se zapojí databáze, vymění se jen zdroj; tvar dat (a tím celý layout)
 * zůstane stejný.
 *
 * Čísla vycházejí z tabulky „Náklady bydlení v H-R 213"; rozdělení mezi osoby
 * a jednorázové položky jsou ilustrativní — od toho je editace.
 *
 * Podíly ukazují na **osoby**, ne na pevné skupiny: na jedné položce se skládá
 * Lucka s dědou, na jiné Eliška s dědou. Kdo komu platí ze svého účtu (a pod
 * jakým VS) je samostatná věc a řeší se až s napojením plateb z Fio.
 */
import type { Druh, Perioda, Podil, Rezim } from './money.js';

export interface Osoba {
  id: number;
  jmeno: string;
}

export interface Polozka {
  id: number;
  nazev: string;
  kategorie: string | null;
  /** haléře za jedno období; u jednorázových celá částka */
  castka_celkem: number;
  perioda: Perioda;
  /** pravidelný náklad × jednorázový / nedoplatek / přeplatek */
  druh: Druh;
  /** 'YYYY-MM-DD' — u jednorázových kdy vznikly, ať se dá dohledat */
  datum: string | null;
  /** kdo fakturu fyzicky platí (osoba) */
  hradi_member_id: number | null;
  poznamka: string | null;
  podily: Podil[];
}

export interface Prehled {
  nazev_domu: string;
  osoby: Osoba[];
  polozky: Polozka[];
}

const MAMA = 1;
const DEDA = 2;
const LUCKA = 3;
const ELISKA = 4;

const OSOBY: Osoba[] = [
  { id: MAMA, jmeno: 'máma' },
  { id: DEDA, jmeno: 'děda' },
  { id: LUCKA, jmeno: 'Lucka' },
  { id: ELISKA, jmeno: 'Eliška' },
];

const pct = (member_id: number, procenta: number): Podil => ({
  member_id,
  rezim: 'procento' as Rezim,
  hodnota: Math.round(procenta * 100),
});
const kc = (member_id: number, korun: number): Podil => ({
  member_id,
  rezim: 'castka' as Rezim,
  hodnota: Math.round(korun * 100),
});

/** Zkratka, ať je v seznamu vidět položka a ne balast kolem ní. */
const p = (
  id: number,
  nazev: string,
  kategorie: string,
  korun: number,
  perioda: Perioda,
  podily: Podil[],
  extra: Partial<Pick<Polozka, 'druh' | 'datum' | 'hradi_member_id' | 'poznamka'>> = {},
): Polozka => ({
  id,
  nazev,
  kategorie,
  castka_celkem: Math.round(korun * 100),
  perioda,
  druh: extra.druh ?? 'pravidelny',
  datum: extra.datum ?? null,
  hradi_member_id: extra.hradi_member_id ?? LUCKA,
  poznamka: extra.poznamka ?? null,
  podily,
});

const POLOZKY: Polozka[] = [
  p(1, 'Inkaso (elektřina, plyn)', 'Energie', 8000, 'mesicne', [
    pct(LUCKA, 50),
    pct(MAMA, 25),
    pct(ELISKA, 25),
  ]),
  p(2, 'VaK (voda)', 'Energie', 700, 'mesicne', [pct(LUCKA, 50), pct(MAMA, 50)], {
    poznamka: 'měsíční záloha',
  }),
  p(3, 'Stočné', 'Energie', 0, 'rocne', [pct(DEDA, 100)], {
    hradi_member_id: DEDA,
    poznamka: 'platí děda — částku doplnit',
  }),
  p(4, 'Uhlí', 'Energie', 0, 'rocne', [pct(DEDA, 100)], {
    hradi_member_id: DEDA,
    poznamka: 'platí děda — částku doplnit',
  }),
  p(5, 'Internet (FTTx 1000)', 'Služby', 299, 'mesicne', [pct(LUCKA, 100)], {
    poznamka: 'bude dražší za 2 měsíce',
  }),
  p(6, 'Pojištění domu', 'Dům', 1821, 'ctvrtletne', [pct(LUCKA, 50), pct(DEDA, 50)]),
  p(7, 'Televize, rozhlas (poplatky)', 'Služby', 205, 'mesicne', [pct(MAMA, 100)], {
    hradi_member_id: MAMA,
  }),
  p(8, 'Odpady obci', 'Dům', 2400, 'rocne', [kc(LUCKA, 800), kc(MAMA, 800), kc(ELISKA, 800)], {
    poznamka: '800 Kč za osobu a rok',
  }),
  p(9, 'Daň z nemovitostí', 'Dům', 3807, 'rocne', [pct(LUCKA, 50), pct(DEDA, 50)], {
    poznamka: 'platí se z pachtovného (4 659 Kč za r. 2025), platí ZEV Šaratice na mBank',
  }),
  p(10, 'Magenta — televize', 'Služby', 199, 'mesicne', [pct(LUCKA, 100)], {
    poznamka: 'bude dražší za 2 měsíce',
  }),
  p(11, 'Netflix', 'Služby', 99, 'mesicne', [pct(LUCKA, 50), pct(ELISKA, 50)], {
    poznamka: 'přes Štěpána',
  }),

  // Jednorázové — do měsíčního průměru nevstupují, do dlužné částky ano.
  p(12, 'Vyúčtování elektřiny 2025', 'Energie', 4312, 'jednorazove', [
    pct(LUCKA, 50),
    pct(MAMA, 25),
    pct(ELISKA, 25),
  ], {
    druh: 'nedoplatek',
    datum: '2026-03-14',
    poznamka: 'nedoplatek z ročního vyúčtování',
  }),
  p(13, 'Vyúčtování vody 2025', 'Energie', 1180, 'jednorazove', [pct(LUCKA, 50), pct(MAMA, 50)], {
    druh: 'preplatek',
    datum: '2026-04-02',
    poznamka: 'přeplatek — snižuje dlužnou částku',
  }),
  p(14, 'Oprava kotle', 'Dům', 6500, 'jednorazove', [pct(ELISKA, 50), pct(DEDA, 50)], {
    druh: 'jednorazovy',
    datum: '2026-01-22',
    poznamka: 'výměna čerpadla',
  }),
];

export const vzorovyPrehled = (): Prehled => ({
  nazev_domu: 'H-R 213',
  osoby: OSOBY,
  polozky: POLOZKY,
});
