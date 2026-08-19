/**
 * Tvar dat, se kterým pracuje stránka. Databáze je do něj překládá v db.ts.
 *
 * Podíly ukazují na **osoby**, ne na pevné skupiny: na jedné položce se skládá
 * Lucka s dědou, na jiné Eliška s dědou. Kdo za koho posílá peníze z účtu,
 * je jiná vrstva a řeší se přes VS u osoby.
 */
import type { Druh, Perioda, Podil } from './money.js';

export type { Podil };

export interface Osoba {
  id: number;
  jmeno: string;
  /** variabilní symbol, kterým se poznají platby té osoby; null = neplatí přes účet */
  vs?: string | null;
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
