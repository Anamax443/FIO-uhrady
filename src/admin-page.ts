/**
 * Frontend admina — přehled nákladů domu a jejich rozpad na platební jednotky.
 *
 * Kreslí se z `Prehled` (viz sample.ts). Vazba na databázi přijde v dalším kroku;
 * proto je ukládání ve formuláři zatím vypnuté a je to na stránce vidět.
 */
import { formatKc, formatProcento, mesicne, popisPeriody, rozpad } from './money.js';
import type { Jednotka, Polozka, Prehled } from './sample.js';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CSS = `
:root {
  --bg: #f1f3f2;
  --surface: #ffffff;
  --surface-2: #f7f9f8;
  --ink: #17211e;
  --muted: #5c6b66;
  --line: #dce2df;
  --accent: #2c6b5a;
  --accent-soft: #e4efea;
  --warn: #8a5a06;
  --warn-soft: #f9efd9;
  --crit: #a33421;
  --shadow: 0 1px 2px rgba(23, 33, 30, .06), 0 8px 24px rgba(23, 33, 30, .05);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #121815; --surface: #1a211e; --surface-2: #212927; --ink: #e6ebe8;
    --muted: #99a8a1; --line: #29332f; --accent: #6fbba3; --accent-soft: #1e2e29;
    --warn: #d9a441; --warn-soft: #2b2519; --crit: #e2705a;
    --shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 8px 24px rgba(0, 0, 0, .25);
  }
}
:root[data-theme="dark"] {
  --bg: #121815; --surface: #1a211e; --surface-2: #212927; --ink: #e6ebe8;
  --muted: #99a8a1; --line: #29332f; --accent: #6fbba3; --accent-soft: #1e2e29;
  --warn: #d9a441; --warn-soft: #2b2519; --crit: #e2705a;
  --shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 8px 24px rgba(0, 0, 0, .25);
}
:root[data-theme="light"] {
  --bg: #f1f3f2; --surface: #ffffff; --surface-2: #f7f9f8; --ink: #17211e;
  --muted: #5c6b66; --line: #dce2df; --accent: #2c6b5a; --accent-soft: #e4efea;
  --warn: #8a5a06; --warn-soft: #f9efd9; --crit: #a33421;
  --shadow: 0 1px 2px rgba(23, 33, 30, .06), 0 8px 24px rgba(23, 33, 30, .05);
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 15px/1.5 system-ui, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1180px; margin: 0 auto; padding: 32px 20px 72px; display: flex; flex-direction: column; gap: 28px; }
h1, h2, h3 { font-family: Georgia, "Iowan Old Style", "Times New Roman", serif; font-weight: 600; margin: 0; text-wrap: balance; }
h1 { font-size: 30px; letter-spacing: -.01em; }
h2 { font-size: 19px; }
.num { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-variant-numeric: tabular-nums; }
.eyebrow { font-size: 11px; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); font-weight: 600; }

header.page { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end; justify-content: space-between; }
header.page .sub { color: var(--muted); font-size: 14px; margin-top: 4px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }

.btn {
  font: inherit; font-size: 14px; border-radius: 7px; padding: 9px 14px; cursor: pointer;
  border: 1px solid var(--line); background: var(--surface); color: var(--ink); text-decoration: none;
  display: inline-flex; align-items: center; gap: 7px;
}
.btn:hover { border-color: var(--accent); color: var(--accent); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn.primary:hover { filter: brightness(1.08); color: #fff; border-color: var(--accent); }
.btn.quiet { background: transparent; }
.btn:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
.btn[disabled] { opacity: .5; cursor: not-allowed; }

.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; }
.tile {
  background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px;
  box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 6px;
}
.tile.total { background: var(--accent-soft); border-color: transparent; }
.tile .val { font-size: 27px; font-weight: 600; letter-spacing: -.02em; }
.tile .val.small { font-size: 22px; }
.tile .meta { font-size: 12.5px; color: var(--muted); }
.bar { height: 4px; border-radius: 2px; background: var(--line); overflow: hidden; margin-top: 2px; }
.bar > i { display: block; height: 100%; background: var(--accent); }

.card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); overflow: hidden; }
.card > .head { padding: 16px 18px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.card > .head p { margin: 4px 0 0; color: var(--muted); font-size: 13px; }

.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
thead th { font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); font-weight: 600; white-space: nowrap; background: var(--surface-2); }
td.n, th.n { text-align: right; white-space: nowrap; }
tbody tr:hover { background: var(--surface-2); }
th.unit { text-align: right; }
th.unit small { display: block; text-transform: none; letter-spacing: 0; font-weight: 400; font-size: 11px; opacity: .85; }
td.unit { text-align: right; }
td.unit.zero { color: var(--muted); }
tr.group td { background: var(--surface-2); font-size: 11.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
tr.sum td { font-weight: 600; border-top: 2px solid var(--line); border-bottom: none; background: var(--surface-2); }
.item-name { font-weight: 500; }
.note { display: block; color: var(--muted); font-size: 12.5px; margin-top: 3px; max-width: 42ch; }
.rowact { display: flex; gap: 6px; justify-content: flex-end; }
.rowact a { font-size: 13px; color: var(--accent); text-decoration: none; border-bottom: 1px solid transparent; }
.rowact a:hover { border-bottom-color: currentColor; }

.chip { display: inline-block; font-size: 11.5px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
.chip.warn { background: var(--warn-soft); color: var(--warn); border-color: transparent; font-weight: 600; }
.chip.ok { background: var(--accent-soft); color: var(--accent); border-color: transparent; }

.banner { display: flex; gap: 10px; align-items: flex-start; background: var(--warn-soft); color: var(--warn); border-radius: 10px; padding: 12px 14px; font-size: 13.5px; }
.banner b { font-weight: 600; }

form.grid { padding: 18px; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px 18px; }
form.grid .full { grid-column: 1 / -1; }
label { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: var(--muted); font-weight: 600; }
input, select, textarea {
  font: inherit; font-size: 14px; color: var(--ink); background: var(--surface);
  border: 1px solid var(--line); border-radius: 7px; padding: 8px 10px; width: 100%;
}
textarea { resize: vertical; min-height: 62px; }
.split { border: 1px solid var(--line); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.split-row { display: grid; grid-template-columns: 1fr 130px 150px; gap: 10px; align-items: end; }
.formfoot { padding: 0 18px 18px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }

footer.page { color: var(--muted); font-size: 12.5px; display: flex; gap: 8px; flex-wrap: wrap; }
@media (max-width: 720px) {
  .split-row { grid-template-columns: 1fr; }
  h1 { font-size: 24px; }
}
`;

