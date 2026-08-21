/**
 * Dotazy admina nad daty — „kolik letos vyšlo topení?", „proč má máma mínus?".
 *
 * Staví na téže AI vrstvě jako komentář k vývoji nákladů a drží stejná pravidla:
 *
 *  - **Model nepočítá.** Všechna čísla dostane hotová z aplikace. Ověřeno už
 *    u komentáře: free model sečetl kategorii s položkou, která do ní patří,
 *    a vyrobil nesmyslné procento.
 *  - **Věta s číslem, které v podkladu není, se označí jako neověřená.** U dotazu
 *    se nemaže — vypadl by z odpovědi kus věty a zbytek by nedával smysl — ale
 *    je vidět, že se na to číslo nedá spolehnout.
 *  - **Nic se nezapisuje.** Dotaz je čtení; ani AI, ani tenhle endpoint nesmí
 *    sáhnout na data.
 *
 * Na rozdíl od komentáře **jdou modelu i jména osob a jejich podíly** — bez nich
 * se na většinu otázek správce odpovědět nedá. Čísla účtů, variabilní symboly,
 * jednotlivé platby, e-maily ani tokeny v podkladu nejsou.
 */
import { spocitej, vlozenoZeSveho } from './admin-page.js';
import { ChybaAi, zeptejSe, type AiKontext, type VysledekAi } from './ai.js';
import type { Uzaverka, Zaloha } from './db.js';
import { zalohaVMesici } from './db.js';
import { jenOverenaCisla } from './komentar.js';
import type { Prehled } from './model.js';
import { formatKc, formatKcZnamenko, mesicNyni, popisPeriody } from './money.js';

const SYSTEM = [
  'Jsi pomocník správce jedné domácnosti. Odpovídáš na dotazy k jejím nákladům.',
  'Piš česky, věcně a stručně — nejvýš pět vět.',
  'PRAVIDLO: nepočítej. Žádné sčítání, odčítání, procenta ani průměry.',
  'Všechna čísla máš v podkladu — používej je doslova tak, jak jsou napsaná.',
  'Nikdy si údaj nedomýšlej. Když v podkladu není, napiš, který konkrétní údaj chybí.',
  // Tři různé věci, které model rád slévá do jedné. „Kolik platí máma" je
  // otázka na vložené peníze, ne na podíl — a odpověď podílem je zavádějící.
  'ROZLIŠUJ TŘI POJMY a nezaměňuj je: PODÍL je částka, která na člověka připadá;',
  'VLOŽENO je, co reálně dal (platby na účet plus to, co zaplatil ze svého);',
  'KREDIT je vloženo minus podíl. Když se někdo ptá, kolik kdo platí, uveď obojí —',
  'podíl i vloženo — a řekni, které číslo je které.',
  'Neraď, co má správce udělat, pokud se na to neptá.',
  // Graf umíš — jen ho nekreslíš ty. Vybereš, co zobrazit, a nakreslí to aplikace
  // ze svých čísel. Bez téhle věty se model na „vykresli graf" vymlouval, že
  // nemá čísla účtů, což s grafem nesouvisí vůbec.
  'GRAF UMÍŠ VYKRESLIT. Když si o něj někdo řekne, vyplň pole "graf" jedním z klíčů:',
  '"kategorie" (náklady po kategoriích), "polozky" (jednotlivé položky),',
  '"osoby" (měsíční podíl na osobu), "vyvoj" (celkové náklady po uzavřených měsících).',
  'Graf vykreslí aplikace z vlastních čísel; ty ho nepopisuj číslo po čísle,',
  'jen napiš jednou větou, co je na něm vidět. Když se o graf nikdo neprosí, dej "graf": "".',
  'Formát odpovědi: {"odpoved": "text odpovědi", "graf": "" }',
].join(' ');

/** Co umí aplikace vykreslit. Čísla do grafu vždycky počítá ona, ne model. */
export const DRUHY_GRAFU = ['kategorie', 'polozky', 'osoby', 'vyvoj'] as const;
export type DruhGrafu = (typeof DRUHY_GRAFU)[number];

export interface RadekGrafu {
  popis: string;
  /** haléře — kvůli měřítku pruhu */
  hodnota: number;
  /** už zformátovaná částka, ať se v prohlížeči nic nepřepočítává */
  text: string;
}

