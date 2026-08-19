/**
 * Frontend admina — náklady domu a jejich rozdělení mezi osoby.
 *
 * Vzhled se drží standardu z repa Interface-Par (hustý „IT-ops" shell podle
 * WinBoxu): titulní lišta → boční menu → toolbar → grid → stavový řádek.
 * Tokeny v `:root` jsou převzaté odtamtud, ať appky vypadají stejně.
 *
 * Layout je seznam + detail vedle sebe, na úzkém okně pod sebou s výsuvným menu.
 * Vazba na databázi přijde v dalším kroku — proto je Uložit zatím neaktivní
 * a je to na stránce vidět.
 */
import {
  DRUHY,
  formatKc,
  formatKcZnamenko,
  jeJednorazovy,
  mesicne,
  popisDruhu,
  popisPeriody,
  rozpad,
  znamenko,
} from './money.js';
import type { Osoba, Polozka, Prehled } from './sample.js';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------- výpočty ---------- */

interface Radek {
  polozka: Polozka;
  jednorazovy: boolean;
  /** u pravidelných měsíční ekvivalent, u jednorázových celá částka se znaménkem */
  castka: number;
  naOsobu: Map<number, number>;
  nerozdeleno: number;
}

export interface Souhrn {
  radky: Radek[];
  /** průměr pravidelných nákladů */
  mesicneCelkem: number;
  rocneCelkem: number;
  mesicneOsoba: Map<number, number>;
  /** jednorázové + nedoplatky − přeplatky; vstupuje rovnou do dlužné částky */
  saldoCelkem: number;
  saldoOsoba: Map<number, number>;
  nedokoncenych: number;
}

export function spocitej(prehled: Prehled): Souhrn {
  const radky: Radek[] = [];
  const mesicneOsoba = new Map<number, number>();
  const saldoOsoba = new Map<number, number>();
  let mesicneCelkem = 0;
  let saldoCelkem = 0;
  let nedokoncenych = 0;

  for (const polozka of prehled.polozky) {
    const { naOsobu: podil, nerozdeleno } = rozpad(polozka.castka_celkem, polozka.podily);
    const jednorazovy = jeJednorazovy(polozka.druh);
    const zn = znamenko(polozka.druh);
    const naOsobu = new Map<number, number>();

    for (const [memberId, castka] of podil) {
      // Pravidelné se rozpouští do měsíčního průměru, jednorázové jdou celé do salda.
      const hodnota = jednorazovy ? zn * castka : mesicne(castka, polozka.perioda);
      naOsobu.set(memberId, hodnota);
      const kam = jednorazovy ? saldoOsoba : mesicneOsoba;
      kam.set(memberId, (kam.get(memberId) ?? 0) + hodnota);
    }

    const castka = jednorazovy
      ? zn * polozka.castka_celkem
      : mesicne(polozka.castka_celkem, polozka.perioda);
    if (jednorazovy) saldoCelkem += castka;
    else mesicneCelkem += castka;

    if (polozka.castka_celkem === 0 || nerozdeleno !== 0) nedokoncenych++;
    radky.push({ polozka, jednorazovy, castka, naOsobu, nerozdeleno });
  }

  return {
    radky,
    mesicneCelkem,
    rocneCelkem: mesicneCelkem * 12,
    mesicneOsoba,
    saldoCelkem,
    saldoOsoba,
    nedokoncenych,
  };
}

/* ---------- vzhled ---------- */

const TOKENY_SVETLE = `
  --chrome: #edeff2; --chrome-hi: #f6f7f9; --pane: #ffffff; --head: #e3e7eb;
  --row-alt: #f8f9fb; --hover: #e6eaee; --border: #c9cfd6; --border-soft: #dde1e6;
  --text: #1a1e22; --text-dim: #5c656e; --text-faint: #8b939b;
  --accent: #31628c; --accent-fg: #ffffff; --accent-soft: rgba(49, 98, 140, .14);
  --ok: #3d7f4c; --warn: #96700d; --crit: #a93b31; --idle: #8b939b;
  --shadow: 0 4px 14px rgba(20, 30, 40, .16), 0 0 0 1px rgba(20, 30, 40, .07);
`;

const TOKENY_TMAVE = `
  --chrome: #191b1e; --chrome-hi: #212429; --pane: #1f2226; --head: #262a2f;
  --row-alt: #23262b; --hover: #2b3036; --border: #32373d; --border-soft: #2a2e34;
  --text: #dde2e7; --text-dim: #8a939c; --text-faint: #6b747d;
  --accent: #6a9cce; --accent-fg: #10151a; --accent-soft: rgba(106, 156, 206, .18);
  --ok: #63ac72; --warn: #c79a33; --crit: #dc6b60; --idle: #6b747d;
  --shadow: 0 4px 16px rgba(0, 0, 0, .5), 0 0 0 1px rgba(255, 255, 255, .06);
`;