interface RadekPrehledu {
  polozka: Polozka;
  mesicniCelkem: number;
  naJednotku: Map<number, number>;
  mesicniNaJednotku: Map<number, number>;
  nerozdeleno: number;
}

export interface Souhrn {
  radky: RadekPrehledu[];
  mesicneCelkem: number;
  rocneCelkem: number;
  mesicneJednotka: Map<number, number>;
  nerozdelenoMesicne: number;
}

/** Spočítá, co dům stojí a kolik z toho padá na kterou jednotku. */
export function spocitej(prehled: Prehled): Souhrn {
  const radky: RadekPrehledu[] = [];
  const mesicneJednotka = new Map<number, number>();
  let mesicneCelkem = 0;
  let nerozdelenoMesicne = 0;

  for (const polozka of prehled.polozky) {
    const { naJednotku, nerozdeleno } = rozpad(polozka.castka_celkem, polozka.podily);
    const mesicniNaJednotku = new Map<number, number>();
    for (const [unitId, castka] of naJednotku) {
      const m = mesicne(castka, polozka.perioda);
      mesicniNaJednotku.set(unitId, m);
      mesicneJednotka.set(unitId, (mesicneJednotka.get(unitId) ?? 0) + m);
    }
    const mesicniCelkem = mesicne(polozka.castka_celkem, polozka.perioda);
    mesicneCelkem += mesicniCelkem;
    nerozdelenoMesicne += mesicne(nerozdeleno, polozka.perioda);
    radky.push({ polozka, mesicniCelkem, naJednotku, mesicniNaJednotku, nerozdeleno });
  }

  return {
    radky,
    mesicneCelkem,
    rocneCelkem: mesicneCelkem * 12,
    mesicneJednotka,
    nerozdelenoMesicne,
  };
}

const osobyJednotky = (j: Jednotka, prehled: Prehled): string =>
  j.osoby
    .map((id) => prehled.osoby.find((o) => o.id === id)?.jmeno ?? '?')
    .join(', ');

