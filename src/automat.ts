/**
 * Bezobslužný provoz: měsíc se uzavře sám, období se samo vyúčtuje.
 *
 * Běží z cronu vedle stahování z Fio. Dvě pravidla, na kterých to celé stojí:
 *
 * 1. **Nikdy nepřepsat, co už je hotové.** Uzavřený měsíc se znovu nezavírá
 *    a vyúčtované období se znovu nevyúčtovává. Kdyby ano, každý běh cronu
 *    by zamrazil dnešní čísla a uzávěrka by ztratila smysl.
 * 2. **Zavírat až po splatnosti následujícího měsíce.** Do té doby můžou
 *    dorazit opožděné platby; zamrazit měsíc dřív znamená zamrazit neúplný
 *    obrázek.
 *
 * Admin má poslední slovo: obojí jde na svých stránkách zrušit a udělat znovu
 * a obojí jde vypnout v Nastavení.
 */
import { podkladUzaverky } from './closings-page.js';
import {
  nactiNastaveni,
  nactiPrehled,
  nactiUzaverky,
  nactiVyuctovani,
  nactiZalohy,
  ulozUzaverku,
  ulozVyuctovani,
  zaplacenoOsobami,
  type Nastaveni,
  type Uzaverka,
} from './db.js';
import { cisloMesice, mesicNyni, posunMesic } from './money.js';
import { podkladVyuctovani, radkyKUlozeni, vyuctovatelneMesice } from './settlement-page.js';

/** Kdo je pod změnou podepsaný v auditu. Ať je poznat, že to nedělal člověk. */
export const AUTOMAT = 'automat (cron)';

/**
 * Je měsíc připravený k uzavření?
 *
 * Zavírá se **dnem splatnosti následujícího měsíce** — srpen tedy 20. září.
 * Ten měsíc navíc je schválně: platba poslaná na poslední chvíli se připíše
 * až za pár dní a bez té rezervy by uzávěrka zamrazila díru, která žádná není.
 */
export function lzeUzavrit(mesic: string, denSplatnosti: number, ted: Date): boolean {
  const zavira = posunMesic(mesic, 1);
  const dnes = mesicNyni(ted);
  if (cisloMesice(dnes) > cisloMesice(zavira)) return true;
  return cisloMesice(dnes) === cisloMesice(zavira) && ted.getDate() >= denSplatnosti;
}

/** Měsíce, které automat právě teď zavře — od počátku sledování, bez děr. */
export function mesiceKUzavreni(
  nastaveni: Nastaveni,
  uzaverky: Map<string, Uzaverka>,
  ted: Date,
): string[] {
  const mesice: string[] = [];
  for (let i = 0; ; i++) {
    const mesic = posunMesic(nastaveni.vyuctovani_od, i);
    if (!lzeUzavrit(mesic, nastaveni.den_splatnosti, ted)) break;
    // Hotový měsíc se přeskočí, ne přepíše — jinak by každý běh cronu
    // zamrazil dnešní čísla a uzávěrka by nic neznamenala.
    if (!uzaverky.has(mesic)) mesice.push(mesic);
    // Pojistka proti nekonečnu, kdyby byl počátek sledování hluboko v minulosti.
    if (i > 240) break;
  }
  return mesice;
}

export interface VysledekAutomatu {
  /** měsíce, které se právě uzavřely */
  uzavreno: string[];
  /** vyúčtované období, když na něj došlo */
  vyuctovano: { od: string; do: string } | null;
  /** co se dělo, lidsky — jde to rovnou do logu */
  popis: string;
}

/**
 * Jeden průchod: dozavírat měsíce a případně vyúčtovat období.
 *
 * Vrací i popis „nic k práci", protože ticho se nedá odlišit od poruchy.
 */
export async function dobehniAutomatiku(db: D1Database, ted = new Date()): Promise<VysledekAutomatu> {
  const nastaveni = await nactiNastaveni(db);
  const uzavreno: string[] = [];

  if (nastaveni.auto_uzaverka) {
    const uzaverky = await nactiUzaverky(db);
    const kUzavreni = mesiceKUzavreni(nastaveni, uzaverky, ted);
    if (kUzavreni.length > 0) {
      const [prehled, zalohy] = await Promise.all([nactiPrehled(db), nactiZalohy(db)]);
      for (const mesic of kUzavreni) {
        await ulozUzaverku(db, podkladUzaverky(prehled, zalohy, mesic), AUTOMAT);
        uzavreno.push(mesic);
      }
    }
  }

  let vyuctovano: VysledekAutomatu['vyuctovano'] = null;

  if (nastaveni.auto_vyuctovani) {
    // Znovu načíst: uzávěrky se právě mohly změnit a vyúčtování z nich čerpá.
    const [prehled, zalohy, uzaverky] = await Promise.all([
      nactiPrehled(db),
      nactiZalohy(db),
      nactiUzaverky(db),
    ]);
    const mozna = vyuctovatelneMesice(nastaveni, uzaverky, ted);

    // Vyúčtuje se, teprve když je celé období uzavřené. Kratší období by
    // znamenalo rozpouštět rozdíl z neúplných dat a posunout začátek dřív,
    // než mělo být.
    if (mozna.length >= nastaveni.vyuctovani_mesicu) {
      const konec = mozna[nastaveni.vyuctovani_mesicu - 1];
      if (konec !== undefined) {
        const zaplaceno = await zaplacenoOsobami(db, prehled, nastaveni.vyuctovani_od, konec);
        const podklad = podkladVyuctovani(prehled, zalohy, uzaverky, nastaveni, zaplaceno, konec, ted);
        // Bez rozhodnutí platí to, co má stránka předvybrané: rozpustit do
        // zálohy, a nedoplatek nad práh nechat k doplacení zvlášť.
        await ulozVyuctovani(
          db,
          { obdobi_od: podklad.od, obdobi_do: podklad.do, ...radkyKUlozeni(podklad, new Map()) },
          AUTOMAT,
        );
        vyuctovano = { od: podklad.od, do: podklad.do };
      }
    }
  }

  const casti: string[] = [];
  if (!nastaveni.auto_uzaverka) casti.push('automatické uzávěrky jsou vypnuté');
  else if (uzavreno.length > 0) casti.push(`uzavřeno ${uzavreno.join(', ')}`);
  if (!nastaveni.auto_vyuctovani) casti.push('automatické vyúčtování je vypnuté');
  else if (vyuctovano !== null) casti.push(`vyúčtováno ${vyuctovano.od} – ${vyuctovano.do}`);

  return {
    uzavreno,
    vyuctovano,
    popis: casti.length > 0 ? casti.join('; ') : 'nic k uzavření ani k vyúčtování',
  };
}

/** Kdy se uzavře běžící měsíc — na stránkách se to píše, ať se nikdo neptá. */
export function kdyZavreMesic(mesic: string, denSplatnosti: number): string {
  const zavira = posunMesic(mesic, 1);
  const [rok, cislo] = zavira.split('-');
  return `${denSplatnosti}. ${Number(cislo)}. ${rok}`;
}

/** Poslední měsíc, který ještě čeká na uzavření (nebo null, když se čeká na první). */
export const bezicMesic = (ted = new Date()): string => mesicNyni(ted);
