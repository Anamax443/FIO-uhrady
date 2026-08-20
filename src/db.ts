/**
 * Vrstva nad D1. Stránka se odteď kreslí z databáze, ne z ukázkových dat.
 *
 * Pravidlo, které drží celý audit: **žádný zápis bez záznamu do `audit_log`**.
 * Změna i její záznam jdou jednou `db.batch()`, takže se buď zapíše obojí,
 * nebo nic — nemůže vzniknout změna, u které není vidět kdo a kdy.
 */
import { vlozenoZeSveho } from './admin-page.js';
import { jeDruh, jePerioda, mesicNyni, posunMesic, type Podil, type Rezim } from './money.js';
import type { Osoba, Polozka, Prehled } from './model.js';

export interface Nastaveni {
  nazev_domu: string;
  /** jen poslední znaky — celý token se z databáze do UI nikdy neposílá */
  fio_token_naznak: string | null;
  sync_window_days: number;
  /** od kterého měsíce se počítají příspěvky, 'YYYY-MM' */
  vyuctovani_od: string;
  /** kolikátého v měsíci je příspěvek splatný */
  den_splatnosti: number;
  /** rezerva v záloze na neplánované nákupy, v procentech */
  rezerva_procent: number;
  /** nedoplatek do téhle výše se rozpustí do zálohy, nad ni se appka zeptá (haléře) */
  prah_doplatku: number;
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
  rozpustit_od: string | null;
  rozpustit_mesicu: number | null;
  zdroj_uhrady: string;
}

interface RadekPodilu {
  cost_item_id: number;
  member_id: number;
  rezim: string;
  hodnota: number;
}

/* ---------- čtení ---------- */

export async function nactiOsoby(db: D1Database, iNeaktivni = false): Promise<Osoba[]> {
  const { results } = await db
    .prepare(
      // `view_token` musí být v seznamu: bez něj Nastavení nepozná, že osoba
      // odkaz už má, a nabízelo by „Vytvořit odkaz" i po jeho vytvoření.
      `select id, jmeno, je_platce, ucet, vs, pod_member_id, email, je_admin, aktivni, view_token
         from members ${iNeaktivni ? '' : 'where aktivni = 1'} order by aktivni desc, id`,
    )
    .all<Osoba>();
  return results;
}

export class ChybaOsoby extends Error {}

/** Založí nebo přejmenuje osobu, nastaví e-mail a roli. */
export async function ulozOsobu(
  db: D1Database,
  vstup: { id: number | null; jmeno: string; email: string | null; je_admin: boolean; aktivni: boolean },
  kdo: string,
): Promise<number> {
  const jmeno = vstup.jmeno.trim();
  if (jmeno === '') throw new ChybaVstupu('Vyplň jméno osoby.');
  if (jmeno.length > 60) throw new ChybaVstupu('Jméno je delší než 60 znaků.');
  const email = vstup.email === null || vstup.email.trim() === '' ? null : vstup.email.trim();
  if (email !== null && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ChybaVstupu(`„${email}" nevypadá jako e-mailová adresa.`);
  }

  const stejne = await db
    .prepare('select id from members where jmeno = ? and id is not ?')
    .bind(jmeno, vstup.id)
    .first<{ id: number }>();
  if (stejne) throw new ChybaVstupu(`Osoba se jménem ${jmeno} už existuje.`);

  if (vstup.id === null) {
    const vlozeno = await db
      .prepare('insert into members (jmeno, email, je_admin, aktivni) values (?, ?, ?, ?) returning id')
      .bind(jmeno, email, vstup.je_admin ? 1 : 0, vstup.aktivni ? 1 : 0)
      .first<{ id: number }>();
    if (!vlozeno) throw new Error('Osobu se nepodařilo založit.');
    await db.batch([
      auditStatement(db, kdo, 'vytvoreni', 'osoba', String(vlozeno.id), `Přidána osoba ${jmeno}`, null, {
        jmeno,
        email,
      }),
    ]);
    return vlozeno.id;
  }

  const pred = await db.prepare('select * from members where id = ?').bind(vstup.id).first();
  if (pred === null) throw new ChybaVstupu('Osoba už neexistuje.');

  await db.batch([
    db
      .prepare('update members set jmeno = ?, email = ?, je_admin = ?, aktivni = ? where id = ?')
      .bind(jmeno, email, vstup.je_admin ? 1 : 0, vstup.aktivni ? 1 : 0, vstup.id),
    auditStatement(
      db,
      kdo,
      'zmena',
      'osoba',
      String(vstup.id),
      `Upravena osoba ${jmeno}${vstup.aktivni ? '' : ' (vyřazena z evidence)'}`,
      pred,
      { jmeno, email, je_admin: vstup.je_admin ? 1 : 0, aktivni: vstup.aktivni ? 1 : 0 },
    ),
  ]);
  return vstup.id;
}

