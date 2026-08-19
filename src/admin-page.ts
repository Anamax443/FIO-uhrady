/**
 * Stránka „Náklady domu" — seznam položek s rozdělením mezi osoby vlevo,
 * editace vybrané položky vpravo. Kreslí se z databáze.
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
import type { Osoba, Polozka, Prehled } from './model.js';
import { esc, shell } from './ui.js';

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

/* ---------- části stránky ---------- */

const STYL = `
<style>
.main { grid-template-columns: minmax(0, 1fr) 366px; }
.list { display: flex; flex-direction: column; min-width: 0; border-right: 1px solid var(--border); }
.detail { display: flex; flex-direction: column; min-width: 0; overflow-y: auto; background: var(--chrome-hi); }
table { min-width: 760px; }
.col-per { width: 108px; color: var(--text-dim); }
.col-druh { width: 104px; color: var(--text-dim); }
.col-stav { width: 116px; }
.nazev { font-weight: 600; }
.nazev .pozn { font-weight: 400; color: var(--text-faint); }
.druh.d-pravidelny .dot { background: var(--accent); }
.druh.d-jednorazovy .dot { background: var(--idle); }
.druh.d-nedoplatek .dot { background: var(--crit); }
.druh.d-preplatek .dot { background: var(--ok); }
.prazdno { padding: 26px 18px; color: var(--text-dim); display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }

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
.zbytek, .dopad { display: flex; justify-content: space-between; gap: 8px; font-variant-numeric: tabular-nums; }
.zbytek { padding-top: 4px; border-top: 1px solid var(--border-soft); }
.zbytek b, .dopad b { font-family: var(--mono); }
.zbytek.warn { color: var(--warn); }
.dopad { color: var(--text-dim); }
.dopad b { color: var(--text); }
.detail .foot { display: flex; align-items: center; gap: 6px; padding: 7px 10px; border-top: 1px solid var(--border); background: var(--chrome); position: sticky; bottom: 0; flex-wrap: wrap; }
.detail .hlaska { margin: 0; border-bottom: 0; border-top: 1px solid var(--border); }

@media (max-width: 860px) {
  .main { grid-template-columns: 1fr; grid-template-rows: minmax(180px, 1fr) auto; overflow: hidden; }
  .list { border-right: 0; min-height: 0; }
  .detail { border-top: 1px solid var(--border); max-height: 54vh; }
}
@media (max-width: 560px) {
  thead th.osoba, td.osoba-cell { display: none; }
  table { min-width: 0; }
  .col-druh, .col-per { width: auto; }
  .podil { grid-template-columns: minmax(0, 1fr) 76px 58px 68px; }
  .detail { max-height: 60vh; }
}
</style>`;