const CSS = `
:root {
  ${TOKENY_SVETLE}
  --mono: "Cascadia Mono", Consolas, "SF Mono", "Liberation Mono", monospace;
  --ui: "Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont, "Noto Sans", sans-serif;
}
@media (prefers-color-scheme: dark) { :root { ${TOKENY_TMAVE} } }
:root[data-theme="light"] { ${TOKENY_SVETLE} }
:root[data-theme="dark"] { ${TOKENY_TMAVE} }

* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0; font-family: var(--ui); font-size: 12.5px; line-height: 1.35;
  color: var(--text); background: var(--chrome); -webkit-font-smoothing: antialiased;
}
.icon { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.icon-sm { width: 13px; height: 13px; }
:focus-visible { outline: 1px solid var(--accent); outline-offset: -2px; }

.app {
  height: 100vh; display: grid;
  grid-template-columns: 178px 1fr;
  grid-template-rows: 33px 1fr 23px;
  grid-template-areas: "title title" "nav main" "status status";
}

/* titulní lišta */
.titlebar { grid-area: title; display: flex; align-items: center; gap: 9px; padding: 0 9px; background: var(--chrome-hi); border-bottom: 1px solid var(--border); }
.brand { display: flex; align-items: center; gap: 7px; font-weight: 600; white-space: nowrap; }
.brand .mark { width: 15px; height: 15px; flex: none; border: 1.5px solid var(--accent); border-radius: 2px; position: relative; }
.brand .mark::after { content: ""; position: absolute; inset: 3px 3px auto 3px; height: 1.5px; background: var(--accent); box-shadow: 0 3px 0 var(--accent); }
.brand .org { color: var(--text-dim); font-weight: 400; }
.titlebar .sep { width: 1px; align-self: stretch; margin: 6px 2px; background: var(--border); }
.field { display: flex; align-items: center; gap: 6px; color: var(--text-dim); }
.field label { white-space: nowrap; }
select, input[type="search"], input[type="text"], input[type="date"], textarea {
  font: inherit; color: var(--text); background: var(--pane);
  border: 1px solid var(--border); border-radius: 2px; padding: 2px 5px; height: 22px;
}
textarea { height: auto; min-height: 40px; resize: vertical; width: 100%; }
.search { position: relative; display: flex; align-items: center; }
.search .icon { position: absolute; left: 5px; color: var(--text-faint); pointer-events: none; }
.search input { padding-left: 25px; width: 190px; }
.spacer { flex: 1; }
.chip { display: inline-flex; align-items: center; gap: 5px; height: 21px; padding: 0 7px; border: 1px solid var(--border); border-radius: 2px; background: var(--pane); color: var(--text-dim); font-variant-numeric: tabular-nums; white-space: nowrap; }

/* boční menu */
.nav { grid-area: nav; background: var(--chrome); border-right: 1px solid var(--border); padding: 4px 0; overflow-y: auto; }
.navitem { display: flex; align-items: center; gap: 9px; width: 100%; height: 27px; padding: 0 8px 0 11px; border: 0; background: none; font: inherit; color: var(--text); text-align: left; cursor: default; }
.navitem:hover { background: var(--hover); }
.navitem .icon { color: var(--text-dim); }
.navitem[aria-current="true"] { background: var(--accent-soft); box-shadow: inset 2px 0 0 var(--accent); font-weight: 600; }
.navitem[aria-current="true"] .icon { color: var(--accent); }
.navgroup-label { padding: 11px 11px 4px; font-size: 10.5px; letter-spacing: .55px; text-transform: uppercase; color: var(--text-faint); }

/* hlavní plocha: seznam + detail */
.main { grid-area: main; display: grid; grid-template-columns: minmax(0, 1fr) 366px; min-width: 0; background: var(--pane); }
.list { display: flex; flex-direction: column; min-width: 0; border-right: 1px solid var(--border); }
.detail { display: flex; flex-direction: column; min-width: 0; overflow-y: auto; background: var(--chrome-hi); }

.panehead { display: flex; align-items: center; gap: 7px; height: 26px; padding: 0 9px; background: var(--accent-soft); border-bottom: 1px solid var(--border); font-weight: 600; }
.panehead .icon { color: var(--accent); }
.panehead .count { margin-left: auto; font-weight: 400; color: var(--text-dim); font-variant-numeric: tabular-nums; }

.toolbar { display: flex; align-items: center; gap: 1px; height: 30px; padding: 0 5px; background: var(--chrome-hi); border-bottom: 1px solid var(--border); overflow-x: auto; }
.tbtn { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px; border: 1px solid transparent; border-radius: 2px; background: none; font: inherit; color: var(--text); white-space: nowrap; cursor: default; }
.tbtn .icon { color: var(--text-dim); }
.tbtn:hover:not(:disabled) { background: var(--pane); border-color: var(--border); }
.tbtn:active:not(:disabled) { background: var(--hover); }
.tbtn:disabled { color: var(--text-faint); }
.tbtn:disabled .icon { color: var(--text-faint); opacity: .6; }
.tbtn.primary .icon { color: var(--accent); }
.toolbar .sep { width: 1px; height: 16px; margin: 0 5px; background: var(--border); flex: none; }

.gridwrap { flex: 1; overflow: auto; }
table { border-collapse: collapse; width: 100%; min-width: 760px; }
thead th { position: sticky; top: 0; z-index: 5; height: 25px; padding: 0 8px; background: var(--head); border-bottom: 1px solid var(--border); border-right: 1px solid var(--border-soft); font-weight: 600; font-size: 11.5px; color: var(--text-dim); text-align: left; white-space: nowrap; user-select: none; }
thead th.osoba { text-align: right; }
tbody td { height: 26px; padding: 0 8px; border-bottom: 1px solid var(--border-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
tbody tr:nth-child(even) { background: var(--row-alt); }
tbody tr:hover td { background: var(--hover); }
tbody tr[data-selected="true"] td { background: var(--accent-soft); }
tbody tr[data-selected="true"] td:first-child { box-shadow: inset 2px 0 0 var(--accent); }
tfoot td { position: sticky; bottom: 0; height: 25px; padding: 0 8px; background: var(--head); border-top: 1px solid var(--border); font-weight: 600; white-space: nowrap; }
tfoot tr:first-child td { border-top: 1px solid var(--border); }
.col-num { text-align: right; font-variant-numeric: tabular-nums; font-family: var(--mono); font-size: 11.5px; }
.col-num.minus { color: var(--ok); }
.col-per { width: 108px; color: var(--text-dim); }
.col-druh { width: 104px; color: var(--text-dim); }
.col-stav { width: 116px; }
.nazev { font-weight: 600; }
.nazev .pozn { font-weight: 400; color: var(--text-faint); }
.zero { color: var(--text-faint); }

.dot { display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 1px; background: var(--idle); }
.s-ok .dot { background: var(--ok); }
.s-warn { color: var(--warn); }
.s-warn .dot { background: var(--warn); }
.druh.d-pravidelny .dot { background: var(--accent); }
.druh.d-jednorazovy .dot { background: var(--idle); }
.druh.d-nedoplatek .dot { background: var(--crit); }
.druh.d-preplatek .dot { background: var(--ok); }

/* detail */
.detail .body { padding: 9px 10px 12px; display: flex; flex-direction: column; gap: 9px; }
.frow { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.frow > label { color: var(--text-dim); }
.frow2 { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
.frow input, .frow select { width: 100%; }
.subhead { display: flex; align-items: center; gap: 8px; margin-top: 3px; font-size: 10.5px; letter-spacing: .55px; text-transform: uppercase; color: var(--text-faint); border-bottom: 1px solid var(--border-soft); padding-bottom: 3px; }
.subhead .tbtn { height: 19px; margin-left: auto; text-transform: none; letter-spacing: 0; font-size: 11.5px; color: var(--accent); }
.podil { display: grid; grid-template-columns: minmax(0, 1fr) 82px 62px 72px; gap: 6px; align-items: center; }
.podil .kdo { display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.podil[data-off="true"] .kdo { color: var(--text-faint); }
.podil[data-off="true"] select, .podil[data-off="true"] input[type="text"] { visibility: hidden; }
.podil .vysledek { text-align: right; font-family: var(--mono); font-size: 11.5px; font-variant-numeric: tabular-nums; color: var(--text-dim); }
input[type="checkbox"] { width: 13px; height: 13px; margin: 0; accent-color: var(--accent); flex: none; }
.zbytek, .dopad { display: flex; justify-content: space-between; gap: 8px; font-variant-numeric: tabular-nums; }
.zbytek { padding-top: 4px; border-top: 1px solid var(--border-soft); }
.zbytek b, .dopad b { font-family: var(--mono); }
.zbytek.warn { color: var(--warn); }
.dopad { color: var(--text-dim); }
.dopad b { color: var(--text); }
.detail .foot { display: flex; align-items: center; gap: 6px; padding: 7px 10px; border-top: 1px solid var(--border); background: var(--chrome); position: sticky; bottom: 0; flex-wrap: wrap; }
.btn { height: 23px; padding: 0 10px; border: 1px solid var(--border); border-radius: 2px; background: var(--pane); font: inherit; color: var(--text); cursor: default; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); font-weight: 600; }
.btn:disabled, .btn.primary:disabled { background: var(--chrome-hi); border-color: var(--border); color: var(--text-faint); font-weight: 400; }
.note { color: var(--text-faint); }

/* stavový řádek */
.status { grid-area: status; display: flex; align-items: center; padding: 0 9px; background: var(--chrome-hi); border-top: 1px solid var(--border); color: var(--text-dim); font-size: 11.5px; overflow-x: auto; }
.status > span { padding: 0 9px; border-right: 1px solid var(--border); white-space: nowrap; }
.status > span:first-child { padding-left: 0; }
.status > span:last-child { border-right: 0; }
.status b { font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
.status .warn { color: var(--warn); }
.status .saldo { font-variant-numeric: tabular-nums; color: var(--text-faint); }

/* hamburger — na širokém okně zbytečný, menu je pořád vidět */
.burger { display: none; align-items: center; justify-content: center; width: 26px; height: 24px; padding: 0; border: 1px solid transparent; border-radius: 2px; background: none; color: var(--text); cursor: default; }
.burger:hover { background: var(--pane); border-color: var(--border); }
.backdrop { display: none; }

@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
@media (max-width: 1180px) { .search input { width: 130px; } .main { grid-template-columns: minmax(0, 1fr) 330px; } }

/* úzké okno a mobil: menu je výsuvné, seznam a detail nad sebou */
@media (max-width: 860px) {
  .app { grid-template-columns: 1fr; grid-template-areas: "title" "main" "status"; }
  .burger { display: inline-flex; }
  .titlebar .field, .titlebar .chip, .titlebar .sep { display: none; }
  .search { flex: 1; }
  .search input { width: 100%; }

  .nav {
    position: fixed; top: 33px; bottom: 23px; left: 0; width: 214px; z-index: 30;
    transform: translateX(-100%); transition: transform .14s ease-out; box-shadow: var(--shadow);
  }
  .app[data-nav="open"] .nav { transform: none; }
  .app[data-nav="open"] .backdrop { display: block; position: fixed; inset: 33px 0 23px; z-index: 25; background: rgba(0, 0, 0, .34); }
  .navitem { height: 34px; }

  .main { grid-template-columns: 1fr; grid-template-rows: minmax(180px, 1fr) auto; overflow: hidden; }
  .list { border-right: 0; min-height: 0; }
  .detail { border-top: 1px solid var(--border); max-height: 54vh; }
  .status { font-size: 11px; }
}

/* na displeji telefonu se sloupce osob nevejdou — detail je nese celé */
@media (max-width: 560px) {
  thead th.osoba, td.osoba-cell { display: none; }
  table { min-width: 0; }
  .col-druh, .col-per { width: auto; }
  .podil { grid-template-columns: minmax(0, 1fr) 76px 58px 68px; }
  .detail { max-height: 60vh; }
}
`;

