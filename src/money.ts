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
  unit_id: number;
  rezim: Rezim;
  hodnota: number;
}

export interface RozpadRadku {
  /** haléře připadající na jednotku, klíč = unit_id */
  naJednotku: Map<number, number>;
  /** co se nerozpustilo — nesmí zmizet potichu, jinak souhrn lže */
  nerozdeleno: number;
}

export function rozpad(celkem: number, podily: Podil[]): RozpadRadku {
  const naJednotku = new Map<number, number>();
  for (const p of podily) {
    const castka = p.rezim === 'castka' ? p.hodnota : Math.round((celkem * p.hodnota) / 10000);
    naJednotku.set(p.unit_id, (naJednotku.get(p.unit_id) ?? 0) + castka);
  }
  let sum = 0;
  for (const v of naJednotku.values()) sum += v;
  return { naJednotku, nerozdeleno: celkem - sum };
}