/**
 * Kolik kdo do domácnosti vložil **za dané měsíce**. Klíč = member_id.
 *
 * Nejsou to jen příchozí platby na účet — započítá se i to, co někdo zaplatil
 * **ze svého** (položky se `zdroj_uhrady = 'osoba'`). Děda, který koupil uhlí
 * za 42 000 z vlastní kapsy, vložil do domácnosti stejně reálné peníze jako
 * ten, kdo pošle příkazem.
 *
 * Okno je povinné, protože po vyúčtování začíná nové období: bez něj by se
 * peníze poslané před vyúčtováním odečítaly od dluhu i potom, co už byly
 * jednou zúčtované.
 */
export async function zaplacenoOsobami(
  db: D1Database,
  prehled: Prehled,
  odMesice: string,
  doMesice: string = mesicNyni(),
): Promise<Map<number, number>> {
  // 'YYYY-MM-31' je bezpečná horní mez: řetězcově je >= každý skutečný den
  // toho měsíce a < prvního dne měsíce dalšího.
  const zBanky = await db
    .prepare(
      `select member_id, sum(castka) as soucet from payments
        where member_id is not null and castka > 0 and datum >= ? and datum <= ?
        group by member_id`,
    )
    .bind(`${odMesice}-01`, `${doMesice}-31`)
    .all<{ member_id: number; soucet: number }>();

  const soucty = new Map<number, number>();
  for (const r of zBanky.results) soucty.set(r.member_id, (soucty.get(r.member_id) ?? 0) + r.soucet);
  for (const [id, castka] of vlozenoZeSveho(prehled, odMesice, doMesice)) {
    soucty.set(id, (soucty.get(id) ?? 0) + castka);
  }
  return soucty;
}

export interface Zaloha {
  id: number;
  member_id: number;
  castka: number;
  plati_od: string;
  poznamka: string | null;
  created_at: string;
  created_by: string | null;
}

export async function nactiZalohy(db: D1Database): Promise<Zaloha[]> {
  const { results } = await db
    .prepare(
      `select id, member_id, castka, plati_od, poznamka, created_at, created_by
         from zalohy order by plati_od desc, member_id`,
    )
    .all<Zaloha>();
  return results;
}

/**
 * Záloha platná v daném měsíci = poslední, která začala nejpozději tehdy.
 * Historie se nepřepisuje, takže zpětný výpočet dluhu sedí na to,
 * co se v tom měsíci opravdu platilo.
 */
export function zalohaVMesici(zalohy: Zaloha[], member_id: number, mesic: string): number {
  const platne = zalohy
    .filter((z) => z.member_id === member_id && z.plati_od <= mesic)
    .sort((a, b) => (a.plati_od < b.plati_od ? 1 : -1));
  return platne[0]?.castka ?? 0;
}

export async function ulozZalohu(
  db: D1Database,
  vstup: { member_id: number; castka: number; plati_od: string; poznamka: string | null },
  kdo: string,
): Promise<void> {
  if (!Number.isInteger(vstup.castka) || vstup.castka < 0) {
    throw new ChybaVstupu('Záloha musí být nezáporné číslo.');
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(vstup.plati_od)) {
    throw new ChybaVstupu('Platnost zálohy čekám ve tvaru RRRR-MM.');
  }
  const osoba = await db
    .prepare('select jmeno from members where id = ?')
    .bind(vstup.member_id)
    .first<{ jmeno: string }>();
  if (osoba === null) throw new ChybaVstupu('Osoba neexistuje.');

  await db.batch([
    db
      .prepare(
        `insert into zalohy (member_id, castka, plati_od, poznamka, created_by)
         values (?, ?, ?, ?, ?)
         on conflict(member_id, plati_od) do update set castka = excluded.castka,
              poznamka = excluded.poznamka, created_by = excluded.created_by,
              created_at = datetime('now')`,
      )
      .bind(vstup.member_id, vstup.castka, vstup.plati_od, vstup.poznamka, kdo),
    auditStatement(
      db,
      kdo,
      'zmena',
      'zaloha',
      String(vstup.member_id),
      `Záloha ${osoba.jmeno}: ${(vstup.castka / 100).toLocaleString('cs-CZ')} Kč měsíčně od ${vstup.plati_od}`,
      null,
      vstup,
    ),
  ]);
}