const SYMBOLY = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<symbol id="i-grid" viewBox="0 0 16 16"><rect x="2" y="2" width="5" height="5"/><rect x="9" y="2" width="5" height="5"/><rect x="2" y="9" width="5" height="5"/><rect x="9" y="9" width="5" height="5"/></symbol>
<symbol id="i-list" viewBox="0 0 16 16"><path d="M5.2 4h9M5.2 8h9M5.2 12h9M2.4 4h.01M2.4 8h.01M2.4 12h.01"/></symbol>
<symbol id="i-users" viewBox="0 0 16 16"><circle cx="6" cy="5.4" r="2.4"/><path d="M1.6 13.6c0-2.4 2-3.9 4.4-3.9s4.4 1.5 4.4 3.9"/><path d="M11 3.3a2.4 2.4 0 0 1 0 4.2M12 9.9c1.6.5 2.4 1.8 2.4 3.7"/></symbol>
<symbol id="i-bank" viewBox="0 0 16 16"><path d="M2 6.4 8 2.4l6 4M3.4 6.4v6M6.4 6.4v6M9.6 6.4v6M12.6 6.4v6M2 13.6h12"/></symbol>
<symbol id="i-doc" viewBox="0 0 16 16"><path d="M3.6 1.6h5.9L12.4 5v9.4h-8.8z"/><path d="M9.5 1.6V5h2.9"/></symbol>
<symbol id="i-gear" viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.3"/><path d="M8 1.6v2.1M8 12.3v2.1M1.6 8h2.1M12.3 8h2.1M3.5 3.5l1.5 1.5M11 11l1.5 1.5M12.5 3.5 11 5M5 11l-1.5 1.5"/></symbol>
<symbol id="i-log" viewBox="0 0 16 16"><path d="M2.4 3.4h11.2M2.4 8h11.2M2.4 12.6h7"/></symbol>
<symbol id="i-info" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.8"/><path d="M8 7.4v4M8 4.9h.01"/></symbol>
<symbol id="i-search" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.4"/><path d="m10.5 10.5 3.4 3.4"/></symbol>
<symbol id="i-plus" viewBox="0 0 16 16"><path d="M8 2.8v10.4M2.8 8h10.4"/></symbol>
<symbol id="i-copy" viewBox="0 0 16 16"><rect x="5.4" y="5.4" width="8.2" height="8.2" rx="1"/><path d="M10.6 5.4V3.4a1 1 0 0 0-1-1H3.4a1 1 0 0 0-1 1v6.2a1 1 0 0 0 1 1h2"/></symbol>
<symbol id="i-trash" viewBox="0 0 16 16"><path d="M2.8 4.2h10.4M6.2 4.2V2.8h3.6v1.4M4.2 4.2l.7 9h6.2l.7-9"/></symbol>
<symbol id="i-export" viewBox="0 0 16 16"><path d="M8 10.6V2.4M5.2 5.2 8 2.4l2.8 2.8"/><path d="M2.8 10.2v2.4a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1v-2.4"/></symbol>
<symbol id="i-refresh" viewBox="0 0 16 16"><path d="M13.4 8A5.4 5.4 0 1 1 11.6 4"/><path d="M13.7 1.6v3.1h-3.1"/></symbol>
<symbol id="i-burger" viewBox="0 0 16 16"><path d="M2.4 4h11.2M2.4 8h11.2M2.4 12h11.2"/></symbol>
</defs></svg>`;

/* ---------- části stránky ---------- */

function grid(prehled: Prehled, s: Souhrn): string {
  const hlavicky = prehled.osoby.map((o) => `<th class="osoba col-num">${esc(o.jmeno)}</th>`).join('');

  const radky = s.radky
    .map((r, i) => {
      const p = r.polozka;
      const bunky = prehled.osoby
        .map((o) => {
          const v = r.naOsobu.get(o.id) ?? 0;
          const text = v === 0 ? '—' : r.jednorazovy ? formatKcZnamenko(v) : formatKc(v);
          return `<td class="col-num osoba-cell${v === 0 ? ' zero' : ''}${v < 0 ? ' minus' : ''}">${text}</td>`;
        })
        .join('');

      const stav =
        p.castka_celkem === 0
          ? '<span class="s-warn"><span class="dot"></span>chybí částka</span>'
          : r.nerozdeleno !== 0
            ? `<span class="s-warn"><span class="dot"></span>zbývá ${formatKc(r.nerozdeleno)}</span>`
            : '<span class="s-ok"><span class="dot"></span>rozděleno</span>';

      // Druh nese barevný čtvereček, ne pilulka — barva je informace, ne dekorace.
      const kdy = r.jednorazovy && p.datum ? p.datum.split('-').reverse().join('. ') : popisPeriody(p.perioda);

      return `<tr data-id="${p.id}"${i === 0 ? ' data-selected="true"' : ''} tabindex="0">
  <td class="nazev">${esc(p.nazev)}${p.poznamka ? ` <span class="pozn">— ${esc(p.poznamka)}</span>` : ''}</td>
  <td class="col-druh"><span class="druh d-${p.druh}"><span class="dot"></span>${popisDruhu(p.druh)}</span></td>
  <td class="col-per">${esc(kdy)}</td>
  <td class="col-num">${p.castka_celkem === 0 ? '—' : formatKc(p.castka_celkem)}</td>
  <td class="col-num${r.castka < 0 ? ' minus' : ''}">${
    r.castka === 0 ? '—' : r.jednorazovy ? formatKcZnamenko(r.castka) : formatKc(r.castka)
  }</td>
  ${bunky}
  <td class="col-stav">${stav}</td>
