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
  /** kam chodí vyúčtování */
  email?: string | null;
  /** kdo smí do správy a komu chodí souhrn za všechny */
  je_admin?: number;
  aktivni?: number;
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
  /**
   * Rozpouštění: nákup není spotřeba. Uhlí za 42 000 se protopí za rok, takže
   * se do měsíčních nákladů dává po dvanáctinách od `rozpustit_od`.
   * `rozpustit_mesicu` null = položka se nerozpouští.
   */
  rozpustit_od?: string | null;
  rozpustit_mesicu?: number | null;
  /**
   * 'ucet' = zaplaceno ze společného účtu (z peněz ze záloh),
   * 'osoba' = zaplatil to někdo ze svého a vzniká mu kredit.
   */
  zdroj_uhrady?: string;
}

export interface Prehled {
  nazev_domu: string;
  osoby: Osoba[];
  polozky: Polozka[];
}
