/**
 * Stažení pohybů z Fio a jejich přiřazení k osobám.
 *
 * Každý běh se zapisuje do `sync_runs` — i ten, který nic nenašel, i ten,
 * který spadl. Ze stavu musí být poznat rozdíl mezi „čeká", „nic nepřišlo"
 * a „nepovedlo se", ne jen ticho.
 */
import { najdiOsobu, stahniPohyby, type PohybFio } from './fio.js';
import { nactiOsoby, ulozNastaveni, ulozNastaveniTise } from './db.js';
import type { UcetFio } from './fio.js';

export interface VysledekSyncu {
  od: string;
  do: string;
  stazeno: number;
  novych: number;
  sparovanych: number;
  nesparovanych: number;
}

const den = (posun: number): string => {
  const d = new Date(Date.now() + posun * 86400_000);
  return d.toISOString().slice(0, 10);
};

/**
 * Okno se překrývá (default 14 dní zpět), aby se nic neztratilo, když jeden
 * běh spadne. Duplicity řeší primární klíč `fio_id`, ne kurzor.
 */
export async function synchronizuj(db: D1Database, token: string, dnuZpet: number): Promise<VysledekSyncu> {
  const od = den(-Math.max(1, dnuZpet));
  const doDne = den(0);

  const beh = await db
    .prepare("insert into sync_runs (obdobi_od, obdobi_do, stav) values (?, ?, 'bezi') returning id")
    .bind(od, doDne)
    .first<{ id: number }>();
  const behId = beh?.id ?? null;

  try {
    const { pohyby, ucet } = await stahniPohyby(token, od, doDne);
    const osoby = await nactiOsoby(db);

    // Číslo účtu a IBAN si bereme z API, ať se nikde neopisují ručně —
    // IBAN pak stačí na QR platbu. Zůstatek se mění pořád, proto se ukládá
    // potichu; změna čísla účtu je ale událost a patří do historie.
    await ulozUdajeUctu(db, ucet);

    let novych = 0;
    let sparovanych = 0;
    let nesparovanych = 0;

    for (const p of pohyby) {
      if (p.fio_id === '') continue;
      const shoda = najdiOsobu(p, osoby);
      if (shoda) sparovanych++;
      else nesparovanych++;
      novych += await ulozPohyb(db, p, shoda);
    }

    if (behId !== null) {
      await db
        .prepare(
          `update sync_runs set konec = datetime('now'), novych = ?, sparovanych = ?, stav = 'ok',
                  detail = ? where id = ?`,
        )
        .bind(
          novych,
          sparovanych,
          `Staženo ${pohyby.length} pohybů za ${od} až ${doDne}; nových ${novych}, ` +
            `přiřazeno ${sparovanych}, bez přiřazení ${nesparovanych}.`,
          behId,
        )
        .run();
    }

    return { od, do: doDne, stazeno: pohyby.length, novych, sparovanych, nesparovanych };
  } catch (err) {
    const popis = err instanceof Error ? err.message : String(err);
    if (behId !== null) {
      await db
        .prepare("update sync_runs set konec = datetime('now'), stav = 'chyba', detail = ? where id = ?")
        .bind(popis, behId)
        .run();
    }
    throw err;
  }
}

/**
 * Vloží pohyb, pokud ho ještě nemáme. Vrací 1 u nového, 0 u známého.
 *
 * U známého pohybu se přepisuje jen automatické přiřazení — ruční zásah
 * operátora (`matched_by = 'rucne'`) zůstává, jinak by ho příští běh přemazal.
 */
async function ulozPohyb(
  db: D1Database,
  p: PohybFio,
  shoda: ReturnType<typeof najdiOsobu>,
): Promise<number> {
  const znamy = await db
    .prepare('select fio_id, matched_by from payments where fio_id = ?')
    .bind(p.fio_id)
    .first<{ matched_by: string | null }>();

  if (znamy === null) {
    await db
      .prepare(
        `insert into payments (fio_id, datum, castka, mena, vs, ks, ss, protiucet, protiucet_nazev,
                               zprava, komentar, uziv_ident, raw, member_id, matched_by, matched_value, obdobi)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        p.fio_id, p.datum, p.castka, p.mena, p.vs, p.ks, p.ss, p.protiucet, p.protiucet_nazev,
        p.zprava, p.komentar, p.uziv_ident, p.raw,
        shoda?.member_id ?? null, shoda?.matched_by ?? null, shoda?.matched_value ?? null,
        // Předvyplní se měsíc, kdy platba přišla. Kdo platil za jiný měsíc,
        // přepíše si to v Úhradách; další běh to už nepřepíše zpátky, protože
        // se u známého pohybu `obdobi` nesahá.
        p.datum.slice(0, 7),
      )
      .run();
    return 1;
  }

  if (znamy.matched_by !== 'rucne' && shoda) {
    await db
      .prepare('update payments set member_id = ?, matched_by = ?, matched_value = ? where fio_id = ?')
      .bind(shoda.member_id, shoda.matched_by, shoda.matched_value, p.fio_id)
      .run();
  }
  return 0;
}

/** Uloží hlavičku účtu ze stahování. Zůstatek bez auditu, číslo účtu s ním. */
async function ulozUdajeUctu(db: D1Database, ucet: UcetFio): Promise<void> {
  if (ucet.zustatek !== null) {
    await ulozNastaveniTise(db, 'zustatek_uctu', String(ucet.zustatek));
    await ulozNastaveniTise(db, 'zustatek_k', new Date().toISOString());
  }

  for (const [klic, hodnota] of [
    ['ucet_domu', ucet.ucet],
    ['iban_domu', ucet.iban],
    ['bic_domu', ucet.bic],
  ] as const) {
    if (hodnota === null) continue;
    const stary = await db
      .prepare('select hodnota from settings where klic = ?')
      .bind(klic)
      .first<{ hodnota: string }>();
    if (stary?.hodnota === hodnota) continue;
    await ulozNastaveni(
      db,
      klic,
      hodnota,
      'stahování z Fio',
      stary === null
        ? `Z API zjištěn účet domácnosti (${klic}): ${hodnota}`
        : `Změnil se účet domácnosti (${klic}): ${stary.hodnota} → ${hodnota}`,
    );
  }
}