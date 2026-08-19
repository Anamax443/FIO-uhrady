/**
 * Vzorová data pro frontend admina.
 *
 * Zatím se stránka kreslí z tohoto souboru — vazba na D1 přijde potom.
 * Až se zapojí databáze, vymění se jen zdroj `nactiPrehled()`; tvar dat
 * (a tím celý layout) zůstane stejný.
 *
 * Čísla vycházejí z tabulky „Náklady bydlení v H-R 213"; rozpad na jednotky
 * je ilustrativní — od toho je editace.
 */
import type { Perioda, Rezim } from './money.js';

export interface Osoba {
  id: number;
  jmeno: string;
}

/** Platební jednotka: jeden člověk, nebo kumulace víc lidí („máma + Eliška"). */
export interface Jednotka {
  id: number;
  label: string;
  vs: string | null;
  osoby: number[];
}

export interface Podil {
  unit_id: number;
  rezim: Rezim;
  hodnota: number; // procento: setiny % (5000 = 50 %) | castka: haléře
}

export interface Polozka {
  id: number;
  nazev: string;
  kategorie: string | null;
  castka_celkem: number; // haléře za jedno období
  perioda: Perioda;
  hradi_unit_id: number | null;
  poznamka: string | null;
  podily: Podil[];
}

export interface Prehled {
  nazev_domu: string;
  osoby: Osoba[];
  jednotky: Jednotka[];
  polozky: Polozka[];
}

const OSOBY: Osoba[] = [
  { id: 1, jmeno: 'máma' },
  { id: 2, jmeno: 'děda' },
  { id: 3, jmeno: 'Lucka' },
  { id: 4, jmeno: 'Eliška' },
];

const JEDNOTKY: Jednotka[] = [
  { id: 1, label: 'Lucka', vs: '2131', osoby: [3] },
  { id: 2, label: 'máma + Eliška', vs: '2132', osoby: [1, 4] },
  { id: 3, label: 'děda', vs: null, osoby: [2] },
];

const pct = (unit_id: number, procenta: number): Podil => ({
  unit_id,
  rezim: 'procento',
  hodnota: procenta * 100,
});
const kc = (unit_id: number, korun: number): Podil => ({
  unit_id,
  rezim: 'castka',
  hodnota: korun * 100,
});

const POLOZKY: Polozka[] = [
  {
    id: 1,
    nazev: 'Inkaso (elektřina, plyn)',
    kategorie: 'Energie',
    castka_celkem: 800000,
    perioda: 'mesicne',
    hradi_unit_id: 1,
    poznamka: null,
    podily: [pct(1, 50), pct(2, 50)],
  },
  {
    id: 2,
    nazev: 'VaK (voda)',
    kategorie: 'Energie',
    castka_celkem: 70000,
    perioda: 'mesicne',
    hradi_unit_id: 1,
    poznamka: 'měsíční záloha',
    podily: [pct(1, 50), pct(2, 50)],
  },
  {
    id: 3,
    nazev: 'Stočné',
    kategorie: 'Energie',
    castka_celkem: 0,
    perioda: 'rocne',
    hradi_unit_id: 3,
    poznamka: 'platí děda — částku doplnit',
    podily: [],
  },
  {
    id: 4,
    nazev: 'Uhlí',
    kategorie: 'Energie',
    castka_celkem: 0,
    perioda: 'rocne',
    hradi_unit_id: 3,
    poznamka: 'platí děda — částku doplnit',
    podily: [],
  },
  {
    id: 5,
    nazev: 'Internet (FTTx 1000)',
    kategorie: 'Služby',
    castka_celkem: 29900,
    perioda: 'mesicne',
    hradi_unit_id: 1,
    poznamka: 'bude dražší za 2 měsíce',
    podily: [pct(1, 100)],
  },
  {
    id: 6,
    nazev: 'Pojištění domu',
    kategorie: 'Dům',
    castka_celkem: 182100,
    perioda: 'ctvrtletne',
    hradi_unit_id: 1,
    poznamka: null,
    podily: [pct(1, 50), pct(2, 50)],
  },
  {
    id: 7,
    nazev: 'Televize, rozhlas (poplatky)',
    kategorie: 'Služby',
    castka_celkem: 20500,
    perioda: 'mesicne',
    hradi_unit_id: 1,
    poznamka: null,
    podily: [pct(1, 100)],
  },
  {
    id: 8,
    nazev: 'Odpady obci',
    kategorie: 'Dům',
    castka_celkem: 240000,
    perioda: 'rocne',
    hradi_unit_id: 1,
    poznamka: '800 Kč za osobu a rok',
    podily: [kc(1, 800), kc(2, 1600)],
  },
  {
    id: 9,
    nazev: 'Daň z nemovitostí',
    kategorie: 'Dům',
    castka_celkem: 380700,
    perioda: 'rocne',
    hradi_unit_id: 1,
    poznamka: 'platí se z pachtovného (4 659 Kč za r. 2025), platí ZEV Šaratice na mBank',
    podily: [pct(1, 100)],
  },
  {
    id: 10,
    nazev: 'Magenta — televize',
    kategorie: 'Služby',
    castka_celkem: 19900,
    perioda: 'mesicne',
    hradi_unit_id: 1,
    poznamka: 'bude dražší za 2 měsíce',
    podily: [pct(1, 100)],
  },
  {
    id: 11,
    nazev: 'Netflix',
    kategorie: 'Služby',
    castka_celkem: 9900,
    perioda: 'mesicne',
    hradi_unit_id: 1,
    poznamka: 'přes Štěpána',
    podily: [pct(1, 100)],
  },
];

export const vzorovyPrehled = (): Prehled => ({
  nazev_domu: 'H-R 213',
  osoby: OSOBY,
  jednotky: JEDNOTKY,
  polozky: POLOZKY,
});
