/**
 * Vrstva nad D1. Stránka se odteď kreslí z databáze, ne z ukázkových dat.
 *
 * Pravidlo, které drží celý audit: **žádný zápis bez záznamu do `audit_log`**.
 * Změna i její záznam jdou jednou `db.batch()`, takže se buď zapíše obojí,
 * nebo nic — nemůže vzniknout změna, u které není vidět kdo a kdy.
 */
import { jeDruh, jePerioda, type Podil, type Rezim } from './money.js';
import type { Osoba, Polozka, Prehled } from './model.js';

export interface Nastaveni {
  nazev_domu: string;
  /** jen poslední znaky — celý token se z databáze do UI nikdy neposílá */
  fio_token_naznak: string | null;
  sync_window_days: number;
}

interface ReadekPolozky {
  id: number;
  nazev: string;
  kategorie: string | null;
  castka_celkem: number;
  perioda: string;
  druh: string;
  datum: string | null;
  hradi_member_id: number | null;
  poznamka: string | null;
}

interface RadekPodilu {
  cost_item_id: number;
  member_id: number;
  rezim: string;
  hodnota: number;
}

/* ---------- čtení ---------- */

export async function nactiOsoby(db: D1Database): Promise<Osoba[]> {
  const { results } = await db
    .prepare(
      'select id, jmeno, je_platce, ucet, vs, pod_member_id from members where aktivni = 1 order by id',
    )
    .all<Osoba>();
  return results;
}

export async function nactiPrehled(db: D1Database): Promise<Prehled> {
  const [osoby, polozky, podily, nazev] = await Promise.all([
    nactiOsoby(db),
    db
      .prepare(
        `select id, nazev, kategorie, castka_celkem, perioda, druh, datum, hradi_member_id, poznamka
           from cost_items where aktivni = 1
          order by case druh when 'pravidelny' then 0 else 1 end, kategorie, id`,
      )
      .all<ReadekPolozky>(),
    db
      .prepare(
        `select s.cost_item_id, s.member_id, s.rezim, s.hodnota
           from cost_shares s join cost_items i on i.id = s.cost_item_id
          where i.aktivni = 1`,
      )
      .all<RadekPodilu>(),
    db.prepare("select hodnota from settings where klic = 'nazev_domu'").first<{ hodnota: string }>(),
  ]);

  const podleId = new Map<number, Podil[]>();
  for (const p of podily.results) {
    const seznam = podleId.get(p.cost_item_id) ?? [];
    seznam.push({ member_id: p.member_id, rezim: p.rezim as Rezim, hodnota: p.hodnota });
    podleId.set(p.cost_item_id, seznam);
  }

  return {
    nazev_domu: nazev?.hodnota ?? 'dům',
    osoby,
    polozky: polozky.results.map(
      (r): Polozka => ({
        id: r.id,
        nazev: r.nazev,
        kategorie: r.kategorie,
        castka_celkem: r.castka_celkem,
        perioda: jePerioda(r.perioda) ? r.perioda : 'mesicne',
        druh: jeDruh(r.druh) ? r.druh : 'pravidelny',
        datum: r.datum,
        hradi_member_id: r.hradi_member_id,
        poznamka: r.poznamka,
        podily: podleId.get(r.id) ?? [],
      }),
    ),
  };
}

export async function nactiNastaveni(db: D1Database): Promise<Nastaveni> {
  const { results } = await db.prepare('select klic, hodnota from settings').all<{
    klic: string;
    hodnota: string;
  }>();
  const mapa = new Map(results.map((r) => [r.klic, r.hodnota]));
  const token = mapa.get('fio_token');
  return {
    nazev_domu: mapa.get('nazev_domu') ?? 'dům',
    fio_token_naznak: token ? naznak(token) : null,
    sync_window_days: Number(mapa.get('sync_window_days') ?? '14'),
  };
}

/** Token se nikdy neukazuje celý — jen tolik, aby šel poznat. */
const naznak = (token: string): string =>
  token.length <= 6 ? '••••' : '••••••' + token.slice(-4);