export interface Uzaverka {
  obdobi: string;
  naklady_celkem: number;
  uzavreno_at: string;
  uzavrel: string | null;
  /** klíč = member_id */
  podily: Map<number, { podil: number; zaloha: number }>;
}

export async function nactiUzaverky(db: D1Database): Promise<Map<string, Uzaverka>> {
  const [hlavicky, podily] = await Promise.all([
    db
      .prepare('select obdobi, naklady_celkem, uzavreno_at, uzavrel from uzaverky order by obdobi')
      .all<{ obdobi: string; naklady_celkem: number; uzavreno_at: string; uzavrel: string | null }>(),
    db
      .prepare('select obdobi, member_id, podil, zaloha from uzaverka_podily')
      .all<{ obdobi: string; member_id: number; podil: number; zaloha: number }>(),
  ]);

  const mapa = new Map<string, Uzaverka>();
  for (const h of hlavicky.results) mapa.set(h.obdobi, { ...h, podily: new Map() });
  for (const p of podily.results) {
    mapa.get(p.obdobi)?.podily.set(p.member_id, { podil: p.podil, zaloha: p.zaloha });
  }
  return mapa;
}

export interface VstupUzaverky {
  obdobi: string;
  naklady_celkem: number;
  podily: { member_id: number; podil: number; zaloha: number }[];
  polozky: { cost_item_id: number; nazev: string; castka: number }[];
}

/** Zamrazí měsíc. Opakované uzavření přepíše, co v něm bylo — s novým záznamem v auditu. */
export async function ulozUzaverku(db: D1Database, vstup: VstupUzaverky, kdo: string): Promise<void> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(vstup.obdobi)) {
    throw new ChybaVstupu('Období čekám ve tvaru RRRR-MM.');
  }

  const davka = [
    db.prepare('delete from uzaverka_podily where obdobi = ?').bind(vstup.obdobi),
    db.prepare('delete from uzaverka_polozky where obdobi = ?').bind(vstup.obdobi),
    db
      .prepare(
        `insert into uzaverky (obdobi, naklady_celkem, uzavrel) values (?, ?, ?)
         on conflict(obdobi) do update set naklady_celkem = excluded.naklady_celkem,
              uzavreno_at = datetime('now'), uzavrel = excluded.uzavrel`,
      )
      .bind(vstup.obdobi, vstup.naklady_celkem, kdo),
  ];
  for (const p of vstup.podily) {
    davka.push(
      db
        .prepare('insert into uzaverka_podily (obdobi, member_id, podil, zaloha) values (?, ?, ?, ?)')
        .bind(vstup.obdobi, p.member_id, p.podil, p.zaloha),
    );
  }
  for (const p of vstup.polozky) {
    davka.push(
      db
        .prepare('insert into uzaverka_polozky (obdobi, cost_item_id, nazev, castka) values (?, ?, ?, ?)')
        .bind(vstup.obdobi, p.cost_item_id, p.nazev, p.castka),
    );
  }
  davka.push(
    auditStatement(
      db,
      kdo,
      'zmena',
      'uzaverka',
      vstup.obdobi,
      `Uzavřen měsíc ${vstup.obdobi} — náklady ${(vstup.naklady_celkem / 100).toLocaleString('cs-CZ')} Kč`,
      null,
      { obdobi: vstup.obdobi, naklady_celkem: vstup.naklady_celkem },
    ),
  );
  await db.batch(davka);
}