export interface Graf {
  druh: DruhGrafu;
  titulek: string;
  poznamka: string;
  radky: RadekGrafu[];
}

/** Jedna věta odpovědi i s tím, jestli se její čísla dají doložit podkladem. */
export interface VetaOdpovedi {
  text: string;
  overeno: boolean;
}

export interface Odpoved {
  vety: VetaOdpovedi[];
  /** co si model vyžádal vykreslit; graf sestaví aplikace ze svých čísel */
  graf: DruhGrafu | null;
}

/**
 * Rozdělí odpověď na věty. Rozděluje se za tečkou, otazníkem a vykřičníkem,
 * ale ne uvnitř čísla („1 500.50") — tam by věta praskla v půlce.
 */
export function naVety(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[^\d])/u)
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Podklad pro model — čitelný text, ne JSON. Malé modely si s prózou poradí líp
 * a v logu je pak vidět přesně to, co se posílalo ven.
 */
export function podkladDotazu(
  prehled: Prehled,
  zalohy: Zaloha[],
  zaplaceno: Map<number, number>,
  uzaverky: Map<string, Uzaverka>,
  odMesice: string,
  ted = new Date(),
): string {
  const mesic = mesicNyni(ted);
  const souhrn = spocitej(prehled, mesic);
  const jmeno = (id: number): string => prehled.osoby.find((o) => o.id === id)?.jmeno ?? `#${id}`;

  // Součty po kategoriích musí být v podkladu hotové. Bez nich si je model
  // dopočítá sám a splete se — na dotaz „kolik padne na energie" vrátil číslo,
  // které v datech vůbec nebylo.
  const kategorie = new Map<string, number>();
  for (const r of souhrn.radky) {
    if (r.castka === 0 || r.jednorazovy) continue;
    const klic = r.polozka.kategorie ?? 'bez kategorie';
    kategorie.set(klic, (kategorie.get(klic) ?? 0) + r.castka);
  }

  const casti: string[] = [
    `Dnes je ${ted.toISOString().slice(0, 10)}, aktuální měsíc ${mesic}.`,
    `Dům: ${prehled.nazev_domu}.`,
    `Náklady domu celkem: ${formatKc(souhrn.mesicneCelkem)} měsíčně, ${formatKc(souhrn.rocneCelkem)} ročně.`,
    '',
    'Po kategoriích (součty už spočítané, nesčítej je s jednotlivými položkami níž):',
    ...[...kategorie.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([n, v]) => `- ${n}: ${formatKc(v)} měsíčně, ${formatKc(v * 12)} ročně`),
    '',
    'Jednotlivé položky (částka za období → měsíční podíl, kdo fakturu platí, odkud jdou peníze).',
    'POZOR: každá je už započítaná v některé kategorii výše.',
  ];

  for (const r of souhrn.radky) {
    const p = r.polozka;
    const kdo = p.hradi_member_id === null ? 'neurčeno' : jmeno(p.hradi_member_id);
    const odkud = (p.zdroj_uhrady ?? 'ucet') === 'osoba' ? 'z vlastní kapsy' : 'z účtu domácnosti';
    const rozpad = [...r.naOsobu.entries()]
      .filter(([, v]) => v !== 0)
      .map(([id, v]) => `${jmeno(id)} ${formatKc(v)}`)
      .join(', ');
    casti.push(
      `- ${p.nazev} (${p.kategorie ?? 'bez kategorie'}): ${formatKc(p.castka_celkem)} ${popisPeriody(
        p.perioda,
      )} → ${formatKc(r.castka)} měsíčně. Platí ${kdo} ${odkud}.` +
        (rozpad ? ` Měsíční podíl: ${rozpad}.` : ' Zatím bez rozpadu na osoby.') +
        (r.nerozdeleno === 0 ? '' : ` Nerozděleno zbývá ${formatKc(r.nerozdeleno)}.`),
    );
  }

  // Kredit se počítá tady, ne v modelu — je to rozdíl dvou čísel a přesně
  // v takovém odčítání se malý model plete nejčastěji.
  const vklady = vlozenoZeSveho(prehled, odMesice, mesic);
  casti.push('', `Kdo jak stojí za období od ${odMesice} do ${mesic}:`);
  for (const o of prehled.osoby) {
    if ((o.pod_member_id ?? null) !== null) continue;
    const deti = prehled.osoby.filter((d) => (d.pod_member_id ?? null) === o.id);
    const sectiSDetmi = (m: Map<number, number>): number =>
      (m.get(o.id) ?? 0) + deti.reduce((a, d) => a + (m.get(d.id) ?? 0), 0);

    const podil = sectiSDetmi(souhrn.mesicneOsoba) + sectiSDetmi(souhrn.saldoOsoba);
    const dal = sectiSDetmi(zaplaceno);
    const zeSveho = sectiSDetmi(vklady);
    casti.push(
      `- ${o.jmeno}${deti.length ? ` (nese i podíl: ${deti.map((d) => d.jmeno).join(', ')})` : ''}: ` +
        `měsíční podíl ${formatKc(podil)}, záloha na trvalý příkaz ${formatKc(
          zalohaVMesici(zalohy, o.id, mesic),
        )}, ` +
        `celkem vložil(a) ${formatKc(dal)} (z toho ${formatKc(zeSveho)} zaplaceno ze svého), ` +
        `kredit ${formatKcZnamenko(dal - podil)}. ` +
        (o.je_platce ? 'Příspěvky posílá na účet.' : 'Na účet příspěvky neposílá, dluh se u něj nesleduje.'),
    );
  }

  const mesice = [...uzaverky.keys()].sort().slice(-12);
  if (mesice.length > 0) {
    casti.push('', 'Uzavřené měsíce — celkové náklady domu:');
    for (const m of mesice) casti.push(`- ${m}: ${formatKc(uzaverky.get(m)?.naklady_celkem ?? 0)}`);
  } else {
    casti.push('', 'Zatím není uzavřený žádný měsíc, o vývoji v čase se z podkladu nic vyčíst nedá.');
  }

  // Dřív tu stálo „na otázky na ně odpověz, že údaje nemáš" — malý model si
  // z toho udělal univerzální výmluvu a recitoval seznam i na „vykresli graf".
  // Pravidlo je proto úzké a váže se jen na ty konkrétní údaje.
  casti.push(
    '',
    'Jediné údaje, které v podkladu nejsou: čísla účtů, variabilní symboly, jednotlivé',
    'platby z banky a e-maily. Ten seznam zmiňuj JEN tehdy, když se někdo ptá přímo na ně.',
    'Na všechno ostatní odpověz z čísel výše.',
  );
  return casti.join('\n');
}