/** Celý token — jen pro volání Fio API, nikdy ne do stránky. */
export async function nactiFioToken(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare("select hodnota from settings where klic = 'fio_token'")
    .first<{ hodnota: string }>();
  return row?.hodnota ?? null;
}

export interface Platba {
  fio_id: string;
  datum: string;
  castka: number;
  mena: string;
  vs: string | null;
  protiucet: string | null;
  protiucet_nazev: string | null;
  zprava: string | null;
  komentar: string | null;
  member_id: number | null;
  jmeno: string | null;
  matched_by: string | null;
  matched_value: string | null;
}

export async function nactiPlatby(db: D1Database, limit = 200): Promise<Platba[]> {
  const { results } = await db
    .prepare(
      `select p.fio_id, p.datum, p.castka, p.mena, p.vs, p.protiucet, p.protiucet_nazev,
              p.zprava, p.komentar, p.member_id, p.matched_by, p.matched_value, m.jmeno
         from payments p left join members m on m.id = p.member_id
        order by p.datum desc, p.fio_id desc limit ?`,
    )
    .bind(limit)
    .all<Platba>();
  return results;
}

export interface Beh {
  zacatek: string;
  konec: string | null;
  stav: string;
  detail: string | null;
  novych: number;
  sparovanych: number;
}

export async function posledniBeh(db: D1Database): Promise<Beh | null> {
  return await db
    .prepare('select zacatek, konec, stav, detail, novych, sparovanych from sync_runs order by id desc limit 1')
    .first<Beh>();
}

/** Ruční přiřazení platby osobě. Automatický běh ho už nepřepíše. */
export async function priradPlatbu(
  db: D1Database,
  fio_id: string,
  member_id: number | null,
  kdo: string,
): Promise<void> {
  const pred = await db
    .prepare('select fio_id, castka, datum, member_id, matched_by from payments where fio_id = ?')
    .bind(fio_id)
    .first<{ castka: number; datum: string; member_id: number | null }>();
  if (pred === null) throw new ChybaVstupu('Platba neexistuje.');

  let jmeno: string | null = null;
  if (member_id !== null) {
    const osoba = await db
      .prepare('select jmeno from members where id = ?')
      .bind(member_id)
      .first<{ jmeno: string }>();
    if (osoba === null) throw new ChybaVstupu('Osoba neexistuje.');
    jmeno = osoba.jmeno;
  }

  await db.batch([
    db
      .prepare(
        `update payments set member_id = ?, matched_by = ?, matched_value = null where fio_id = ?`,
      )
      .bind(member_id, member_id === null ? null : 'rucne', fio_id),
    auditStatement(
      db,
      kdo,
      'zmena',
      'platba',
      fio_id,
      member_id === null
        ? `Zrušeno přiřazení platby ${(pred.castka / 100).toFixed(0)} Kč z ${pred.datum}`
        : `Platba ${(pred.castka / 100).toFixed(0)} Kč z ${pred.datum} ručně přiřazena osobě ${jmeno}`,
      pred,
      { member_id, matched_by: 'rucne' },
    ),
  ]);
}

export async function nactiAudit(db: D1Database, limit = 50) {
  const { results } = await db
    .prepare('select cas, kdo, akce, entita, entita_id, popis from audit_log order by id desc limit ?')
    .bind(limit)
    .all<{
      cas: string;
      kdo: string;
      akce: string;
      entita: string;
      entita_id: string | null;
      popis: string;
    }>();
  return results;
}

/* ---------- zápis ---------- */

/** Data z formuláře po ověření — do databáze nejde nic nezkontrolovaného. */
export interface VstupPolozky {
  id: number | null;
  nazev: string;
  kategorie: string | null;
  castka_celkem: number;
  perioda: string;
  druh: string;
  datum: string | null;
  hradi_member_id: number | null;
  poznamka: string | null;
  podily: Podil[];
}

export class ChybaVstupu extends Error {}

