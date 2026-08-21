/**
 * Stránka „Historie změn" — kdo co změnil, z čeho na co.
 *
 * Ve stejném gardu jako Log synchronizace: filtry nahoře, po sobě jdoucí
 * stejné záznamy slité do jednoho řádku a načítání starších na tlačítko.
 *
 * Rozdíl proti logu je v tom, že u změny je vidět **stará a nová hodnota**.
 * Audit ukládá celý stav před a po jako JSON; tady se z nich vytáhne jen to,
 * co se opravdu liší — jinak by řádek zaplavily nezměněné údaje.
 */
import type { ZaznamAuditu } from './db.js';
import { formatKc } from './money.js';
import { esc, shell } from './ui.js';

/** Lidské názvy polí. Co tu není, se ukáže tak, jak se jmenuje v databázi. */
const NAZVY: Record<string, string> = {
  nazev: 'název',
  kategorie: 'kategorie',
  castka_celkem: 'částka',
  castka: 'částka',
  perioda: 'perioda',
  druh: 'druh',
  datum: 'datum',
  poznamka: 'poznámka',
  hradi_member_id: 'fakturu platí',
  zdroj_uhrady: 'zaplaceno z',
  rozpustit_od: 'rozpouštět od',
  rozpustit_mesicu: 'rozpustit přes',
  jmeno: 'jméno',
  email: 'e-mail',
  vs: 'variabilní symbol',
  ucet: 'číslo účtu',
  je_platce: 'posílá na účet',
  je_admin: 'admin',
  aktivni: 'v evidenci',
  pod_member_id: 'podíl nese',
  rod: 'rod',
  plati_od: 'platí od',
  obdobi: 'období',
  hodnota: 'hodnota',
  klic: 'klíč',
  predepsano: 'předepsáno',
  zaplaceno: 'zaplaceno',
  skutecne: 'skutečnost',
  rozdil: 'rozdíl',
  zustatek: 'zůstatek',
  nova_zaloha: 'nová záloha',
};

/** Pole, u kterých je hodnota v haléřích — jinak by se zobrazila stokrát větší. */
const V_HALERICH = new Set([
  'castka_celkem',
  'castka',
  'prah_doplatku',
  'predepsano',
  'zaplaceno',
  'skutecne',
  'rozdil',
  'zustatek',
  'nova_zaloha',
]);

/** Pole, kde 0/1 znamená ano/ne. */
const ANO_NE = new Set(['je_platce', 'je_admin', 'aktivni']);

const zobraz = (klic: string, v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (ANO_NE.has(klic)) return v === 1 || v === '1' || v === true ? 'ano' : 'ne';
  if (typeof v === 'boolean') return v ? 'ano' : 'ne';
  if (typeof v === 'number' && V_HALERICH.has(klic)) return formatKc(v);
  const s = String(v);
  return s.length > 80 ? s.slice(0, 79) + '…' : s;
};

export interface ZmenaPole {
  klic: string;
  pred: string;
  po: string;
}

/**
 * Co se mezi dvěma stavy opravdu změnilo.
 *
 * Porovnávají se už zobrazené hodnoty — z databáze chodí `1` a z formuláře
 * `'1'`, a to není změna, kterou by měl kdokoli číst.
 */
