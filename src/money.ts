/** Peníze držíme v haléřích (integer). U rozúčtování se nesmí zaokrouhlovat náhodou. */

export const PERIODY = ['mesicne', 'ctvrtletne', 'pololetne', 'rocne', 'jednorazove'] as const;
export type Perioda = (typeof PERIODY)[number];

const POPIS: Record<Perioda, string> = {
  mesicne: 'měsíčně',
  ctvrtletne: 'čtvrtletně',
  pololetne: 'pololetně',
  rocne: 'ročně',
  jednorazove: 'jednorázově',
};

const DELITEL: Record<Perioda, number> = {
  mesicne: 1,
  ctvrtletne: 3,
  pololetne: 6,
  rocne: 12,
  jednorazove: 0,
};

export const jePerioda = (v: string): v is Perioda => (PERIODY as readonly string[]).includes(v);
export const popisPeriody = (p: Perioda): string => POPIS[p];

/**
 * Druh položky. Pravidelný náklad se rozpouští do měsíčního průměru;
 * zbylé tři jsou jednorázové a promítnou se rovnou do dlužné částky.
 * Přeplatek jde do mínusu — dluh snižuje.
 */
export const DRUHY = ['pravidelny', 'jednorazovy', 'nedoplatek', 'preplatek'] as const;
export type Druh = (typeof DRUHY)[number];

const POPIS_DRUHU: Record<Druh, string> = {
  pravidelny: 'pravidelný',
  jednorazovy: 'jednorázový',
  nedoplatek: 'nedoplatek',
  preplatek: 'přeplatek',
};

export const popisDruhu = (d: Druh): string => POPIS_DRUHU[d];
export const jeDruh = (v: string): v is Druh => (DRUHY as readonly string[]).includes(v);

/** Přeplatek snižuje dluh, všechno ostatní ho zvyšuje. */
export const znamenko = (d: Druh): number => (d === 'preplatek' ? -1 : 1);

/** Jednorázové věci nepatří do měsíčního průměru — jinak by průměr skákal. */
export const jeJednorazovy = (d: Druh): boolean => d !== 'pravidelny';

/**
 * „+1 200 Kč" / „−1 200 Kč" — u salda musí být znaménko vidět.
 * Znaménko se řídí zobrazenou korunou, ne haléři: pár haléřů ze zaokrouhlení
 * by jinak vypadalo jako „−0 Kč", což čte jako chyba.
 */
export const formatKcZnamenko = (halere: number): string => {
  const koruny = Math.round(halere / 100);
  return (koruny > 0 ? '+' : koruny < 0 ? '−' : '') + formatKc(Math.abs(halere));
};

/** Kolik z částky za dané období připadá na měsíc. Jednorázové se do měsíčního průměru nepočítá. */
export function mesicne(castka: number, perioda: Perioda): number {
  const d = DELITEL[perioda];
  return d === 0 ? 0 : Math.round(castka / d);
}

const KC = new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'CZK',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** 400000 → „4 000 Kč". Haléře se v přehledu neukazují, v datech zůstávají. */
export const formatKc = (halere: number): string => KC.format(halere / 100);

/** „4 000,50" i „4000.5" i „4 000 Kč" → haléře. null = nedá se přečíst. */
export function parseCastka(vstup: string): number | null {
  const cisty = vstup.replace(/\s| |Kč|kč/g, '').replace(',', '.');
  if (cisty === '') return null;
  const n = Number(cisty);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Procenta držíme v setinách procenta: 5000 = 50 %. */
export const formatProcento = (setiny: number): string =>
  (setiny / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });

export function parseProcento(vstup: string): number | null {
  const cisty = vstup.replace(/\s|%/g, '').replace(',', '.');
  if (cisty === '') return null;
  const n = Number(cisty);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export type Rezim = 'procento' | 'castka';

export interface Podil {
  /** osoba, ne pevná skupina — kombinace se u každé položky liší */
  member_id: number;
  rezim: Rezim;
  hodnota: number;
}

export interface RozpadRadku {
  /** haléře připadající na osobu, klíč = member_id */
  naOsobu: Map<number, number>;
  /** co se nerozpustilo — nesmí zmizet potichu, jinak souhrn lže */
  nerozdeleno: number;
}

export function rozpad(celkem: number, podily: Podil[]): RozpadRadku {
  const naOsobu = new Map<number, number>();

  // Když je všechno v procentech a dají dohromady přesně 100 %, rozdělí se
  // částka do posledního haléře metodou největšího zbytku. Bez toho by
  // třetina ze 299 Kč (33,33 + 33,33 + 33,34 %) skončila o haléř vedle
  // a v přehledu by svítilo „nerozděleno −0 Kč".
  const vseProcenta = podily.length > 0 && podily.every((p) => p.rezim === 'procento');
  const soucetProcent = podily.reduce((a, p) => a + p.hodnota, 0);

  if (vseProcenta && soucetProcent === 10000) {
    const casti = podily.map((p) => {
      const presne = (celkem * p.hodnota) / 10000;
      const dolu = Math.floor(presne);
      return { member_id: p.member_id, dolu, zbytek: presne - dolu };
    });
    let zbyva = celkem - casti.reduce((a, c) => a + c.dolu, 0);
    // Haléře navíc dostanou ti s největším zbytkem po zaokrouhlení dolů.
    for (const c of [...casti].sort((a, b) => b.zbytek - a.zbytek)) {
      const pridat = zbyva > 0 ? 1 : 0;
      zbyva -= pridat;
      naOsobu.set(c.member_id, (naOsobu.get(c.member_id) ?? 0) + c.dolu + pridat);
    }
    return { naOsobu, nerozdeleno: 0 };
  }

  for (const p of podily) {
    const castka = p.rezim === 'castka' ? p.hodnota : Math.round((celkem * p.hodnota) / 10000);
    naOsobu.set(p.member_id, (naOsobu.get(p.member_id) ?? 0) + castka);
  }
  let sum = 0;
  for (const v of naOsobu.values()) sum += v;
  return { naOsobu, nerozdeleno: celkem - sum };
}