function grid(prehled: Prehled, s: Souhrn): string {
  if (prehled.polozky.length === 0) {
    return `<div class="prazdno">
      <b>Zatím tu není žádná položka.</b>
      <span>Přidej první náklad tlačítkem nahoře — název, částku, periodu a kdo se na ní skládá.</span>
    </div>`;
  }

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

      const kdy =
        r.jednorazovy && p.datum ? p.datum.split('-').reverse().join('. ') : popisPeriody(p.perioda);

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
    <div class="frow"><label for="d-nazev">Název</label><input type="text" id="d-nazev" maxlength="120" /></div>
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
  <div class="hlaska" id="d-hlaska" hidden></div>
  <div class="foot">
    <button class="btn primary" type="button" id="d-ulozit">Uložit</button>
    <button class="btn" type="button" id="d-zpet">Zahodit změny</button>
    <span class="note" id="d-stav"></span>
  </div>
</section>`;
}

export function renderNaklady(prehled: Prehled, datum: string, kdo: string): string {
  const s = spocitej(prehled);

  const stavOsob = prehled.osoby
    .map((o: Osoba) => {
      const saldo = s.saldoOsoba.get(o.id) ?? 0;
      return `<span>${esc(o.jmeno)} <b>${formatKc(s.mesicneOsoba.get(o.id) ?? 0)}</b>/měs${
        saldo !== 0 ? ` <span class="saldo">${formatKcZnamenko(saldo)}</span>` : ''
      }</span>`;
    })
    .join('');

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

  const obsah = `${STYL}
    <section class="list">
      <div class="panehead">
        <svg class="icon icon-sm"><use href="#i-list"/></svg>Náklady domu
        <span class="count" id="pocet">${prehled.polozky.length} položek</span>
      </div>
      <div class="toolbar">
        <button class="tbtn primary" type="button" id="t-nova"><svg class="icon icon-sm"><use href="#i-plus"/></svg>Přidat položku</button>
        <span class="sep"></span>
        <button class="tbtn" type="button" id="t-duplikovat"><svg class="icon icon-sm"><use href="#i-copy"/></svg>Duplikovat</button>
        <button class="tbtn" type="button" id="t-smazat"><svg class="icon icon-sm"><use href="#i-trash"/></svg>Smazat</button>
        <span class="sep"></span>
        <a class="tbtn" href="/admin/export.csv"><svg class="icon icon-sm"><use href="#i-export"/></svg>Export CSV</a>
      </div>
      ${grid(prehled, s)}
    </section>
    ${detail(prehled)}`;

  const status = `
    <span>Pravidelné <b>${formatKc(s.mesicneCelkem)}</b>/měs</span>
    <span>ročně <b>${formatKc(s.rocneCelkem)}</b></span>
    <span>jednorázové saldo <b>${formatKcZnamenko(s.saldoCelkem)}</b></span>
    ${stavOsob}
    ${s.nedokoncenych > 0 ? `<span class="warn">nedokončených <b>${s.nedokoncenych}</b></span>` : ''}
    <span class="spacer"></span>
    <span>přihlášen: ${esc(kdo)}</span>`;

  const skript = `<script>
const MODEL = ${model};
const kc = (h) => new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 }).format(h / 100);
const kcZn = (h) => { const k = Math.round(h / 100); return (k > 0 ? '+' : k < 0 ? '−' : '') + kc(Math.abs(h)); };
const el = (id) => document.getElementById(id);
const q = (sel) => document.querySelector(sel);
const DELITEL = { mesicne: 1, ctvrtletne: 3, pololetne: 6, rocne: 12, jednorazove: 0 };
const jednorazovy = (druh) => druh !== 'pravidelny';
const cislo = (text) => parseFloat(String(text).replace(/\\s/g, '').replace(',', '.'));

let vybraneId = ${prehled.polozky[0]?.id ?? 'null'};

function hlaska(text, typ) {
  const box = el('d-hlaska');
  if (!text) { box.hidden = true; return; }
  box.hidden = false;
  box.className = 'hlaska ' + typ;
  box.textContent = text;
}

function prepocitej() {
  const druh = el('d-druh').value;
  const jedno = jednorazovy(druh);
  el('w-perioda').style.display = jedno ? 'none' : '';
  el('w-datum').style.display = jedno ? '' : 'none';

  const celkem = Math.round((cislo(el('d-castka').value) || 0) * 100);
  let rozdeleno = 0;
  const podily = [];

  for (const o of MODEL.osoby) {
    const zapojen = q('[data-zapojen="' + o.id + '"]').checked;
    q('.podil[data-radek="' + o.id + '"]').dataset.off = zapojen ? 'false' : 'true';
    const cil = q('[data-vysledek="' + o.id + '"]');
    if (!zapojen) { cil.textContent = '—'; continue; }
    const rezim = q('[data-rezim="' + o.id + '"]').value;
    const n = cislo(q('[data-hodnota="' + o.id + '"]').value) || 0;
    const castka = rezim === 'castka' ? Math.round(n * 100) : Math.round(celkem * n / 100);
    rozdeleno += castka;
    cil.textContent = kc(castka);
    podily.push({ member_id: o.id, rezim: rezim, hodnota: Math.round(n * 100) });
  }

  const zbytek = celkem - rozdeleno;
  const box = el('d-zbytek');
  box.querySelector('b').textContent = kcZn(zbytek);
  box.classList.toggle('warn', Math.round(zbytek / 100) !== 0);

  const zn = druh === 'preplatek' ? -1 : 1;
  const del = DELITEL[el('d-perioda').value] || 0;
  el('d-dopad').innerHTML = jedno
    ? '<span>Dopad do dlužné částky</span><b>' + kcZn(zn * celkem) + '</b>'
    : '<span>Měsíčně z toho</span><b>' + kc(del ? Math.round(celkem / del) : 0) + '</b>';

  return { celkem: celkem, podily: podily };
}