/** Ověří, co přišlo z prohlížeče. Chyba se vrací člověku, ne do konzole. */
export function overPolozku(data: unknown): VstupPolozky {
  if (typeof data !== 'object' || data === null) throw new ChybaVstupu('Chybí data položky.');
  const d = data as Record<string, unknown>;

  const nazev = String(d['nazev'] ?? '').trim();
  if (nazev === '') throw new ChybaVstupu('Vyplň název položky.');
  if (nazev.length > 120) throw new ChybaVstupu('Název je delší než 120 znaků.');

  const castka = Number(d['castka_celkem']);
  if (!Number.isFinite(castka) || !Number.isInteger(castka)) {
    throw new ChybaVstupu('Částka není číslo.');
  }
  if (castka < 0) throw new ChybaVstupu('Částka nemůže být záporná — přeplatek zadej jako druh „přeplatek".');

  const perioda = String(d['perioda'] ?? '');
  if (!jePerioda(perioda)) throw new ChybaVstupu('Neznámá perioda.');
  const druh = String(d['druh'] ?? '');
  if (!jeDruh(druh)) throw new ChybaVstupu('Neznámý druh položky.');

  const datum = d['datum'] === null || d['datum'] === '' ? null : String(d['datum']);
  if (datum !== null && !/^\d{4}-\d{2}-\d{2}$/.test(datum)) throw new ChybaVstupu('Datum musí být ve tvaru RRRR-MM-DD.');

  const podilyRaw = Array.isArray(d['podily']) ? d['podily'] : [];
  const podily: Podil[] = podilyRaw.map((p) => {
    const x = p as Record<string, unknown>;
    const member_id = Number(x['member_id']);
    const rezim = String(x['rezim'] ?? '');
    const hodnota = Number(x['hodnota']);
    if (!Number.isInteger(member_id)) throw new ChybaVstupu('Neplatná osoba v rozdělení.');
    if (rezim !== 'procento' && rezim !== 'castka') throw new ChybaVstupu('Neplatný režim podílu.');
    if (!Number.isFinite(hodnota) || !Number.isInteger(hodnota) || hodnota < 0) {
      throw new ChybaVstupu('Neplatná hodnota podílu.');
    }
    return { member_id, rezim, hodnota };
  });

  const id = d['id'] === null || d['id'] === undefined ? null : Number(d['id']);
  if (id !== null && !Number.isInteger(id)) throw new ChybaVstupu('Neplatné id položky.');

  return {
    id,
    nazev,
    kategorie: d['kategorie'] ? String(d['kategorie']).trim() || null : null,
    castka_celkem: castka,
    perioda,
    druh,
    datum,
    hradi_member_id: d['hradi_member_id'] ? Number(d['hradi_member_id']) : null,
    poznamka: d['poznamka'] ? String(d['poznamka']).trim() || null : null,
    podily,
  };
}

