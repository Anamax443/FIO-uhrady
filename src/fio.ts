/**
 * Čtení pohybů z Fio REST API a jejich přiřazení k osobám.
 *
 * Stahuje se přes `periods/` s pevným oknem a překryvem, **ne** přes `last/`.
 * Kurzor u `last/` se posune na straně banky i tehdy, když nám selže zápis do
 * D1 — pohyby by pak zmizely a nikdo by si toho nevšiml. `periods/` je
 * bezstavové a dedup drží ID pohybu, takže se dá kdykoli přehrát.
 *
 * Ověřeno sondou proti reálnému účtu 2026-08-19: API vrací `column25`
 * (komentář, který k pohybu dopisuje majitel účtu) i u plateb bez VS.
 */
import type { Osoba } from './model.js';

const ZAKLAD = 'https://fioapi.fio.cz/v1/rest';

export interface PohybFio {
  fio_id: string;
  datum: string;
  castka: number; // haléře
  mena: string;
  vs: string | null;
  ks: string | null;
  ss: string | null;
  protiucet: string | null;
  protiucet_nazev: string | null;
  zprava: string | null;
  komentar: string | null;
  uziv_ident: string | null;
  raw: string;
}

export class ChybaFio extends Error {}

/**
 * Hlavička výpisu — číslo účtu, IBAN a zůstatek. Bere se z API, aby se
 * nikde neopisovala ručně; IBAN pak stačí na QR platbu.
 */
export interface UcetFio {
  ucet: string | null;      // '1234567890/2010'
  iban: string | null;
  bic: string | null;
  mena: string | null;
  zustatek: number | null;  // haléře
}

interface Pole {
  value: string | number | null;
}

type Zaznam = Record<string, Pole | null | undefined>;

const text = (z: Zaznam, klic: string): string | null => {
  const v = z[klic]?.value;
  if (v === null || v === undefined || v === '') return null;
  return String(v).trim();
};

/** Stáhne pohyby za období i hlavičku účtu. `od`/`do` ve tvaru 'YYYY-MM-DD'. */
export async function stahniPohyby(
  token: string,
  od: string,
  doDne: string,
): Promise<{ pohyby: PohybFio[]; ucet: UcetFio }> {
  const odpoved = await fetch(`${ZAKLAD}/periods/${token}/${od}/${doDne}/transactions.json`);

  if (!odpoved.ok) {
    // Hlášky mají dávat smysl i tomu, kdo Fio API nezná.
    if (odpoved.status === 409) {
      throw new ChybaFio('Fio API pustí jen jeden dotaz za 30 sekund. Zkus to za chvíli.');
    }
    if (odpoved.status === 404) {
      throw new ChybaFio('Fio API odmítlo token. Zkontroluj ho v Nastavení — možná byl zrušený.');
    }
    throw new ChybaFio(`Fio API vrátilo ${odpoved.status}.`);
  }

  const data = (await odpoved.json()) as {
    accountStatement?: {
      info?: Record<string, string | number | null>;
      transactionList?: { transaction?: Zaznam[] } | null;
    };
  };
  const seznam = data.accountStatement?.transactionList?.transaction ?? [];
  const info = data.accountStatement?.info ?? {};

  const cislo = info['accountId'] === undefined || info['accountId'] === null ? null : String(info['accountId']);
  const kodBanky = info['bankId'] === undefined || info['bankId'] === null ? null : String(info['bankId']);
  const zustatek = info['closingBalance'];

  const ucet: UcetFio = {
    ucet: cislo === null ? null : kodBanky === null ? cislo : `${cislo}/${kodBanky}`,
    iban: info['iban'] === undefined || info['iban'] === null ? null : String(info['iban']),
    bic: info['bic'] === undefined || info['bic'] === null ? null : String(info['bic']),
    mena: info['currency'] === undefined || info['currency'] === null ? null : String(info['currency']),
    zustatek: typeof zustatek === 'number' ? Math.round(zustatek * 100) : null,
  };

  const pohyby = seznam.map((z): PohybFio => {
    const castka = Number(z['column1']?.value ?? 0);
    const ucet = text(z, 'column2');
    const kod = text(z, 'column3');
    return {
      fio_id: String(z['column22']?.value ?? ''),
      datum: (text(z, 'column0') ?? '').slice(0, 10),
      castka: Math.round(castka * 100),
      mena: text(z, 'column14') ?? 'CZK',
      vs: text(z, 'column5'),
      ks: text(z, 'column4'),
      ss: text(z, 'column6'),
      protiucet: ucet === null ? null : kod === null ? ucet : `${ucet}/${kod}`,
      protiucet_nazev: text(z, 'column10'),
      zprava: text(z, 'column16'),
      komentar: text(z, 'column25'),
      uziv_ident: text(z, 'column7'),
      raw: JSON.stringify(z),
    };
  });

  return { pohyby, ucet };
}

export interface Shoda {
  member_id: number;
  matched_by: 'vs' | 'ucet' | 'komentar' | 'zprava' | 'uziv_ident';
  matched_value: string;
}

/**
 * Komu pohyb patří.
 *
 * Hlavní znak je VS — s ním může příspěvek přijít odkudkoli. Když v příkazu
 * chybí, hledá se číslo v komentáři (ten k pohybu dopisuje majitel účtu
 * v internetbankingu), pak ve zprávě pro příjemce a v uživatelské identifikaci.
 *
 * Z textu se berou **jen čísla, která odpovídají některému evidovanému VS** —
 * jinak by se do párování chytala náhodná čísla z poznámek (datum, částka,
 * číslo faktury protistrany).
 */
export function najdiOsobu(pohyb: PohybFio, osoby: Osoba[]): Shoda | null {
  const podleVs = new Map<string, number>();
  for (const o of osoby) if (o.vs) podleVs.set(o.vs, o.id);

  if (pohyb.vs !== null) {
    const id = podleVs.get(pohyb.vs);
    if (id !== undefined) return { member_id: id, matched_by: 'vs', matched_value: pohyb.vs };
  }

  if (pohyb.protiucet !== null) {
    const podleUctu = osoby.find((o) => o.ucet && o.ucet === pohyb.protiucet);
    if (podleUctu) {
      return { member_id: podleUctu.id, matched_by: 'ucet', matched_value: pohyb.protiucet };
    }
  }

  const zdroje: [Shoda['matched_by'], string | null][] = [
    ['komentar', pohyb.komentar],
    ['zprava', pohyb.zprava],
    ['uziv_ident', pohyb.uziv_ident],
  ];

  for (const [odkud, hodnota] of zdroje) {
    if (hodnota === null) continue;
    for (const kandidat of hodnota.match(/\d{1,10}/g) ?? []) {
      const id = podleVs.get(kandidat);
      if (id !== undefined) return { member_id: id, matched_by: odkud, matched_value: kandidat };
    }
  }

  return null;
}