/* ---------- grafy: model vybírá co, čísla dodává aplikace ---------- */

/**
 * Sestaví graf z **vlastních dat aplikace**. Model rozhoduje jen o tom, co se
 * má zobrazit — kdyby dodával i čísla, platila by o nich tatáž nedůvěra jako
 * o větách a graf by se nedal ukázat vůbec.
 */
export function sestavGraf(
  druh: DruhGrafu,
  prehled: Prehled,
  uzaverky: Map<string, Uzaverka>,
  ted = new Date(),
): Graf | null {
  const mesic = mesicNyni(ted);
  const souhrn = spocitej(prehled, mesic);
  const jmeno = (id: number): string => prehled.osoby.find((o) => o.id === id)?.jmeno ?? '#' + id;

  const radek = (popis: string, hodnota: number): RadekGrafu => ({
    popis,
    hodnota,
    text: formatKc(hodnota),
  });

  if (druh === 'kategorie') {
    const kategorie = new Map<string, number>();
    for (const r of souhrn.radky) {
      if (r.castka === 0 || r.jednorazovy) continue;
      const klic = r.polozka.kategorie ?? 'bez kategorie';
      kategorie.set(klic, (kategorie.get(klic) ?? 0) + r.castka);
    }
    const radky = [...kategorie.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => radek(n, v));
    return radky.length === 0
      ? null
      : {
          druh,
          titulek: 'Náklady domu po kategoriích',
          poznamka: 'měsíčně · jen pravidelné a rozpouštěné položky',
          radky,
        };
  }

  if (druh === 'polozky') {
    const radky = souhrn.radky
      .filter((r) => r.castka !== 0 && !r.jednorazovy)
      .sort((a, b) => b.castka - a.castka)
      .map((r) => radek(r.polozka.nazev, r.castka));
    return radky.length === 0
      ? null
      : { druh, titulek: 'Jednotlivé položky', poznamka: 'měsíčně, od největší', radky };
  }

  if (druh === 'osoby') {
    // Sčítá se stejně jako v podkladu — s podílem toho, koho člověk nese.
    // Kdyby graf rozepisoval každého zvlášť, nesouhlasil by s větou, kterou
    // k němu model napíše, a čtenář by nevěděl, které z čísel platí.
    const radky = prehled.osoby
      .filter((o) => (o.pod_member_id ?? null) === null)
      .map((o) => {
        const deti = prehled.osoby.filter((d) => (d.pod_member_id ?? null) === o.id);
        const soucet = deti.reduce(
          (a, d) => a + (souhrn.mesicneOsoba.get(d.id) ?? 0),
          souhrn.mesicneOsoba.get(o.id) ?? 0,
        );
        const popis = deti.length === 0 ? jmeno(o.id) : `${jmeno(o.id)} (s ${deti.map((d) => d.jmeno).join(', ')})`;
        return radek(popis, soucet);
      })
      .filter((r) => r.hodnota !== 0)
      .sort((a, b) => b.hodnota - a.hodnota);
    return radky.length === 0
      ? null
      : {
          druh,
          titulek: 'Měsíční podíl na osobu',
          poznamka: 'včetně podílu toho, koho člověk nese',
          radky,
        };
  }

  const mesice = [...uzaverky.keys()].sort().slice(-12);
  const radky = mesice.map((m) => radek(m, uzaverky.get(m)?.naklady_celkem ?? 0));
  return radky.length === 0
    ? null
    : { druh, titulek: 'Náklady domu po měsících', poznamka: 'jen uzavřené měsíce', radky };
}