function tiles(prehled: Prehled, s: Souhrn): string {
  const jednotky = prehled.jednotky
    .map((j) => {
      const castka = s.mesicneJednotka.get(j.id) ?? 0;
      const podil = s.mesicneCelkem > 0 ? Math.round((castka / s.mesicneCelkem) * 100) : 0;
      return `
      <div class="tile">
        <span class="eyebrow">${esc(j.label)}</span>
        <span class="val small num">${formatKc(castka)}</span>
        <div class="bar"><i style="width:${podil}%"></i></div>
        <span class="meta">${podil} % nákladů domu · ${esc(osobyJednotky(j, prehled))}${
          j.vs ? ` · VS ${esc(j.vs)}` : ' · bez VS'
        }</span>
      </div>`;
    })
    .join('');

  const nerozdeleno =
    s.nerozdelenoMesicne !== 0
      ? `
      <div class="tile">
        <span class="eyebrow">Nerozděleno</span>
        <span class="val small num">${formatKc(s.nerozdelenoMesicne)}</span>
        <span class="meta">měsíčně, zatím bez přiřazené jednotky</span>
      </div>`
      : '';

  return `
  <section class="tiles">
    <div class="tile total">
      <span class="eyebrow">Celkem dům · měsíčně</span>
      <span class="val num">${formatKc(s.mesicneCelkem)}</span>
      <span class="meta">ročně ${formatKc(s.rocneCelkem)} · ${prehled.polozky.length} položek</span>
    </div>
    ${jednotky}${nerozdeleno}
  </section>`;
}

function tabulka(prehled: Prehled, s: Souhrn): string {
  const hlavicka = prehled.jednotky
    .map(
      (j) => `<th class="unit">${esc(j.label)}<small>${esc(osobyJednotky(j, prehled))}</small></th>`,
    )
    .join('');

  let posledniKategorie = '';
  const radky = s.radky
    .map((r) => {
      const p = r.polozka;
      const kat = p.kategorie ?? 'Ostatní';
      const skupina =
        kat !== posledniKategorie
          ? `<tr class="group"><td colspan="${5 + prehled.jednotky.length}">${esc(kat)}</td></tr>`
          : '';
      posledniKategorie = kat;

      const bunky = prehled.jednotky
        .map((j) => {
          const m = r.mesicniNaJednotku.get(j.id) ?? 0;
          const cela = r.naJednotku.get(j.id) ?? 0;
          const podil = p.podily.find((x) => x.unit_id === j.id);
          const titulek =
            podil?.rezim === 'procento'
              ? `${formatProcento(podil.hodnota)} % z ${formatKc(p.castka_celkem)} ${popisPeriody(p.perioda)}`
              : cela !== 0
                ? `${formatKc(cela)} ${popisPeriody(p.perioda)}`
                : 'nepodílí se';
          return `<td class="unit num${m === 0 ? ' zero' : ''}" title="${esc(titulek)}">${
            m === 0 ? '—' : formatKc(m)
          }</td>`;
        })
        .join('');

      const stav =
        p.castka_celkem === 0
          ? '<span class="chip warn">doplnit částku</span>'
          : r.nerozdeleno !== 0
            ? `<span class="chip warn">nerozděleno ${formatKc(r.nerozdeleno)}</span>`
            : '<span class="chip ok">rozděleno</span>';

      return `${skupina}
      <tr>
        <td>
          <span class="item-name">${esc(p.nazev)}</span>
          ${p.poznamka ? `<span class="note">${esc(p.poznamka)}</span>` : ''}
        </td>
        <td>${popisPeriody(p.perioda)}</td>
        <td class="n num">${p.castka_celkem === 0 ? '—' : formatKc(p.castka_celkem)}</td>
        <td class="n num">${r.mesicniCelkem === 0 ? '—' : formatKc(r.mesicniCelkem)}</td>
        ${bunky}
        <td>${stav}</td>
        <td><div class="rowact"><a href="/admin/polozka/${p.id}">Upravit</a></div></td>
      </tr>`;
    })
    .join('');

  const soucty = prehled.jednotky
    .map(
      (j) => `<td class="unit num">${formatKc(s.mesicneJednotka.get(j.id) ?? 0)}</td>`,
    )
    .join('');

  return `
  <section class="card">
    <div class="head">
      <div>
        <h2>Položky nákladů</h2>
        <p>Částka je za uvedené období, sloupce jednotek ukazují měsíční podíl.</p>
      </div>
      <a class="btn primary" href="/admin/polozka/nova">+ Přidat položku</a>
    </div>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Položka</th><th>Perioda</th><th class="n">Částka za období</th><th class="n">Měsíčně</th>
            ${hlavicka}
            <th>Stav</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${radky}
          <tr class="sum">
            <td>Celkem měsíčně</td><td></td><td></td>
            <td class="n num">${formatKc(s.mesicneCelkem)}</td>
            ${soucty}
            <td></td><td></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>`;
}