</tr>`;
    })
    .join('\n');

  const soucty = (mapa: Map<number, number>, seZnamenkem: boolean): string =>
    prehled.osoby
      .map((o) => {
        const v = mapa.get(o.id) ?? 0;
        return `<td class="col-num osoba-cell${v < 0 ? ' minus' : ''}">${
          seZnamenkem ? formatKcZnamenko(v) : formatKc(v)
        }</td>`;
      })
      .join('');

  return `<div class="gridwrap">
  <table id="grid">
    <thead><tr>
      <th>Položka</th><th class="col-druh">Druh</th><th class="col-per">Perioda / datum</th>
      <th class="col-num">Za období</th><th class="col-num">Měsíčně / jednorázově</th>
      ${hlavicky}
      <th class="col-stav">Stav</th>
    </tr></thead>
    <tbody>${radky}</tbody>
    <tfoot>
      <tr>
        <td>Pravidelné náklady měsíčně</td><td></td><td></td><td></td>
        <td class="col-num">${formatKc(s.mesicneCelkem)}</td>
        ${soucty(s.mesicneOsoba, false)}
        <td></td>
      </tr>
      <tr>
        <td>Jednorázové saldo <span class="pozn">(do dlužné částky)</span></td><td></td><td></td><td></td>
        <td class="col-num${s.saldoCelkem < 0 ? ' minus' : ''}">${formatKcZnamenko(s.saldoCelkem)}</td>
        ${soucty(s.saldoOsoba, true)}
        <td></td>
      </tr>
    </tfoot>
  </table>