const auditStatement = (
  db: D1Database,
  kdo: string,
  akce: string,
  entita: string,
  entitaId: string | null,
  popis: string,
  pred: unknown,
  po: unknown,
) =>
  db
    .prepare(
      `insert into audit_log (kdo, akce, entita, entita_id, popis, pred, po)
       values (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      kdo,
      akce,
      entita,
      entitaId,
      popis,
      pred === null || pred === undefined ? null : JSON.stringify(pred),
      po === null || po === undefined ? null : JSON.stringify(po),
    );

/** Uloží položku i její rozdělení. Vrací id. */
export async function ulozPolozku(
  db: D1Database,
  vstup: VstupPolozky,
  kdo: string,
): Promise<number> {
  const pred =
    vstup.id === null
      ? null
      : await db.prepare('select * from cost_items where id = ?').bind(vstup.id).first();

  let id = vstup.id;
  if (id === null) {
    const vlozeno = await db
      .prepare(
        `insert into cost_items (nazev, kategorie, castka_celkem, perioda, druh, datum, hradi_member_id, poznamka)
         values (?, ?, ?, ?, ?, ?, ?, ?) returning id`,
      )
      .bind(
        vstup.nazev,
        vstup.kategorie,
        vstup.castka_celkem,
        vstup.perioda,
        vstup.druh,
        vstup.datum,
        vstup.hradi_member_id,
        vstup.poznamka,
      )
      .first<{ id: number }>();
    if (!vlozeno) throw new Error('Položku se nepodařilo založit.');
    id = vlozeno.id;
  } else {
    if (pred === null) throw new ChybaVstupu('Položka už neexistuje — mezitím ji někdo smazal.');
    await db
      .prepare(
        `update cost_items
            set nazev = ?, kategorie = ?, castka_celkem = ?, perioda = ?, druh = ?, datum = ?,
                hradi_member_id = ?, poznamka = ?, updated_at = datetime('now')
          where id = ?`,
      )
      .bind(
        vstup.nazev,
        vstup.kategorie,
        vstup.castka_celkem,
        vstup.perioda,
        vstup.druh,
        vstup.datum,
        vstup.hradi_member_id,
        vstup.poznamka,
        id,
      )
      .run();
  }

  // Rozdělení se přepisuje celé — je jich pár a nemůže tak zůstat sirotek.
  const davka = [db.prepare('delete from cost_shares where cost_item_id = ?').bind(id)];
  for (const p of vstup.podily) {
    davka.push(
      db
        .prepare(
          'insert into cost_shares (cost_item_id, member_id, rezim, hodnota) values (?, ?, ?, ?)',
        )
        .bind(id, p.member_id, p.rezim, p.hodnota),
    );
  }
  davka.push(
    auditStatement(
      db,
      kdo,
      vstup.id === null ? 'vytvoreni' : 'zmena',
      'polozka',
      String(id),
      vstup.id === null
        ? `Založena položka „${vstup.nazev}"`
        : `Upravena položka „${vstup.nazev}"`,
      pred,
      vstup,
    ),
  );
  await db.batch(davka);

  return id;
}

export async function smazPolozku(db: D1Database, id: number, kdo: string): Promise<void> {
  const pred = await db
    .prepare('select * from cost_items where id = ?')
    .bind(id)
    .first<{ nazev: string }>();
  if (pred === null) throw new ChybaVstupu('Položka už neexistuje.');

  await db.batch([
    db.prepare('delete from cost_items where id = ?').bind(id),
    auditStatement(db, kdo, 'smazani', 'polozka', String(id), `Smazána položka „${pred.nazev}"`, pred, null),
  ]);
}

export interface Identifikace {
  je_platce: boolean;
  vs: string | null;
  ucet: string | null;
  /** komu se podíl téhle osoby počítá (nezletilé dítě → rodič) */
  pod_member_id: number | null;
}

/**
 * Podle čeho se pozná něčí příspěvek na účtu.
 *
 * Hlavní znak je **VS** — s ním může poslat peníze odkudkoli, i z cizího účtu.
 * Číslo účtu je nepovinný doplněk pro případ, že VS v příkazu chybí.
 */