export async function zrusUzaverku(db: D1Database, obdobi: string, kdo: string): Promise<void> {
  const je = await db
    .prepare('select obdobi from uzaverky where obdobi = ?')
    .bind(obdobi)
    .first<{ obdobi: string }>();
  if (je === null) throw new ChybaVstupu('Tenhle měsíc uzavřený není.');

  await db.batch([
    db.prepare('delete from uzaverka_podily where obdobi = ?').bind(obdobi),
    db.prepare('delete from uzaverka_polozky where obdobi = ?').bind(obdobi),
    db.prepare('delete from uzaverky where obdobi = ?').bind(obdobi),
    auditStatement(
      db,
      kdo,
      'smazani',
      'uzaverka',
      obdobi,
      `Zrušena uzávěrka měsíce ${obdobi} — měsíc se zase počítá z aktuálního nastavení`,
      { obdobi },
      null,
    ),
  ]);
}

/* ---------- roční vyúčtování ---------- */

export type ZpusobVyrovnani = 'do_zalohy' | 'jednorazove';

export interface RadekVyuctovaniDb {
  member_id: number;
  predepsano: number;
  zaplaceno: number;
  skutecne: number;
  /** skutecne − zaplaceno; kladné = má doplatit */
  rozdil: number;
  zpusob: ZpusobVyrovnani;
  nova_zaloha: number;
  /** co zůstalo mimo zálohu; + = má doplatit, − = má k dobru */
  zustatek: number;
}

export interface Vyuctovani {
  obdobi_od: string;
  obdobi_do: string;
  vytvoreno_at: string;
  vytvoril: string | null;
  radky: RadekVyuctovaniDb[];
}

/** Vyúčtování od nejnovějšího. */
export async function nactiVyuctovani(db: D1Database): Promise<Vyuctovani[]> {
  const [hlavicky, radky] = await Promise.all([
    db
      .prepare('select obdobi_od, obdobi_do, vytvoreno_at, vytvoril from vyuctovani order by obdobi_do desc')
      .all<{ obdobi_od: string; obdobi_do: string; vytvoreno_at: string; vytvoril: string | null }>(),
    db
      .prepare(
        `select obdobi_do, member_id, predepsano, zaplaceno, skutecne, rozdil, zpusob, nova_zaloha, zustatek
           from vyuctovani_radky`,
      )
      .all<RadekVyuctovaniDb & { obdobi_do: string }>(),
  ]);

  const podleObdobi = new Map<string, Vyuctovani>();
  const seznam = hlavicky.results.map((h): Vyuctovani => {
    const v: Vyuctovani = { ...h, radky: [] };
    podleObdobi.set(h.obdobi_do, v);
    return v;
  });
  for (const r of radky.results) {
    const { obdobi_do, ...zbytek } = r;
    podleObdobi.get(obdobi_do)?.radky.push(zbytek);
  }
  return seznam;
}

/** Kolik komu po vyúčtováních zbývá mimo zálohu. + = má doplatit, − = má k dobru. */
export function zustatkyZVyuctovani(vyuctovani: Vyuctovani[]): Map<number, number> {
  const mapa = new Map<number, number>();
  for (const v of vyuctovani) {
    for (const r of v.radky) {
      if (r.zustatek !== 0) mapa.set(r.member_id, (mapa.get(r.member_id) ?? 0) + r.zustatek);
    }
  }
  return mapa;
}

export interface VstupVyuctovani {
  obdobi_od: string;
  obdobi_do: string;
  radky: RadekVyuctovaniDb[];
  /** komu vyúčtování stanoví novou zálohu — jen tomu, od koho příspěvky chodí */
  zalohy: { member_id: number; castka: number }[];
}

/**
 * Uzavře období: zamrazí čísla, stanoví nové zálohy a **posune počátek
 * sledování** za konec období. Všechno jednou dávkou — kdyby se posun
 * nastavení neuložil, počítal by se dluh za už vyúčtované měsíce znovu.
 */
