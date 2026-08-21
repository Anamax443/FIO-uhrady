/**
 * Společný shell aplikace — vzhled podle repa Interface-Par (hustý „IT-ops"
 * layout inspirovaný WinBoxem): titulní lišta → boční menu → obsah → stavový
 * řádek. Tokeny v `:root` jsou převzaté odtamtud, ať appky vypadají stejně.
 *
 * Stránky (náklady, nastavení) dodávají jen obsah a stavový řádek.
 */

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Ikona do ouška prohlížeče — jinak tam svítí obecný globus.
 *
 * Je to ta samá značka jako v titulní liště (rámeček se dvěma řádky, „soupis"),
 * jen vyplněná, aby byla čitelná i na 16 px. SVG přímo v adrese: žádný další
 * požadavek na server a nic, co by šlo zapomenout nasadit. `#` musí být `%23`,
 * jinak by ho prohlížeč vzal jako kotvu a ikona by se nenačetla.
 */
export const FAVICON =
  `<link rel="icon" href="data:image/svg+xml,` +
  `%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E` +
  `%3Crect width='32' height='32' rx='6' fill='%2331628c'/%3E` +
  `%3Crect x='8' y='10' width='16' height='3' rx='1.5' fill='%23fff'/%3E` +
  `%3Crect x='8' y='17' width='11' height='3' rx='1.5' fill='%23fff'/%3E` +
  `%3C/svg%3E" />`;

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

export const CSS = `
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
.brand { display: flex; align-items: center; gap: 7px; font-weight: 600; white-space: nowrap; color: inherit; text-decoration: none; }
.brand .mark { width: 15px; height: 15px; flex: none; border: 1.5px solid var(--accent); border-radius: 2px; position: relative; }
.brand .mark::after { content: ""; position: absolute; inset: 3px 3px auto 3px; height: 1.5px; background: var(--accent); box-shadow: 0 3px 0 var(--accent); }
.brand .org { color: var(--text-dim); font-weight: 400; }
.titlebar .sep { width: 1px; align-self: stretch; margin: 6px 2px; background: var(--border); }
.field { display: flex; align-items: center; gap: 6px; color: var(--text-dim); }
.field label { white-space: nowrap; }
select, input[type="search"], input[type="text"], input[type="date"], input[type="password"], textarea {
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
.navitem { display: flex; align-items: center; gap: 9px; width: 100%; height: 27px; padding: 0 8px 0 11px; border: 0; background: none; font: inherit; color: var(--text); text-align: left; cursor: default; text-decoration: none; }
.navitem:hover { background: var(--hover); }
.navitem .icon { color: var(--text-dim); }
.navitem[aria-current="page"] { background: var(--accent-soft); box-shadow: inset 2px 0 0 var(--accent); font-weight: 600; }
.navitem[aria-current="page"] .icon { color: var(--accent); }
.navitem:disabled { color: var(--text-faint); }
.navitem:disabled .icon { opacity: .55; }
.navgroup-label { padding: 11px 11px 4px; font-size: 10.5px; letter-spacing: .55px; text-transform: uppercase; color: var(--text-faint); }

/* obsah */
.main { grid-area: main; display: grid; min-width: 0; background: var(--pane); }
.panehead { display: flex; align-items: center; gap: 7px; height: 26px; padding: 0 9px; background: var(--accent-soft); border-bottom: 1px solid var(--border); font-weight: 600; }
.panehead .icon { color: var(--accent); }
.panehead .count { margin-left: auto; font-weight: 400; color: var(--text-dim); font-variant-numeric: tabular-nums; }

.toolbar { display: flex; align-items: center; gap: 1px; height: 30px; padding: 0 5px; background: var(--chrome-hi); border-bottom: 1px solid var(--border); overflow-x: auto; }
.tbtn { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px; border: 1px solid transparent; border-radius: 2px; background: none; font: inherit; color: var(--text); white-space: nowrap; cursor: default; text-decoration: none; }
.tbtn .icon { color: var(--text-dim); }
.tbtn:hover:not(:disabled) { background: var(--pane); border-color: var(--border); }
.tbtn:active:not(:disabled) { background: var(--hover); }
.tbtn:disabled { color: var(--text-faint); }
.tbtn:disabled .icon { color: var(--text-faint); opacity: .6; }
.tbtn.primary .icon { color: var(--accent); }
.toolbar .sep { width: 1px; height: 16px; margin: 0 5px; background: var(--border); flex: none; }

/* tabulky */
.gridwrap { flex: 1; overflow: auto; }
table { border-collapse: collapse; width: 100%; }
thead th { position: sticky; top: 0; z-index: 5; height: 25px; padding: 0 8px; background: var(--head); border-bottom: 1px solid var(--border); border-right: 1px solid var(--border-soft); font-weight: 600; font-size: 11.5px; color: var(--text-dim); text-align: left; white-space: nowrap; user-select: none; }
thead th.osoba { text-align: right; }
tbody td { height: 26px; padding: 0 8px; border-bottom: 1px solid var(--border-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
tbody tr:nth-child(even) { background: var(--row-alt); }
tbody tr:hover td { background: var(--hover); }
tbody tr[data-selected="true"] td { background: var(--accent-soft); }
tbody tr[data-selected="true"] td:first-child { box-shadow: inset 2px 0 0 var(--accent); }
tfoot td { position: sticky; bottom: 0; height: 25px; padding: 0 8px; background: var(--head); border-top: 1px solid var(--border); font-weight: 600; white-space: nowrap; }
.col-num { text-align: right; font-variant-numeric: tabular-nums; font-family: var(--mono); font-size: 11.5px; }
.col-num.minus { color: var(--ok); }
.zero { color: var(--text-faint); }
.mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }

.dot { display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 1px; background: var(--idle); }
.s-ok .dot { background: var(--ok); }
.s-warn { color: var(--warn); }
.s-warn .dot { background: var(--warn); }
.s-crit { color: var(--crit); }
.s-crit .dot { background: var(--crit); }

.btn { height: 23px; padding: 0 10px; border: 1px solid var(--border); border-radius: 2px; background: var(--pane); font: inherit; color: var(--text); cursor: default; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); font-weight: 600; }
.btn:disabled, .btn.primary:disabled { background: var(--chrome-hi); border-color: var(--border); color: var(--text-faint); font-weight: 400; }
.note { color: var(--text-faint); }
input[type="checkbox"] { width: 13px; height: 13px; margin: 0; accent-color: var(--accent); flex: none; }

/* hlášky */
.hlaska { display: flex; align-items: center; gap: 7px; padding: 6px 9px; border-bottom: 1px solid var(--border); }
/* Bez tohohle „display: flex" přebije [hidden] z prohlížeče a schovaná hláška
   zůstane viset na obrazovce i s textem, který už neplatí. */
.hlaska[hidden] { display: none; }
.hlaska.ok { background: var(--accent-soft); }
.hlaska.chyba { background: rgba(169, 59, 49, .13); color: var(--crit); }

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
@media (max-width: 1180px) { .search input { width: 130px; } }

/* úzké okno a mobil: menu je výsuvné a stránka se scrolluje jako celek.
   Snaha vecpat dva panely do 100vh na telefonu dopadne tak, že se obsah
   ořízne a nedá se k němu dostat — proto tu výška ustoupí. */
@media (max-width: 860px) {
  html, body { height: auto; }
  .app {
    height: auto; min-height: 100vh;
    grid-template-columns: 1fr;
    grid-template-rows: 33px auto auto;
    grid-template-areas: "title" "main" "status";
  }
  .burger { display: inline-flex; }
  .titlebar { position: sticky; top: 0; z-index: 20; }
  .titlebar .field, .titlebar .sep { display: none; }
  .titlebar .chip { display: none; }
  .search { flex: 1; min-width: 0; }
  .search input { width: 100%; }
  .brand .org { display: none; }

  .nav {
    position: fixed; top: 33px; bottom: 0; left: 0; width: 214px; z-index: 30;
    transform: translateX(-100%); transition: transform .14s ease-out; box-shadow: var(--shadow);
  }
  .app[data-nav="open"] .nav { transform: none; }
  .app[data-nav="open"] .backdrop { display: block; position: fixed; inset: 33px 0 0 0; z-index: 25; background: rgba(0, 0, 0, .34); }
  .navitem { height: 38px; }

  .main { display: block; }
  .gridwrap { overflow-x: auto; }
  .status { flex-wrap: wrap; gap: 2px 0; padding: 5px 9px; font-size: 11px; }
  .status > span { border-right: 0; padding: 0 10px 0 0; }
  .status .spacer { display: none; }
}

/* telefon: tabulka po sloupcích se přečíst nedá, každý řádek je karta */
@media (max-width: 560px) {
  table, thead, tbody, tfoot, tr, td { display: block; width: auto; }
  thead { display: none; }
  table { min-width: 0; }
  tbody tr { padding: 7px 9px; border-bottom: 1px solid var(--border); }
  tbody tr:nth-child(even) { background: transparent; }
  tbody td { height: auto; padding: 1px 0; white-space: normal; text-align: left; border: 0; }
  tbody td:empty { display: none; }
  tbody td[data-popis]::before {
    content: attr(data-popis) ": ";
    color: var(--text-dim);
  }
  tbody tr[data-selected="true"] td:first-child { box-shadow: none; }
  tbody tr[data-selected="true"] { box-shadow: inset 2px 0 0 var(--accent); background: var(--accent-soft); }
  tfoot tr { padding: 7px 9px; border-top: 2px solid var(--border); background: var(--head); }
  tfoot td { position: static; height: auto; padding: 1px 0; border: 0; }
  .col-num { text-align: left; }
}
`;

export const SYMBOLY = `
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
<symbol id="i-edit" viewBox="0 0 16 16"><path d="M11.4 2.3a1.6 1.6 0 0 1 2.3 2.3L5.6 12.7l-3 .7.7-3z"/><path d="M10.2 3.5 12.5 5.8"/></symbol>
<symbol id="i-ai" viewBox="0 0 16 16"><path d="M2.4 3.4h11.2v7.4H8l-3.4 2.8v-2.8H2.4z"/><path d="M6.2 6.2h3.6M6.2 8.4h2.2"/></symbol>
<symbol id="i-copy" viewBox="0 0 16 16"><rect x="5.4" y="5.4" width="8.2" height="8.2" rx="1"/><path d="M10.6 5.4V3.4a1 1 0 0 0-1-1H3.4a1 1 0 0 0-1 1v6.2a1 1 0 0 0 1 1h2"/></symbol>
<symbol id="i-trash" viewBox="0 0 16 16"><path d="M2.8 4.2h10.4M6.2 4.2V2.8h3.6v1.4M4.2 4.2l.7 9h6.2l.7-9"/></symbol>
<symbol id="i-export" viewBox="0 0 16 16"><path d="M8 10.6V2.4M5.2 5.2 8 2.4l2.8 2.8"/><path d="M2.8 10.2v2.4a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1v-2.4"/></symbol>
<symbol id="i-import" viewBox="0 0 16 16"><path d="M8 2.4v8.2M5.2 7.8 8 10.6l2.8-2.8"/><path d="M2.8 10.2v2.4a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1v-2.4"/></symbol>
<symbol id="i-refresh" viewBox="0 0 16 16"><path d="M13.4 8A5.4 5.4 0 1 1 11.6 4"/><path d="M13.7 1.6v3.1h-3.1"/></symbol>
<symbol id="i-lock" viewBox="0 0 16 16"><rect x="3.2" y="7" width="9.6" height="6.8" rx="1"/><path d="M5.4 7V5.2a2.6 2.6 0 0 1 5.2 0V7"/></symbol>
<symbol id="i-burger" viewBox="0 0 16 16"><path d="M2.4 4h11.2M2.4 8h11.2M2.4 12h11.2"/></symbol>
<symbol id="i-key" viewBox="0 0 16 16"><circle cx="5.2" cy="5.2" r="2.8"/><path d="m7.2 7.2 6 6M11.2 11.2l-1.4 1.4M13.2 9.2l-1.4 1.4"/></symbol>
</defs></svg>`;

type Stranka =
  | 'prehled' | 'naklady' | 'osoby' | 'uhrady' | 'vyrovnani' | 'uzaverky' | 'vyuctovani'
  | 'nastaveni' | 'log' | 'historie' | 'dokumentace' | 'oapp';

interface Polozka {
  klic: Stranka | null;
  href: string | null;
  ikona: string;
  popis: string;
}

const MENU: Polozka[] = [
  { klic: 'prehled', href: '/admin/prehled', ikona: 'i-grid', popis: 'Přehled' },
  { klic: 'naklady', href: '/admin', ikona: 'i-list', popis: 'Náklady domu' },
  { klic: 'osoby', href: '/admin/osoby', ikona: 'i-users', popis: 'Osoby' },
  { klic: 'uhrady', href: '/admin/uhrady', ikona: 'i-bank', popis: 'Úhrady z Fio' },
  { klic: 'vyrovnani', href: '/admin/vyrovnani', ikona: 'i-doc', popis: 'Příspěvky a vyrovnání' },
  { klic: 'uzaverky', href: '/admin/uzaverky', ikona: 'i-lock', popis: 'Uzávěrky' },
  { klic: 'vyuctovani', href: '/admin/vyuctovani', ikona: 'i-doc', popis: 'Vyúčtování' },
];

const MENU_SPRAVA: Polozka[] = [
  { klic: 'nastaveni', href: '/admin/nastaveni', ikona: 'i-gear', popis: 'Nastavení' },
  { klic: 'log', href: '/admin/log', ikona: 'i-log', popis: 'Log synchronizace' },
  { klic: 'historie', href: '/admin/historie', ikona: 'i-doc', popis: 'Historie změn' },
  { klic: 'dokumentace', href: '/admin/dokumentace', ikona: 'i-doc', popis: 'Dokumentace' },
  { klic: 'oapp', href: '/admin/o-aplikaci', ikona: 'i-info', popis: 'O aplikaci' },
];

const menuPolozka = (p: Polozka, aktivni: Stranka): string => {
  const ikona = `<svg class="icon"><use href="#${p.ikona}"/></svg>`;
  if (p.href === null) {
    return `<button class="navitem" type="button" disabled title="zatím nepostaveno">${ikona}${p.popis}</button>`;
  }
  const je = p.klic === aktivni;
  return `<a class="navitem" href="${p.href}"${je ? ' aria-current="page"' : ''}>${ikona}${p.popis}</a>`;
};

/**
 * Veřejný rozcestník na kořeni. Je vidět bez přihlášení, takže tu nesmí být
 * žádná data — jen kam jít a jestli aplikace žije.
 */
export function uvodniStranka(commit: string, bezi: boolean): string {
  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>FIO-uhrady</title>
${FAVICON}
<style>${CSS}
body { display: grid; place-items: center; padding: 24px; }
.karta { width: min(520px, 100%); background: var(--pane); border: 1px solid var(--border); border-radius: 2px; }
.karta .telo { padding: 16px 18px 18px; display: flex; flex-direction: column; gap: 12px; }
.karta h1 { margin: 0; font-size: 17px; }
.karta p { margin: 0; color: var(--text-dim); }
.odkazy { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
.odkazy .btn { display: inline-flex; align-items: center; gap: 6px; text-decoration: none; }
.paticka { display: flex; gap: 10px; flex-wrap: wrap; padding: 7px 18px; border-top: 1px solid var(--border); background: var(--chrome-hi); color: var(--text-dim); font-size: 11.5px; }
.paticka b { color: var(--text); font-weight: 600; }
</style>
</head>
<body>
${SYMBOLY}
<div class="karta">
  <div class="panehead"><span class="brand"><span class="mark"></span>FIO-uhrady</span></div>
  <div class="telo">
    <h1>Náklady domácnosti a příspěvky na ně</h1>
    <p>
      Aplikace počítá, co domácnost stojí, rozděluje náklady mezi členy a páruje příspěvky
      došlé na účet u Fio banky podle variabilního symbolu.
    </p>
    <div class="odkazy">
      <a class="btn primary" href="/admin"><svg class="icon icon-sm"><use href="#i-gear"/></svg>Správa</a>
    </div>
    <p class="note">
      Správa je chráněná přihlášením. Přehled pro členy domácnosti se otevírá vlastním
      odkazem, který dostanou — veřejnou adresu nemá.
    </p>
  </div>
  <div class="paticka">
    <span><span class="dot" style="background: var(--${bezi ? 'ok' : 'crit'})"></span>${
      bezi ? 'běží' : 'databáze neodpovídá'
    }</span>
    <span>verze <b class="mono">${esc(commit)}</b></span>
    <span class="spacer"></span>
    <span class="mono" id="hodiny">--:--:--</span>
  </div>
</div>
<script>
const hodiny = document.getElementById('hodiny');
const tik = () => { hodiny.textContent = new Date().toLocaleTimeString('cs-CZ'); };
tik();
setInterval(tik, 1000);
</script>
</body>
</html>`;
}

export interface Shell {
  aktivni: Stranka;
  nazevDomu: string;
  titulek: string;
  /** krátký hash nasazeného commitu — ať jde živá verze ověřit proti gitu */
  commit: string;
  /** obsah titulní lišty mezi značkou a pravým okrajem */
  listaExtra?: string;
  vpravo?: string;
  obsah: string;
  status: string;
  skript?: string;
}

export function shell(s: Shell): string {
  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(s.titulek)} — FIO-uhrady</title>
${FAVICON}
<style>${CSS}</style>
</head>
<body>
${SYMBOLY}
<div class="app">
  <header class="titlebar">
    <button class="burger" type="button" id="burger" aria-label="Menu" aria-expanded="false" aria-controls="nav">
      <svg class="icon"><use href="#i-burger"/></svg>
    </button>
    <a class="brand" href="/admin"><span class="mark"></span>FIO-uhrady<span class="org">— ${esc(s.nazevDomu)}</span></a>
    <span class="sep"></span>
    ${s.listaExtra ?? ''}
    <span class="spacer"></span>
    ${s.vpravo ?? ''}
    <span class="chip mono" id="hodiny" title="čas prohlížeče, běží živě">--:--:--</span>
    <span class="chip mono" title="nasazený commit — dá se ověřit proti gitu">${esc(s.commit)}</span>
  </header>

  <div class="backdrop" id="backdrop"></div>

  <nav class="nav" id="nav">
    ${MENU.map((p) => menuPolozka(p, s.aktivni)).join('\n    ')}
    <div class="navgroup-label">Správa</div>
    ${MENU_SPRAVA.map((p) => menuPolozka(p, s.aktivni)).join('\n    ')}
  </nav>

  <main class="main">${s.obsah}</main>

  <footer class="status">${s.status}</footer>
</div>

<script>
const app = document.querySelector('.app');
const burger = document.getElementById('burger');
const zavriMenu = () => { app.removeAttribute('data-nav'); burger.setAttribute('aria-expanded', 'false'); };
burger.addEventListener('click', () => {
  if (app.getAttribute('data-nav') === 'open') zavriMenu();
  else { app.setAttribute('data-nav', 'open'); burger.setAttribute('aria-expanded', 'true'); }
});
document.getElementById('backdrop').addEventListener('click', zavriMenu);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') zavriMenu(); });

// Běžící čas v hlavičce: hned a pak každou vteřinu, ať je poznat, že stránka žije.
const hodiny = document.getElementById('hodiny');
const tik = () => { hodiny.textContent = new Date().toLocaleTimeString('cs-CZ'); };
tik();
setInterval(tik, 1000);
</script>
${s.skript ?? ''}
</body>
</html>`;
}
