/**
 * Texty, které vidí člen domácnosti na svém přehledu — a které si správce
 * píše sám v Nastavení.
 *
 * Věty jako „přišlo míň, než mělo" nepatří do kódu: každá domácnost mluví
 * jinak a změna formulace nemá znamenat zásah do zdrojáku a nasazení.
 * V kódu zůstává jen **výchozí znění**, aby appka fungovala i bez nastavení;
 * cokoli vyplněného v Nastavení má přednost.
 */

export interface DefiniceTextu {
  klic: string;
  /** co ta věta znamená — ať je v Nastavení poznat, kdy se ukáže */
  popis: string;
  vychozi: string;
}

export const TEXTY: DefiniceTextu[] = [
  {
    klic: 'text_sedi',
    popis: 'Měsíc je zaplacený přesně',
    vychozi: 'sedí',
  },
  {
    klic: 'text_min',
    popis: 'Přišlo míň, než mělo',
    vychozi: 'přišlo míň, než mělo',
  },
  {
    klic: 'text_nic',
    popis: 'V měsíci nepřišlo vůbec nic',
    vychozi: 'v tomhle měsíci nepřišlo nic',
  },
  {
    klic: 'text_navic',
    popis: 'Přišlo víc, než mělo',
    vychozi: 'poslané navíc se odečte',
  },
  {
    klic: 'text_nesplatne',
    popis: 'Měsíc ještě není po splatnosti',
    vychozi: 'ještě není splatné',
  },
  {
    klic: 'text_predplaceno',
    popis: 'Po tomhle měsíci je předplaceno (přidá se za větu výš)',
    vychozi: 'po tomhle měsíci máš předplaceno',
  },
  {
    klic: 'text_qr_pod',
    popis: 'Vysvětlení pod QR kódem',
    vychozi:
      'Naskenuj v mobilní bance — částka i variabilní symbol se vyplní samy. ' +
      'Když máš trvalý příkaz, tohle potřebovat nebudeš; hodí se na doplatek.',
  },
];

/** Doplní výchozí znění tam, kde v nastavení nic není. */
export function slozTexty(ulozene: Map<string, string>): Record<string, string> {
  const vysledek: Record<string, string> = {};
  for (const t of TEXTY) {
    const hodnota = (ulozene.get(t.klic) ?? '').trim();
    vysledek[t.klic] = hodnota === '' ? t.vychozi : hodnota;
  }
  return vysledek;
}

export const jeKlicTextu = (klic: string): boolean => TEXTY.some((t) => t.klic === klic);