export async function ulozVyuctovani(
  db: D1Database,
  vstup: VstupVyuctovani,
  kdo: string,
): Promise<void> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(vstup.obdobi_od) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(vstup.obdobi_do)) {
    throw new ChybaVstupu('Období čekám ve tvaru RRRR-MM.');
  }
  if (vstup.obdobi_do < vstup.obdobi_od) throw new ChybaVstupu('Konec období je před jeho začátkem.');

  const hotove = await db
    .prepare('select obdobi_do from vyuctovani where obdobi_do >= ? order by obdobi_do limit 1')
    .bind(vstup.obdobi_od)
    .first<{ obdobi_do: string }>();
  if (hotove !== null) {
    throw new ChybaVstupu(`Období do ${hotove.obdobi_do} už vyúčtované je — nejdřív ho zruš.`);
  }

  // Následující měsíc: od něj platí nové zálohy a od něj se počítá další období.
  const dalsi = posunMesic(vstup.obdobi_do, 1);

  const davka = [
    db
      .prepare('insert into vyuctovani (obdobi_do, obdobi_od, vytvoril) values (?, ?, ?)')
      .bind(vstup.obdobi_do, vstup.obdobi_od, kdo),
  ];
  for (const r of vstup.radky) {
    davka.push(
      db
        .prepare(
          `insert into vyuctovani_radky
             (obdobi_do, member_id, predepsano, zaplaceno, skutecne, rozdil, zpusob, nova_zaloha, zustatek)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          vstup.obdobi_do,
          r.member_id,
          r.predepsano,
          r.zaplaceno,
          r.skutecne,
          r.rozdil,
          r.zpusob,
          r.nova_zaloha,
          r.zustatek,
        ),
    );
  }
  for (const z of vstup.zalohy) {
    davka.push(
      db
        .prepare(
          `insert into zalohy (member_id, castka, plati_od, poznamka, created_by)
           values (?, ?, ?, ?, ?)
           on conflict(member_id, plati_od) do update set castka = excluded.castka,
                poznamka = excluded.poznamka, created_by = excluded.created_by,
                created_at = datetime('now')`,
        )
        .bind(z.member_id, z.castka, dalsi, `z vyúčtování ${vstup.obdobi_od} – ${vstup.obdobi_do}`, kdo),
    );
  }

  davka.push(
    db
      .prepare(
        `insert into settings (klic, hodnota, changed_at, changed_by) values ('vyuctovani_od', ?, datetime('now'), ?)
         on conflict(klic) do update set hodnota = excluded.hodnota,
              changed_at = excluded.changed_at, changed_by = excluded.changed_by`,
      )
      .bind(dalsi, kdo),
    auditStatement(
      db,
      kdo,
      'zmena',
      'vyuctovani',
      vstup.obdobi_do,
      `Vyúčtováno období ${vstup.obdobi_od} – ${vstup.obdobi_do}; nové zálohy platí od ${dalsi}`,
      null,
      vstup,
    ),
  );

  await db.batch(davka);
}

/**
 * Zruší vyúčtování a vrátí počátek sledování na začátek jeho období.
 *
 * Zrušit jde jen to poslední — starší by se nedalo vrátit, aniž by se
 * novější počítalo dvakrát. **Zálohy, které vyúčtování stanovilo, zůstávají**;
 * jsou to historická data a mění se na stránce Vyrovnání.
 */
export async function zrusVyuctovani(db: D1Database, obdobi_do: string, kdo: string): Promise<void> {
  const posledni = await db
    .prepare('select obdobi_od, obdobi_do from vyuctovani order by obdobi_do desc limit 1')
    .first<{ obdobi_od: string; obdobi_do: string }>();
  if (posledni === null) throw new ChybaVstupu('Žádné vyúčtování tu není.');
  if (posledni.obdobi_do !== obdobi_do) {
    throw new ChybaVstupu(`Zrušit jde jen poslední vyúčtování (do ${posledni.obdobi_do}).`);
  }

  await db.batch([
    db.prepare('delete from vyuctovani_radky where obdobi_do = ?').bind(obdobi_do),
    db.prepare('delete from vyuctovani where obdobi_do = ?').bind(obdobi_do),
    db
      .prepare(
        `insert into settings (klic, hodnota, changed_at, changed_by) values ('vyuctovani_od', ?, datetime('now'), ?)
         on conflict(klic) do update set hodnota = excluded.hodnota,
              changed_at = excluded.changed_at, changed_by = excluded.changed_by`,
      )
      .bind(posledni.obdobi_od, kdo),
    auditStatement(
      db,
      kdo,
      'smazani',
      'vyuctovani',
      obdobi_do,
      `Zrušeno vyúčtování ${posledni.obdobi_od} – ${obdobi_do}; sledování se vrátilo na ${posledni.obdobi_od}. Zálohy z něj zůstávají v platnosti.`,
      posledni,
      null,
    ),
  ]);
}

/**
 * Osobní odkaz na přehled. Token je náhodný a neuhodnutelný — kdo ho má,
 * vidí svoje čísla a souhrn za dům, nic o ostatních.
 */
export async function vytvorOdkaz(db: D1Database, member_id: number, kdo: string): Promise<string> {
  const osoba = await db
    .prepare('select jmeno, view_token from members where id = ?')
    .bind(member_id)
    .first<{ jmeno: string; view_token: string | null }>();
  if (osoba === null) throw new ChybaVstupu('Osoba neexistuje.');
  if (osoba.view_token) return osoba.view_token;

  const token = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  await db.batch([
    db.prepare('update members set view_token = ? where id = ?').bind(token, member_id),
    auditStatement(
      db,
      kdo,
      'vytvoreni',
      'odkaz',
      String(member_id),
      `Vytvořen osobní odkaz pro ${osoba.jmeno}`,
      null,
      null,
    ),
  ]);
  return token;
}

/** Zneplatní odkaz — třeba když se dostane, kam neměl. */
export async function zrusOdkaz(db: D1Database, member_id: number, kdo: string): Promise<void> {
  const osoba = await db
    .prepare('select jmeno from members where id = ?')
    .bind(member_id)
    .first<{ jmeno: string }>();
  if (osoba === null) throw new ChybaVstupu('Osoba neexistuje.');

  await db.batch([
    db.prepare('update members set view_token = null where id = ?').bind(member_id),
    auditStatement(
      db,
      kdo,
      'smazani',
      'odkaz',
      String(member_id),
      `Zrušen osobní odkaz pro ${osoba.jmeno} — starý odkaz přestal platit`,
      null,
      null,
    ),
  ]);
}

export async function osobaPodleTokenu(db: D1Database, token: string): Promise<Osoba | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  return await db
    .prepare(
      `select id, jmeno, je_platce, ucet, vs, pod_member_id, email, je_admin, aktivni, view_token
         from members where view_token = ? and aktivni = 1`,
    )
    .bind(token)
    .first<Osoba>();
}

/** Platby jedné osoby — pro její osobní přehled. */
export async function platbyOsoby(db: D1Database, member_id: number, limit = 50) {
  const { results } = await db
    .prepare(
      `select datum, castka, matched_by from payments
        where member_id = ? and castka > 0 order by datum desc limit ?`,
    )
    .bind(member_id, limit)
    .all<{ datum: string; castka: number; matched_by: string | null }>();
  return results;
}

export async function nactiBehy(db: D1Database, limit = 50): Promise<Beh[]> {
  const { results } = await db
    .prepare(
      'select zacatek, konec, stav, detail, novych, sparovanych from sync_runs order by id desc limit ?',
    )
    .bind(limit)
    .all<Beh>();
  return results;
}

export async function nactiPrehled(db: D1Database): Promise<Prehled> {
  const [osoby, polozky, podily, nazev] = await Promise.all([
    nactiOsoby(db),
    db
      .prepare(
        `select id, nazev, kategorie, castka_celkem, perioda, druh, datum, hradi_member_id, poznamka,
                  rozpustit_od, rozpustit_mesicu, zdroj_uhrady
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
        rozpustit_od: r.rozpustit_od,
        rozpustit_mesicu: r.rozpustit_mesicu,
        zdroj_uhrady: r.zdroj_uhrady,
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
    vyuctovani_od: mapa.get('vyuctovani_od') ?? new Date().toISOString().slice(0, 7),
    rezerva_procent: Number(mapa.get('rezerva_procent') ?? '10'),
    prah_doplatku: Number(mapa.get('prah_doplatku') ?? '500000'),
    den_splatnosti: Number(mapa.get('den_splatnosti') ?? '20'),
  };
}

/**
 * Uloží nastavení bez záznamu do historie. Jen pro hodnoty, které se mění
 * samy pořád dokola (zůstatek účtu) — u nich by audit jen zaplevelil log.
 */
export async function ulozNastaveniTise(db: D1Database, klic: string, hodnota: string): Promise<void> {
  await db
    .prepare(
      `insert into settings (klic, hodnota, changed_at) values (?, ?, datetime('now'))
       on conflict(klic) do update set hodnota = excluded.hodnota, changed_at = excluded.changed_at`,
    )
    .bind(klic, hodnota)
    .run();
}

/** Uloží jednu položku nastavení a zapíše, kdo ji změnil. */
export async function ulozNastaveni(
  db: D1Database,
  klic: string,
  hodnota: string,
  kdo: string,
  popis: string,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `insert into settings (klic, hodnota, changed_at, changed_by) values (?, ?, datetime('now'), ?)
         on conflict(klic) do update set hodnota = excluded.hodnota,
              changed_at = excluded.changed_at, changed_by = excluded.changed_by`,
      )
      .bind(klic, hodnota, kdo),
    auditStatement(db, kdo, 'zmena', 'nastaveni', klic, popis, null, { klic, hodnota }),
  ]);
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