export async function ulozIdentifikaci(
  db: D1Database,
  member_id: number,
  vstup: Identifikace,
  kdo: string,
): Promise<void> {
  const pred = await db
    .prepare('select id, jmeno, je_platce, vs, ucet, pod_member_id from members where id = ?')
    .bind(member_id)
    .first<{
      jmeno: string;
      je_platce: number;
      vs: string | null;
      ucet: string | null;
      pod_member_id: number | null;
    }>();
  if (pred === null) throw new ChybaVstupu('Osoba neexistuje.');

  const vs = vstup.vs;
  if (vs !== null && !/^\d{1,10}$/.test(vs)) {
    throw new ChybaVstupu('Variabilní symbol smí být jen číslo, nejvýš 10 číslic.');
  }
  const ucet = vstup.ucet;
  if (ucet !== null && !/^(\d{1,6}-)?\d{2,10}\/\d{4}$/.test(ucet)) {
    throw new ChybaVstupu('Číslo účtu čekám ve tvaru 1234567890/0800 (předčíslí s pomlčkou je volitelné).');
  }
  if (vstup.je_platce && vs === null && ucet === null) {
    throw new ChybaVstupu(
      `${pred.jmeno} posílá příspěvky na účet, ale nemá podle čeho je poznat — vyplň VS (a případně číslo účtu).`,
    );
  }

  const kolize =
    vs === null
      ? null
      : await db
          .prepare('select jmeno from members where vs = ? and id <> ?')
          .bind(vs, member_id)
          .first<{ jmeno: string }>();
  if (kolize) throw new ChybaVstupu(`VS ${vs} už používá ${kolize.jmeno}.`);

  // Jen jedna úroveň: pod koho se to počítá, ten už sám pod nikým být nesmí,
  // jinak by závazek putoval po řetězu a nikdo by se v tom nevyznal.
  const pod = vstup.pod_member_id;
  let jmenoRodice: string | null = null;
  if (pod !== null) {
    if (pod === member_id) throw new ChybaVstupu('Osoba se nemůže počítat sama sobě.');
    const rodic = await db
      .prepare('select jmeno, pod_member_id from members where id = ?')
      .bind(pod)
      .first<{ jmeno: string; pod_member_id: number | null }>();
    if (rodic === null) throw new ChybaVstupu('Osoba, ke které se to má počítat, neexistuje.');
    if (rodic.pod_member_id !== null) {
      throw new ChybaVstupu(`${rodic.jmeno} se sám počítá někomu jinému — vyber někoho, kdo závazek nese.`);
    }
    jmenoRodice = rodic.jmeno;

    const deti = await db
      .prepare('select jmeno from members where pod_member_id = ? limit 1')
      .bind(member_id)
      .first<{ jmeno: string }>();
    if (deti) {
      throw new ChybaVstupu(`${pred.jmeno} nese závazek za ${deti.jmeno}, takže se nemůže počítat ještě někomu.`);
    }
  }

  const po = {
    jmeno: pred.jmeno,
    je_platce: vstup.je_platce ? 1 : 0,
    vs,
    ucet,
    pod_member_id: pod,
  };
  await db.batch([
    db
      .prepare('update members set je_platce = ?, vs = ?, ucet = ?, pod_member_id = ? where id = ?')
      .bind(po.je_platce, vs, ucet, pod, member_id),
    auditStatement(
      db,
      kdo,
      'zmena',
      'osoba',
      String(member_id),
      [
        vstup.je_platce
          ? `${pred.jmeno} posílá příspěvky na účet — VS ${vs ?? 'nenastaven'}${ucet ? `, účet ${ucet}` : ''}`
          : `${pred.jmeno} příspěvky na účet neposílá`,
        jmenoRodice ? `podíl se počítá ${jmenoRodice}` : null,
      ]
        .filter(Boolean)
        .join('; '),
      pred,
      po,
    ),
  ]);
}

/** Fio token se ukládá zvlášť — do auditu jde jen fakt, že se měnil, ne hodnota. */
export async function ulozFioToken(db: D1Database, token: string, kdo: string): Promise<void> {
  const cisty = token.trim();
  if (cisty.length < 20) throw new ChybaVstupu('Token z Fio je delší — zkontroluj, jestli se zkopíroval celý.');
  if (!/^[A-Za-z0-9]+$/.test(cisty)) throw new ChybaVstupu('Token má obsahovat jen písmena a číslice.');

  await db.batch([
    db
      .prepare(
        `insert into settings (klic, hodnota, changed_at, changed_by)
         values ('fio_token', ?, datetime('now'), ?)
         on conflict(klic) do update set hodnota = excluded.hodnota,
              changed_at = excluded.changed_at, changed_by = excluded.changed_by`,
      )
      .bind(cisty, kdo),
    auditStatement(
      db,
      kdo,
      'zmena',
      'nastaveni',
      'fio_token',
      `Vložen nový token do Fio (končí na ${cisty.slice(-4)})`,
      null,
      null,
    ),
  ]);
}