</div>`;
}

function detail(prehled: Prehled): string {
  const periody = (['mesicne', 'ctvrtletne', 'pololetne', 'rocne', 'jednorazove'] as const)
    .map((p) => `<option value="${p}">${popisPeriody(p)}</option>`)
    .join('');
  const druhy = DRUHY.map((d) => `<option value="${d}">${popisDruhu(d)}</option>`).join('');
  const osoby = prehled.osoby.map((o) => `<option value="${o.id}">${esc(o.jmeno)}</option>`).join('');

  // Řádek na osobu. Kdo není zaškrtnutý, na položce se nepodílí — kombinace
  // se u každé položky liší, žádné pevné dvojice.
  const podily = prehled.osoby
    .map(
      (o) => `<div class="podil" data-radek="${o.id}">
      <label class="kdo"><input type="checkbox" data-zapojen="${o.id}" /> ${esc(o.jmeno)}</label>
      <select data-rezim="${o.id}" aria-label="Režim podílu ${esc(o.jmeno)}">
        <option value="procento">procento</option><option value="castka">částka</option>
      </select>
      <input type="text" data-hodnota="${o.id}" inputmode="decimal" aria-label="Podíl ${esc(o.jmeno)}" />
      <span class="vysledek" data-vysledek="${o.id}">—</span>
    </div>`,
    )
    .join('');

  return `<section class="detail">
  <div class="panehead"><svg class="icon icon-sm"><use href="#i-doc"/></svg><span id="d-titulek">Detail položky</span></div>
  <div class="body">
    <div class="frow"><label for="d-nazev">Název</label><input type="text" id="d-nazev" /></div>
    <div class="frow2">
      <div class="frow"><label for="d-druh">Druh</label><select id="d-druh">${druhy}</select></div>
      <div class="frow"><label for="d-castka">Částka</label><input type="text" id="d-castka" inputmode="decimal" /></div>
    </div>
    <div class="frow2">
      <div class="frow" id="w-perioda"><label for="d-perioda">Perioda</label><select id="d-perioda">${periody}</select></div>
      <div class="frow" id="w-datum"><label for="d-datum">Datum</label><input type="date" id="d-datum" /></div>
    </div>
    <div class="frow2">
      <div class="frow"><label for="d-kategorie">Kategorie</label><input type="text" id="d-kategorie" /></div>
      <div class="frow"><label for="d-hradi">Fakturu platí</label><select id="d-hradi"><option value="">—</option>${osoby}</select></div>
    </div>
    <div class="frow"><label for="d-poznamka">Poznámka</label><textarea id="d-poznamka"></textarea></div>

    <div class="subhead">Kdo se skládá
      <button class="tbtn" type="button" id="d-rovnym">Rovným dílem</button>
    </div>
    ${podily}
    <div class="zbytek" id="d-zbytek"><span>Nerozděleno</span><b>0 Kč</b></div>
    <div class="dopad" id="d-dopad"></div>
    <span class="note">Odškrtnutá osoba se na položce nepodílí. Zbytek se nikam neschová — zůstane vidět tady i v seznamu.</span>
  </div>
  <div class="foot">
    <button class="btn primary" disabled title="Zapojí se s vazbou na databázi">Uložit</button>
    <button class="btn" disabled>Zahodit změny</button>
    <span class="note">ukládání čeká na napojení databáze</span>
  </div>