export async function odpovezNaDotaz(
  kontext: AiKontext,
  podklad: string,
  otazka: string,
): Promise<VysledekAi<Odpoved>> {
  const cista = otazka.trim();
  if (cista === '') throw new ChybaAi('Napiš, na co se chceš zeptat.');
  if (cista.length > 500) throw new ChybaAi('Dotaz je moc dlouhý — zkrať ho pod 500 znaků.');

  const vysledek = await zeptejSe<{ odpoved?: string; graf?: string }>(
    kontext,
    SYSTEM,
    `${podklad}\n\n---\nDOTAZ SPRÁVCE: ${cista}`,
    700,
  );

  const text = String(vysledek.data?.odpoved ?? '').trim();
  if (text === '') throw new ChybaAi('Model vrátil prázdnou odpověď. Zkus dotaz přeformulovat.');

  return {
    backend: vysledek.backend,
    model: vysledek.model,
    // `zaskok` musí projít až ven, jinak by se z odpovědi nedalo poznat,
    // že placený backend selhal a zaskočil za něj ten free.
    zaskok: vysledek.zaskok,
    data: {
      vety: naVety(text).map((v) => ({ text: v, overeno: jenOverenaCisla(v, podklad) })),
      graf: zvolenyGraf(vysledek.data?.graf, cista),
    },
  };
}

/**
 * Který graf vykreslit.
 *
 * Volbu dělá model, ale je tu **záchrana podle znění dotazu**: když si někdo
 * o graf řekne a model pole nevyplní, nemá smysl mu odpovědět holým textem —
 * o graf si řekl. Slabší modely tohle pole vynechávají.
 */
export function zvolenyGraf(zModelu: string | undefined, otazka: string): DruhGrafu | null {
  const volba = String(zModelu ?? '').trim().toLowerCase();
  if ((DRUHY_GRAFU as readonly string[]).includes(volba)) return volba as DruhGrafu;

  const dotaz = otazka.toLowerCase();
  if (!/\bgraf|vykresli|vykreslí|nakresli|nakreslí|zobraz|ukaž mi rozpad/.test(dotaz)) return null;
  if (/osob|kdo |mám|děd|luck|elišk/.test(dotaz)) return 'osoby';
  if (/měsíc|mesic|vývoj|vyvoj|v čase|v case/.test(dotaz)) return 'vyvoj';
  if (/položk|polozk/.test(dotaz)) return 'polozky';
  return 'kategorie';
}