function formular(prehled: Prehled, polozka: Polozka): string {
  const periody = (['mesicne', 'ctvrtletne', 'pololetne', 'rocne', 'jednorazove'] as const)
    .map(
      (p) =>
        `<option value="${p}"${p === polozka.perioda ? ' selected' : ''}>${popisPeriody(p)}</option>`,
    )
    .join('');

  const hradi = prehled.jednotky
    .map(
      (j) =>
        `<option value="${j.id}"${j.id === polozka.hradi_unit_id ? ' selected' : ''}>${esc(j.label)}</option>`,
    )
    .join('');

  const podily = prehled.jednotky
    .map((j) => {
      const p = polozka.podily.find((x) => x.unit_id === j.id);
      const hodnota =
        p === undefined ? '' : p.rezim === 'procento' ? formatProcento(p.hodnota) : String(p.hodnota / 100);
      return `
        <div class="split-row">
          <label>${esc(j.label)}<span class="note">${esc(osobyJednotky(j, prehled))}</span></label>
          <label>Režim
            <select name="rezim_${j.id}">
              <option value="procento"${p?.rezim === 'castka' ? '' : ' selected'}>procento</option>
              <option value="castka"${p?.rezim === 'castka' ? ' selected' : ''}>pevná částka</option>
            </select>
          </label>
          <label>Hodnota
            <input name="hodnota_${j.id}" value="${esc(hodnota)}" placeholder="prázdné = nepodílí se" />
          </label>
        </div>`;
    })
    .join('');

  return `
  <section class="card">
    <div class="head">
      <div>
        <h2>Upravit položku</h2>
        <p>Takhle vypadá přidání i editace — jediný rozdíl je předvyplnění.</p>
      </div>
      <span class="chip">/admin/polozka/${polozka.id}</span>
    </div>
    <form class="grid">
      <label class="full">Název<input name="nazev" value="${esc(polozka.nazev)}" /></label>
      <label>Kategorie<input name="kategorie" value="${esc(polozka.kategorie ?? '')}" /></label>
      <label>Částka za období<input name="castka" class="num" value="${polozka.castka_celkem / 100}" /></label>
      <label>Perioda<select name="perioda">${periody}</select></label>
      <label>Kdo fyzicky platí<select name="hradi"><option value="">—</option>${hradi}</select></label>
      <label class="full">Poznámka<textarea name="poznamka">${esc(polozka.poznamka ?? '')}</textarea></label>
      <div class="full split">
        <span class="eyebrow">Rozpad na jednotky</span>
        ${podily}
        <span class="note">Co nerozdělíš, zůstane v přehledu vidět jako „nerozděleno“ — nezmizí to potichu.</span>
      </div>
    </form>
    <div class="formfoot">
      <button class="btn primary" disabled>Uložit</button>
      <a class="btn quiet" href="/admin">Zpět na přehled</a>
      <span class="chip warn">ukládání se zapojí s vazbou na databázi</span>
    </div>
  </section>`;
}

export function renderAdmin(prehled: Prehled, datum: string): string {
  const s = spocitej(prehled);
  const ukazkovaPolozka = prehled.polozky[0];

  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Náklady domu ${esc(prehled.nazev_domu)} — správa</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <header class="page">
    <div>
      <span class="eyebrow">Správa · FIO-uhrady</span>
      <h1>Náklady domu ${esc(prehled.nazev_domu)}</h1>
      <p class="sub">Stav k ${esc(datum)} · ${prehled.osoby.length} osoby ve ${prehled.jednotky.length} platebních jednotkách</p>
    </div>
    <div class="actions">
      <a class="btn" href="/admin/lide">Osoby a jednotky</a>
      <a class="btn primary" href="/admin/polozka/nova">+ Přidat položku</a>
    </div>
  </header>

  <div class="banner">
    <span>⚙</span>
    <span><b>Náhled frontendu.</b> Stránka se kreslí z ukázkových dat, ukládání ještě není napojené na databázi — vazby jsou dalším krokem. Čísla vycházejí z tabulky „Náklady bydlení v H-R 213“, rozpad na jednotky je ilustrativní.</span>
  </div>

  ${tiles(prehled, s)}
  ${tabulka(prehled, s)}
  ${ukazkovaPolozka ? formular(prehled, ukazkovaPolozka) : ''}

  <footer class="page">
    <span>Přehled pro ostatní členy bude na samostatném odkazu — jen ke čtení a exportu.</span>
  </footer>
</div>
</body>
</html>`;
}
