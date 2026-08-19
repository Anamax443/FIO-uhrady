/**
 * Tvar dat, se kterým pracuje stránka. Databáze je do něj překládá v db.ts.
 *
 * Podíly ukazují na **osoby**, ne na pevné skupiny: na jedné položce se skládá
 * Lucka s dědou, na jiné Eliška s dědou. Kdo za koho posílá peníze z účtu,
 * je jiná vrstva a řeší se přes VS u osoby.
 */
import type { Druh, Perioda, Podil } from './money.js';

export type { Podil };

/**
 * Osoba, na kterou se dělí náklady. Rozdělení je kalkulace — ukazuje,
 * co dům stojí a na koho co padá.
 *
 * Peníze na účet ale reálně posílá jen někdo (`je_platce`). Jeho příspěvky
 * se poznají podle čísla účtu nebo VS a porovnají se s jeho podílem.
 */
export interface Osoba {
  id: number;
  jmeno: string;
  je_platce?: number;
  /** nepovinný doplněk k VS */
  ucet?: string | null;
  /** variabilní symbol — hlavní znak, s ním může poslat odkudkoli */
  vs?: string | null;
  /**
   * Komu se podíl téhle osoby počítá. Nezletilé dítě má vlastní podíl,
   * ať je vidět, co stojí — ale závazek nese rodič.
   */
  pod_member_id?: number | null;
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
  /** kdo fakturu fyzicky platí */
  hradi_member_id: number | null;
  poznamka: string | null;
  podily: Podil[];
}

export interface Prehled {
  nazev_domu: string;
  osoby: Osoba[];
  polozky: Polozka[];
}