export function rozdil(predJson: string | null, poJson: string | null): ZmenaPole[] {
  const rozbal = (t: string | null): Record<string, unknown> => {
    if (!t) return {};
    try {
      const o = JSON.parse(t) as unknown;
      return o !== null && typeof o === 'object' ? (o as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const a = rozbal(predJson);
  const b = rozbal(poJson);
  const klice = [...new Set([...Object.keys(a), ...Object.keys(b)])];

  const zmeny: ZmenaPole[] = [];
  for (const k of klice) {
    // Technické sloupce nikoho nezajímají a jen by řádek zaplevelily.
    if (['id', 'created_at', 'updated_at', 'view_token', 'podily', 'radky'].includes(k)) continue;
    const pred = zobraz(k, a[k]);
    const po = zobraz(k, b[k]);
    if (pred === po) continue;
    zmeny.push({ klic: NAZVY[k] ?? k, pred, po });
  }
  return zmeny;
}

export interface SkupinaZmen {
  zaznam: ZaznamAuditu;
  pocet: number;
  prvni: string;
  zmeny: ZmenaPole[];
}

/** Po sobě jdoucí stejné záznamy (týž člověk, týž popis) se slijí do jednoho. */
export function seskupZmeny(zaznamy: ZaznamAuditu[]): SkupinaZmen[] {
  const skupiny: SkupinaZmen[] = [];
  for (const z of zaznamy) {
    const posledni = skupiny[skupiny.length - 1];
    if (posledni !== undefined && posledni.zaznam.kdo === z.kdo && posledni.zaznam.popis === z.popis) {
      posledni.pocet += 1;
      posledni.prvni = z.cas;
      continue;
    }
    skupiny.push({ zaznam: z, pocet: 1, prvni: z.cas, zmeny: rozdil(z.pred, z.po) });
  }
  return skupiny;
}

const POPIS_AKCE: Record<string, string> = {
  vytvoreni: 'vytvoření',
  zmena: 'změna',
  smazani: 'smazání',
  import: 'import',
  sync: 'stahování',
};

const STYL = `<style>
.main { display: block; overflow-y: auto; }
table { min-width: 940px; }
.col-cas { width: 152px; }
.col-cas small { display: block; color: var(--text-faint); font-size: 10.5px; }
.col-kdo { width: 170px; color: var(--text-dim); }
.col-co { width: 296px; }
.col-co .entita { font-family: var(--mono); font-size: 11px; color: var(--text-dim); }
.col-co .akce { font-size: 10.5px; text-transform: uppercase; letter-spacing: .4px; padding: 0 4px; border-radius: 2px; background: var(--chrome); color: var(--text-dim); }
.col-co .akce.a-vytvoreni { color: var(--ok); }
.col-co .akce.a-smazani { color: var(--crit); }
.col-co .popis { margin-top: 2px; white-space: normal; }
.pocetkrat { font-family: var(--mono); color: var(--text-dim); font-size: 11px; }
.zmeny { display: flex; flex-direction: column; gap: 2px; }
.zmena { display: grid; grid-template-columns: 132px minmax(0, 1fr) 14px minmax(0, 1fr); gap: 6px; align-items: baseline; }
.zmena .pole { color: var(--text-dim); font-size: 11.5px; }
.zmena .stara { color: var(--text-faint); text-decoration: line-through; font-family: var(--mono); font-size: 11.5px; }
.zmena .sipka { color: var(--accent); }
.zmena .nova { font-family: var(--mono); font-size: 11.5px; font-weight: 600; }
.filtry-log { display: flex; align-items: center; gap: 6px; padding: 7px 10px; border-bottom: 1px solid var(--border); background: var(--chrome-hi); flex-wrap: wrap; }
.filtry-log .tbtn { text-decoration: none; }
.filtry-log .tbtn.aktivni { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
.filtry-log .spacer { flex: 1; }
.vic { padding: 9px 10px; }
.vic a { text-decoration: none; }
@media (max-width: 900px) {
  table { min-width: 0; }
  .zmena { grid-template-columns: 1fr; gap: 0; }
  .zmena .sipka { display: none; }
}
</style>`;

export function renderHistorie(
  zaznamy: ZaznamAuditu[],
  souhrn: { celkem: number; entity: Map<string, number> },
  entita: string | null,
  limit: number,
  nazevDomu: string,
  kdo: string,
  commit: string,
): string {
  const skupiny = seskupZmeny(zaznamy);
  const jeVic = zaznamy.length >= limit && zaznamy.length < souhrn.celkem;

  const radky =
    skupiny.length === 0
      ? `<tr><td colspan="4" class="note">${
          entita ? `Žádná změna u „${esc(entita)}".` : 'Zatím žádná změna.'
        }</td></tr>`
      : skupiny
          .map((g) => {
            const z = g.zaznam;
            const detail =
              g.zmeny.length > 0
                ? `<div class="zmeny">${g.zmeny
                    .map(
                      (m) => `<div class="zmena">
              <span class="pole">${esc(m.klic)}</span>
              <span class="stara">${esc(m.pred)}</span>
              <span class="sipka">→</span>
              <span class="nova">${esc(m.po)}</span>
            </div>`,
                    )
                    .join('')}</div>`
                : z.pred === null && z.po !== null
                  ? '<span class="note">nový záznam</span>'
                  : z.po === null && z.pred !== null
                    ? '<span class="note">záznam smazán</span>'
                    : '<span class="note">beze změny hodnot</span>';

            return `<tr>
      <td class="mono col-cas" data-popis="Kdy">${esc(z.cas)}${
        g.pocet > 1 ? `<small>nejstarší ${esc(g.prvni)}</small>` : ''
      }</td>
      <td class="col-kdo" data-popis="Kdo">${esc(z.kdo)}</td>
      <td class="col-co" data-popis="Co">
        <span class="entita">${esc(z.entita)}</span>
        <span class="akce a-${esc(z.akce)}">${esc(POPIS_AKCE[z.akce] ?? z.akce)}</span>
        ${g.pocet > 1 ? `<span class="pocetkrat">${g.pocet}×</span>` : ''}
        <div class="popis">${esc(z.popis)}</div>
      </td>
      <td data-popis="Z čeho na co">${detail}</td>
    </tr>`;
          })
          .join('');

  const odkaz = (e: string | null, popis: string, pocet: number): string => {
    const je = (entita ?? null) === e;
    const q = e === null ? '' : `?entita=${encodeURIComponent(e)}`;
    return `<a class="tbtn${je ? ' aktivni' : ''}" href="/admin/historie${q}">${esc(popis)} (${pocet})</a>`;
  };

  const obsah = `${STYL}
  <div>
    <div class="panehead"><svg class="icon icon-sm"><use href="#i-log"/></svg>Historie změn
      <span class="count">${skupiny.length} z ${zaznamy.length} záznamů</span>
    </div>
    <div class="filtry-log">
      ${odkaz(null, 'vše', souhrn.celkem)}
      ${[...souhrn.entity.entries()].map(([e, p]) => odkaz(e, e, p)).join('')}
      <span class="spacer"></span>
      <span class="note">Žádná změna se nezapíše bez záznamu — změna i zápis jdou do databáze jednou dávkou.</span>
    </div>
    <div class="gridwrap">
      <table>
        <thead><tr>
          <th class="col-cas">Kdy</th><th class="col-kdo">Kdo</th>
          <th class="col-co">Co</th><th>Z čeho na co</th>
        </tr></thead>
        <tbody>${radky}</tbody>
      </table>
    </div>
    ${
      jeVic
        ? `<div class="vic"><a class="btn" href="/admin/historie?${
            entita ? `entita=${encodeURIComponent(entita)}&` : ''
          }limit=${limit * 4}">Načíst starší (zatím ${zaznamy.length} z ${souhrn.celkem})</a></div>`
        : `<div class="vic note">Načtené jsou všechny záznamy${entita ? ` u „${esc(entita)}"` : ''}.</div>`
    }
  </div>`;

  return shell({
    aktivni: 'historie',
    nazevDomu,
    titulek: 'Historie změn',
    commit,
    obsah,
    status: `<span>záznamů celkem <b>${souhrn.celkem}</b></span><span>zobrazeno <b>${skupiny.length}</b></span><span class="spacer"></span><span>přihlášen: ${esc(kdo)}</span>`,
  });
}