</section>`;
}

export function renderAdmin(prehled: Prehled, datum: string): string {
  const s = spocitej(prehled);

  const stavOsob = prehled.osoby
    .map((o: Osoba) => {
      const saldo = s.saldoOsoba.get(o.id) ?? 0;
      return `<span>${esc(o.jmeno)} <b>${formatKc(s.mesicneOsoba.get(o.id) ?? 0)}</b>/měs${
        saldo !== 0 ? ` <span class="saldo">${formatKcZnamenko(saldo)}</span>` : ''
      }</span>`;
    })
    .join('');

  // Model pro detailní panel — klient jen přepíná, co je vidět.
  const model = JSON.stringify({
    osoby: prehled.osoby,
    polozky: prehled.polozky.map((p) => ({
      id: p.id,
      nazev: p.nazev,
      kategorie: p.kategorie ?? '',
      castka: p.castka_celkem,
      perioda: p.perioda,
      druh: p.druh,
      datum: p.datum ?? '',
      hradi: p.hradi_member_id,
      poznamka: p.poznamka ?? '',
      podily: p.podily,
    })),
  }).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Náklady domu ${esc(prehled.nazev_domu)} — FIO-uhrady</title>
<style>${CSS}</style>
</head>
<body>
${SYMBOLY}
<div class="app">

  <header class="titlebar">
    <button class="burger" type="button" id="burger" aria-label="Menu" aria-expanded="false" aria-controls="nav">
      <svg class="icon"><use href="#i-burger"/></svg>
    </button>
    <div class="brand"><span class="mark"></span>FIO-uhrady<span class="org">— ${esc(prehled.nazev_domu)}</span></div>
    <span class="sep"></span>
    <div class="field">
      <label for="obdobi">Období</label>
      <select id="obdobi"><option>aktuální nastavení</option><option>rok 2026</option><option>rok 2025</option></select>
    </div>
    <div class="search">
      <svg class="icon icon-sm"><use href="#i-search"/></svg>
      <input id="filtr" type="search" placeholder="Filtr položek…" autocomplete="off" />
    </div>
    <span class="spacer"></span>
    <span class="chip"><svg class="icon icon-sm"><use href="#i-refresh"/></svg>Stav k ${esc(datum)}</span>
  </header>

  <div class="backdrop" id="backdrop"></div>

  <nav class="nav" id="nav">
    <button class="navitem" type="button"><svg class="icon"><use href="#i-grid"/></svg>Přehled</button>
    <button class="navitem" type="button" aria-current="true"><svg class="icon"><use href="#i-list"/></svg>Náklady domu</button>
    <button class="navitem" type="button"><svg class="icon"><use href="#i-users"/></svg>Osoby</button>
    <button class="navitem" type="button"><svg class="icon"><use href="#i-bank"/></svg>Úhrady z Fio</button>
    <button class="navitem" type="button"><svg class="icon"><use href="#i-doc"/></svg>Předpisy a dluhy</button>

    <div class="navgroup-label">Správa</div>
    <button class="navitem" type="button"><svg class="icon"><use href="#i-gear"/></svg>Nastavení</button>
    <button class="navitem" type="button"><svg class="icon"><use href="#i-log"/></svg>Log synchronizace</button>
    <button class="navitem" type="button"><svg class="icon"><use href="#i-info"/></svg>O aplikaci</button>
  </nav>

  <main class="main">
    <section class="list">
      <div class="panehead">
        <svg class="icon icon-sm"><use href="#i-list"/></svg>Náklady domu
        <span class="count" id="pocet">${prehled.polozky.length} položek</span>
      </div>
      <div class="toolbar">
        <button class="tbtn primary" type="button"><svg class="icon icon-sm"><use href="#i-plus"/></svg>Přidat položku</button>
        <span class="sep"></span>
        <button class="tbtn" type="button"><svg class="icon icon-sm"><use href="#i-copy"/></svg>Duplikovat</button>
        <button class="tbtn" type="button"><svg class="icon icon-sm"><use href="#i-trash"/></svg>Smazat</button>
        <span class="sep"></span>
        <button class="tbtn" type="button"><svg class="icon icon-sm"><use href="#i-export"/></svg>Export CSV</button>
      </div>
      ${grid(prehled, s)}
    </section>
    ${detail(prehled)}
  </main>

  <footer class="status">
    <span>Pravidelné <b>${formatKc(s.mesicneCelkem)}</b>/měs</span>
    <span>ročně <b>${formatKc(s.rocneCelkem)}</b></span>
    <span>jednorázové saldo <b>${formatKcZnamenko(s.saldoCelkem)}</b></span>
    ${stavOsob}
    <span class="warn">nedokončených <b>${s.nedokoncenych}</b></span>
    <span class="spacer"></span>
    <span>ukázková data, ukládání zatím nenapojené</span>
  </footer>
</div>

<script>
const MODEL = ${model};
const kc = (h) => new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 }).format(h / 100);
const kcZn = (h) => (h > 0 ? '+' : h < 0 ? '−' : '') + kc(Math.abs(h));
const el = (id) => document.getElementById(id);
const q = (sel) => document.querySelector(sel);
const DELITEL = { mesicne: 1, ctvrtletne: 3, pololetne: 6, rocne: 12, jednorazove: 0 };
const jednorazovy = (druh) => druh !== 'pravidelny';

function prepocitej() {
  const druh = el('d-druh').value;
  const jedno = jednorazovy(druh);

  // U jednorázových nedává perioda smysl, u pravidelných zase datum.
  el('w-perioda').style.display = jedno ? 'none' : '';
  el('w-datum').style.display = jedno ? '' : 'none';

  const celkem = Math.round((parseFloat(el('d-castka').value.replace(/\\s/g, '').replace(',', '.')) || 0) * 100);
  let rozdeleno = 0;

  for (const o of MODEL.osoby) {
    const zapojen = q('[data-zapojen="' + o.id + '"]').checked;
    q('.podil[data-radek="' + o.id + '"]').dataset.off = zapojen ? 'false' : 'true';
    const cil = q('[data-vysledek="' + o.id + '"]');
    if (!zapojen) { cil.textContent = '—'; continue; }
    const rezim = q('[data-rezim="' + o.id + '"]').value;
    const n = parseFloat(q('[data-hodnota="' + o.id + '"]').value.replace(/\\s/g, '').replace(',', '.')) || 0;
    const castka = rezim === 'castka' ? Math.round(n * 100) : Math.round(celkem * n / 100);
    rozdeleno += castka;
    cil.textContent = kc(castka);
  }

  const zbytek = celkem - rozdeleno;
  const box = el('d-zbytek');
  box.querySelector('b').textContent = kc(zbytek);
  box.classList.toggle('warn', zbytek !== 0);

  // Co položka udělá se souhrnem — ať je to vidět dřív, než se uloží.
  const zn = druh === 'preplatek' ? -1 : 1;
  const del = DELITEL[el('d-perioda').value] || 0;
  el('d-dopad').innerHTML = jedno
    ? '<span>Dopad do dlužné částky</span><b>' + kcZn(zn * celkem) + '</b>'
    : '<span>Měsíčně z toho</span><b>' + kc(del ? Math.round(celkem / del) : 0) + '</b>';
}

function ukazPolozku(id) {
  const p = MODEL.polozky.find((x) => x.id === id);
  if (!p) return;
  el('d-titulek').textContent = p.nazev;
  el('d-nazev').value = p.nazev;
  el('d-castka').value = p.castka ? String(p.castka / 100) : '';
  el('d-perioda').value = p.perioda;
  el('d-druh').value = p.druh;
  el('d-datum').value = p.datum;
  el('d-kategorie').value = p.kategorie;
  el('d-hradi').value = p.hradi === null ? '' : String(p.hradi);
  el('d-poznamka').value = p.poznamka;

  for (const o of MODEL.osoby) {
    const podil = p.podily.find((x) => x.member_id === o.id);
    q('[data-zapojen="' + o.id + '"]').checked = Boolean(podil);
    q('[data-rezim="' + o.id + '"]').value = podil ? podil.rezim : 'procento';
    q('[data-hodnota="' + o.id + '"]').value = podil ? String(podil.hodnota / 100) : '';
  }
  prepocitej();
}

// „Lucka s dědou", „Eliška s dědou" — zaškrtni, kdo se skládá, a rozpočítej.
el('d-rovnym').addEventListener('click', () => {
  const zapojeni = MODEL.osoby.filter((o) => q('[data-zapojen="' + o.id + '"]').checked);
  if (zapojeni.length === 0) return;
  const dil = Math.round((100 / zapojeni.length) * 100) / 100;
  let zbyva = 100;
  zapojeni.forEach((o, i) => {
    const hodnota = i === zapojeni.length - 1 ? Math.round(zbyva * 100) / 100 : dil;
    zbyva -= hodnota;
    q('[data-rezim="' + o.id + '"]').value = 'procento';
    q('[data-hodnota="' + o.id + '"]').value = String(hodnota);
  });
  prepocitej();
});

const app = q('.app');
const zavriMenu = () => { app.removeAttribute('data-nav'); el('burger').setAttribute('aria-expanded', 'false'); };
el('burger').addEventListener('click', () => {
  const otevreno = app.getAttribute('data-nav') === 'open';
  if (otevreno) zavriMenu();
  else { app.setAttribute('data-nav', 'open'); el('burger').setAttribute('aria-expanded', 'true'); }
});
el('backdrop').addEventListener('click', zavriMenu);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') zavriMenu(); });
document.querySelectorAll('.navitem').forEach((b) => b.addEventListener('click', zavriMenu));

document.querySelectorAll('#grid tbody tr').forEach((tr) => {
  const vyber = () => {
    document.querySelectorAll('#grid tbody tr').forEach((x) => x.removeAttribute('data-selected'));
    tr.setAttribute('data-selected', 'true');
    ukazPolozku(Number(tr.dataset.id));
    // Na mobilu je detail pod seznamem — po výběru se k němu doroluj.
    if (window.matchMedia('(max-width: 860px)').matches) {
      q('.detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  tr.addEventListener('click', vyber);
  tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); vyber(); } });
});

q('.detail').addEventListener('input', prepocitej);
q('.detail').addEventListener('change', prepocitej);

el('filtr').addEventListener('input', (e) => {
  const dotaz = e.target.value.trim().toLowerCase();
  let videt = 0;
  document.querySelectorAll('#grid tbody tr').forEach((tr) => {
    const shoda = tr.textContent.toLowerCase().includes(dotaz);
    tr.style.display = shoda ? '' : 'none';
    if (shoda) videt++;
  });
  el('pocet').textContent = videt + (videt === 1 ? ' položka' : videt >= 2 && videt <= 4 ? ' položky' : ' položek');
});

ukazPolozku(MODEL.polozky[0].id);
</script>
</body>
</html>`;
}