export interface ZmenaPolozky {
  cas: string;
  kdo: string;
  akce: string;
  popis: string;
  /** co se konkrétně změnilo, lidsky: „částka 299 Kč → 349 Kč" */
  zmeny: string[];
}

const POPIS_POLE: Record<string, string> = {
  nazev: 'název',
  kategorie: 'kategorie',
  castka_celkem: 'částka',
  perioda: 'perioda',
  druh: 'druh',
  datum: 'datum',
  poznamka: 'poznámka',
  hradi_member_id: 'kdo platí',
};

const jakoText = (klic: string, v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (klic === 'castka_celkem') return `${(Number(v) / 100).toLocaleString('cs-CZ')} Kč`;
  return String(v);
};

/** Historie jedné položky — kdo, kdy a co přesně změnil. */
export async function historiePolozky(db: D1Database, id: number, limit = 20): Promise<ZmenaPolozky[]> {
  const { results } = await db
    .prepare(
      `select cas, kdo, akce, popis, pred, po from audit_log
        where entita = 'polozka' and entita_id = ? order by id desc limit ?`,
    )
    .bind(String(id), limit)
    .all<{ cas: string; kdo: string; akce: string; popis: string; pred: string | null; po: string | null }>();

  return results.map((z) => {
    const zmeny: string[] = [];
    if (z.pred !== null && z.po !== null) {
      try {
        const pred = JSON.parse(z.pred) as Record<string, unknown>;
        const po = JSON.parse(z.po) as Record<string, unknown>;
        for (const [klic, popis] of Object.entries(POPIS_POLE)) {
          const a = pred[klic] ?? null;
          const b = po[klic] ?? null;
          if (String(a ?? '') !== String(b ?? '')) {
            zmeny.push(`${popis}: ${jakoText(klic, a)} → ${jakoText(klic, b)}`);
          }
        }
        if (JSON.stringify(pred['podily'] ?? []) !== JSON.stringify(po['podily'] ?? [])) {
          zmeny.push('změněno rozdělení mezi osoby');
        }
      } catch {
        // Nečitelný záznam historii nezruší — popis zůstává.
      }
    }
    return { cas: z.cas, kdo: z.kdo, akce: z.akce, popis: z.popis, zmeny };
  });
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
  rozpustit_od: string | null;
  rozpustit_mesicu: number | null;
  zdroj_uhrady: string;
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

  const rozpustitMesicu =
    d['rozpustit_mesicu'] === null || d['rozpustit_mesicu'] === undefined || d['rozpustit_mesicu'] === ''
      ? null
      : Number(d['rozpustit_mesicu']);
  if (rozpustitMesicu !== null && (!Number.isInteger(rozpustitMesicu) || rozpustitMesicu < 1 || rozpustitMesicu > 120)) {
    throw new ChybaVstupu('Rozpustit lze na 1 až 120 měsíců.');
  }
  const rozpustitOd = d['rozpustit_od'] ? String(d['rozpustit_od']) : null;
  if (rozpustitMesicu !== null && (rozpustitOd === null || !/^\d{4}-(0[1-9]|1[0-2])$/.test(rozpustitOd))) {
    throw new ChybaVstupu('U rozpouštěné položky vyplň, od kterého měsíce se rozpouští (RRRR-MM).');
  }
  const zdroj = String(d['zdroj_uhrady'] ?? 'ucet');
  if (zdroj !== 'ucet' && zdroj !== 'osoba') throw new ChybaVstupu('Neznámý zdroj úhrady.');
  const hradi = d['hradi_member_id'] ? Number(d['hradi_member_id']) : null;
  if (zdroj === 'osoba' && hradi === null) {
    throw new ChybaVstupu('Když to někdo platil ze svého, vyber u „Fakturu platí“ koho — jinak nejde komu připsat kredit.');
  }

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
    hradi_member_id: hradi,
    poznamka: d['poznamka'] ? String(d['poznamka']).trim() || null : null,
    rozpustit_od: rozpustitMesicu === null ? null : rozpustitOd,
    rozpustit_mesicu: rozpustitMesicu,
    zdroj_uhrady: zdroj,
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

/** Porovnání starého a nového stavu — ať se do historie nezapisuje prázdné uložení. */
function stejnaPolozka(pred: Record<string, unknown>, vstup: VstupPolozky): boolean {
  const shodne = (a: unknown, b: unknown): boolean => String(a ?? '') === String(b ?? '');
  const poli =
    shodne(pred['nazev'], vstup.nazev) &&
    shodne(pred['kategorie'], vstup.kategorie) &&
    shodne(pred['castka_celkem'], vstup.castka_celkem) &&
    shodne(pred['perioda'], vstup.perioda) &&
    shodne(pred['druh'], vstup.druh) &&
    shodne(pred['datum'], vstup.datum) &&
    shodne(pred['hradi_member_id'], vstup.hradi_member_id) &&
    shodne(pred['poznamka'], vstup.poznamka) &&
    shodne(pred['rozpustit_od'], vstup.rozpustit_od) &&
    shodne(pred['rozpustit_mesicu'], vstup.rozpustit_mesicu) &&
    shodne(pred['zdroj_uhrady'], vstup.zdroj_uhrady);
  if (!poli) return false;

  const klic = (p: Podil[]): string =>
    p
      .map((x) => `${x.member_id}:${x.rezim}:${x.hodnota}`)
      .sort()
      .join('|');
  const predPodily = Array.isArray(pred['podily']) ? (pred['podily'] as Podil[]) : [];
  return klic(predPodily) === klic(vstup.podily);
}

export interface VysledekUlozeni {
  id: number;
  /** false = uživatel klikl na Uložit, ale nic nezměnil */
  zmeneno: boolean;
}

/** Uloží položku i její rozdělení. */
export async function ulozPolozku(
  db: D1Database,
  vstup: VstupPolozky,
  kdo: string,
): Promise<VysledekUlozeni> {
  // Do „před" patří i rozdělení mezi osoby — jinak by z historie nešlo poznat,
  // že se změnilo, kdo se na položce skládá.
  const pred =
    vstup.id === null
      ? null
      : await (async () => {
          const radek = await db.prepare('select * from cost_items where id = ?').bind(vstup.id).first();
          if (radek === null) return null;
          const { results } = await db
            .prepare('select member_id, rezim, hodnota from cost_shares where cost_item_id = ?')
            .bind(vstup.id)
            .all<Podil>();
          return { ...radek, podily: results };
        })();

  let id = vstup.id;
  if (id === null) {
    const vlozeno = await db
      .prepare(
        `insert into cost_items (nazev, kategorie, castka_celkem, perioda, druh, datum, hradi_member_id, poznamka,
                                 rozpustit_od, rozpustit_mesicu, zdroj_uhrady)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning id`,
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
        vstup.rozpustit_od,
        vstup.rozpustit_mesicu,
        vstup.zdroj_uhrady,
      )
      .first<{ id: number }>();
    if (!vlozeno) throw new Error('Položku se nepodařilo založit.');
    id = vlozeno.id;
  } else {
    if (pred === null) throw new ChybaVstupu('Položka už neexistuje — mezitím ji někdo smazal.');
    // Uložení beze změny je no-op: nic nepřepisuje a hlavně nezakládá
    // záznam v historii. Jinak by opakované kliknutí zaneslo audit šumem.
    if (stejnaPolozka(pred as Record<string, unknown>, vstup)) return { id, zmeneno: false };
    await db
      .prepare(
        `update cost_items
            set nazev = ?, kategorie = ?, castka_celkem = ?, perioda = ?, druh = ?, datum = ?,
                hradi_member_id = ?, poznamka = ?, rozpustit_od = ?, rozpustit_mesicu = ?,
                zdroj_uhrady = ?, updated_at = datetime('now')
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
        vstup.rozpustit_od,
        vstup.rozpustit_mesicu,
        vstup.zdroj_uhrady,
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

  return { id, zmeneno: true };
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