function ukazPolozku(id) {
  const p = MODEL.polozky.find((x) => x.id === id) || {
    id: null, nazev: '', kategorie: '', castka: 0, perioda: 'mesicne',
    druh: 'pravidelny', datum: '', hradi: null, poznamka: '', podily: [],
  };
  vybraneId = p.id;
  el('d-titulek').textContent = p.id === null ? 'Nová položka' : p.nazev;
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
  hlaska('', '');
  prepocitej();
}

async function posli(url, telo) {
  el('d-stav').textContent = 'ukládám…';
  try {
    const odpoved = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(telo),
    });
    const data = await odpoved.json();
    if (!odpoved.ok) { hlaska(data.chyba || 'Uložení se nepovedlo.', 'chyba'); el('d-stav').textContent = ''; return false; }
    location.reload();
    return true;
  } catch (e) {
    hlaska('Server neodpověděl: ' + e.message, 'chyba');
    el('d-stav').textContent = '';
    return false;
  }
}

el('d-ulozit').addEventListener('click', () => {
  const stav = prepocitej();
  const druh = el('d-druh').value;
  void posli('/api/polozka', {
    id: vybraneId,
    nazev: el('d-nazev').value,
    kategorie: el('d-kategorie').value,
    castka_celkem: stav.celkem,
    perioda: jednorazovy(druh) ? 'jednorazove' : el('d-perioda').value,
    druh: druh,
    datum: jednorazovy(druh) ? el('d-datum').value : null,
    hradi_member_id: el('d-hradi').value || null,
    poznamka: el('d-poznamka').value,
    podily: stav.podily,
  });
});

el('d-zpet').addEventListener('click', () => ukazPolozku(vybraneId));
el('t-nova').addEventListener('click', () => {
  document.querySelectorAll('#grid tbody tr').forEach((x) => x.removeAttribute('data-selected'));
  ukazPolozku(null);
  el('d-nazev').focus();
});
el('t-duplikovat').addEventListener('click', () => {
  if (vybraneId === null) return;
  ukazPolozku(vybraneId);
  vybraneId = null;
  el('d-titulek').textContent = 'Nová položka';
  el('d-nazev').value = el('d-nazev').value + ' (kopie)';
});
el('t-smazat').addEventListener('click', () => {
  if (vybraneId === null) return;
  const p = MODEL.polozky.find((x) => x.id === vybraneId);
  if (!confirm('Smazat položku „' + p.nazev + '"? Zůstane po ní záznam v logu změn.')) return;
  void posli('/api/polozka/' + vybraneId + '/smazat', {});
});

el('d-rovnym').addEventListener('click', () => {
  const zapojeni = MODEL.osoby.filter((o) => q('[data-zapojen="' + o.id + '"]').checked);
  if (zapojeni.length === 0) return;
  // Setiny procenta rozdělíme beze zbytku, ať součet dá přesně 100 %.
  const zaklad = Math.floor(10000 / zapojeni.length);
  let zbyva = 10000 - zaklad * zapojeni.length;
  zapojeni.forEach((o) => {
    const setiny = zaklad + (zbyva > 0 ? 1 : 0);
    if (zbyva > 0) zbyva--;
    q('[data-rezim="' + o.id + '"]').value = 'procento';
    q('[data-hodnota="' + o.id + '"]').value = String(setiny / 100);
  });
  prepocitej();
});

document.querySelectorAll('#grid tbody tr').forEach((tr) => {
  const vyber = () => {
    document.querySelectorAll('#grid tbody tr').forEach((x) => x.removeAttribute('data-selected'));
    tr.setAttribute('data-selected', 'true');
    ukazPolozku(Number(tr.dataset.id));
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

ukazPolozku(vybraneId);
</script>`;

  return shell({
    aktivni: 'naklady',
    nazevDomu: prehled.nazev_domu,
    titulek: 'Náklady domu',
    listaExtra: `<div class="search">
      <svg class="icon icon-sm"><use href="#i-search"/></svg>
      <input id="filtr" type="search" placeholder="Filtr položek…" autocomplete="off" />
    </div>`,
    vpravo: `<span class="chip"><svg class="icon icon-sm"><use href="#i-refresh"/></svg>Stav k ${esc(datum)}</span>`,
    obsah,
    status,
    skript,
  });
}
