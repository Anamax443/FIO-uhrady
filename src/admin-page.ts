/**
 * Stránka „Náklady domu" — seznam položek s rozdělením mezi osoby vlevo,
 * editace vybrané položky vpravo. Kreslí se z databáze.
 */
import {
  cisloMesice,
  mesicNyni,
  DRUHY,
  formatKc,
  formatKcZnamenko,
  jeJednorazovy,
  mesicne,
  popisDruhu,
  popisPeriody,
  posunMesic,
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
  /**
   * Vstupuje řádek do součtů za tenhle měsíc?
   *
   * Jednorázová položka se ukazuje s celou částkou, ale do součtu patří jen
   * v měsíci svého data. Bez téhle značky by přepočet součtů v prohlížeči
   * (po filtrování) vyšel jinak než na serveru.
   */
  doSouctu: boolean;
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

/**
 * Běží rozpouštěná položka v daném měsíci?
 *
 * Uhlí koupené v říjnu na 12 měsíců se počítá od října do září a pak zmizí
 * samo. Mimo své okno do nákladů nevstupuje vůbec.
 */
export function rozpousteneVMesici(p: Polozka, mesic: string): boolean {
  const n = p.rozpustit_mesicu ?? 0;
  if (n <= 0 || !p.rozpustit_od) return false;
  const zacatek = cisloMesice(p.rozpustit_od);
  const ted = cisloMesice(mesic);
  return ted >= zacatek && ted < zacatek + n;
}

const seRozpousti = (p: Polozka): boolean => (p.rozpustit_mesicu ?? 0) > 0 && Boolean(p.rozpustit_od);

export function spocitej(prehled: Prehled, mesic: string = mesicNyni()): Souhrn {
  const radky: Radek[] = [];
  const mesicneOsoba = new Map<number, number>();
  const saldoOsoba = new Map<number, number>();
  let mesicneCelkem = 0;
  let saldoCelkem = 0;
  let nedokoncenych = 0;

  for (const polozka of prehled.polozky) {
    const { naOsobu: podil, nerozdeleno } = rozpad(polozka.castka_celkem, polozka.podily);
    const rozpousti = seRozpousti(polozka);
    const bezi = rozpousti && rozpousteneVMesici(polozka, mesic);
    // Rozpouštěná položka se chová jako měsíční náklad po dobu svého okna;
    // do jednorázového salda nespadne, jinak by se započítala dvakrát.
    const jednorazovy = !rozpousti && jeJednorazovy(polozka.druh);
    // Bez data se jednorázová položka počítá do aktuálního měsíce, ať
    // z výpočtu nevypadne úplně.
    const vMesici = polozka.datum ? polozka.datum.slice(0, 7) === mesic : mesic === mesicNyni();
    const zn = znamenko(polozka.druh);
    const dil = rozpousti ? Math.round(polozka.castka_celkem / (polozka.rozpustit_mesicu ?? 1)) : 0;
    const naOsobu = new Map<number, number>();

    for (const [memberId, castka] of podil) {
      const hodnota = rozpousti
        ? bezi
          ? Math.round(castka / (polozka.rozpustit_mesicu ?? 1))
          : 0
        : jednorazovy
          ? zn * castka
          : mesicne(castka, polozka.perioda);
      naOsobu.set(memberId, hodnota);
      // Jednorázová položka patří do měsíce svého data — jinak by se při
      // součtu přes víc měsíců započítala tolikrát, kolik měsíců se sčítá.
      if (hodnota !== 0 && (!jednorazovy || vMesici)) {
        const kam = jednorazovy ? saldoOsoba : mesicneOsoba;
        kam.set(memberId, (kam.get(memberId) ?? 0) + hodnota);
      }
    }

    const castka = rozpousti
      ? bezi
        ? dil
        : 0
      : jednorazovy
        ? zn * polozka.castka_celkem
        : mesicne(polozka.castka_celkem, polozka.perioda);
    if (jednorazovy) {
      if (vMesici) saldoCelkem += castka;
    } else mesicneCelkem += castka;

    // Nula je platná částka, ne chybějící údaj — nedokončené je jen to,
    // co se nerozdělilo celé.
    if (nerozdeleno !== 0) nedokoncenych++;
    radky.push({ polozka, jednorazovy, castka, naOsobu, nerozdeleno, doSouctu: !jednorazovy || vMesici });
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

/**
 * Kolik ta položka **stojí v daném měsíci** — nula, když do něj nespadá.
 *
 * `spocitej` počítá totéž, ale rozpadlé na osoby. Tady jde o celou částku:
 * kdo ji zaplatil ze svého, tomu se za ten měsíc připisuje.
 */
export function castkaVMesici(p: Polozka, mesic: string): number {
  if (seRozpousti(p)) {
    return rozpousteneVMesici(p, mesic) ? Math.round(p.castka_celkem / (p.rozpustit_mesicu ?? 1)) : 0;
  }
  if (jeJednorazovy(p.druh)) {
    // Bez data se jednorázová položka počítá do aktuálního měsíce — stejně
    // jako v `spocitej`, ať vklad a náklad nesedí každý v jiném měsíci.
    const vMesici = p.datum ? p.datum.slice(0, 7) === mesic : mesic === mesicNyni();
    return vMesici ? znamenko(p.druh) * p.castka_celkem : 0;
  }
  return mesicne(p.castka_celkem, p.perioda);
}

/**
 * Kolik kdo za dané měsíce vložil **ze svého** (položky se `zdroj_uhrady = 'osoba'`).
 *
 * Děda, který koupil uhlí z vlastní kapsy, vložil do domácnosti stejně reálné
 * peníze jako ten, kdo pošle příkazem. Počítá se to po měsících, ne celou
 * částkou najednou: pravidelný náklad placený ze svého se připisuje každý
 * měsíc, rozpouštěný nákup po dílech, jednorázový v měsíci svého data.
 */
export function vlozenoZeSveho(prehled: Prehled, odMesice: string, doMesice: string): Map<number, number> {
  const vklady = new Map<number, number>();
  const od = cisloMesice(odMesice);
  const konec = cisloMesice(doMesice);
  if (od === 0 || konec < od) return vklady;

  for (const p of prehled.polozky) {
    if (p.zdroj_uhrady !== 'osoba' || p.hradi_member_id === null) continue;
    let soucet = 0;
    for (let i = 0; od + i <= konec; i++) soucet += castkaVMesici(p, posunMesic(odMesice, i));
    if (soucet !== 0) {
      vklady.set(p.hradi_member_id, (vklady.get(p.hradi_member_id) ?? 0) + soucet);
    }
  }
  return vklady;
}

/* ---------- části stránky ---------- */

const STYL = `
<style>
.main { grid-template-columns: minmax(0, 1fr) 366px; }
.list { display: flex; flex-direction: column; min-width: 0; border-right: 1px solid var(--border); }
.detail { display: flex; flex-direction: column; min-width: 0; overflow-y: auto; background: var(--chrome-hi); }
table { min-width: 760px; }
.osoba small { display: block; font-weight: 400; font-size: 10px; color: var(--text-faint); }
.col-per { width: 108px; color: var(--text-dim); }
.col-druh { width: 104px; color: var(--text-dim); }
.col-stav { width: 116px; }
.col-kat { width: 124px; color: var(--text-dim); }
thead tr.radici th { cursor: pointer; user-select: none; white-space: nowrap; }
thead tr.radici th:hover { background: var(--hover); }
thead tr.radici th .sipka { display: inline-block; width: 10px; margin-left: 3px; color: var(--accent); }
thead tr.radici th[data-smer="asc"] .sipka::after { content: "▲"; font-size: 8px; }
thead tr.radici th[data-smer="desc"] .sipka::after { content: "▼"; font-size: 8px; }
thead tr.filtry th { padding: 3px 4px; background: var(--chrome-hi); border-bottom: 1px solid var(--border); position: sticky; top: 22px; z-index: 2; }
thead tr.filtry input, thead tr.filtry select { width: 100%; min-width: 0; font-size: 11.5px; padding: 2px 4px; }
.filtr-info { display: flex; align-items: center; gap: 8px; padding: 5px 12px; border-bottom: 1px solid var(--border); background: var(--accent-soft); }
.filtr-info[hidden] { display: none; }
.kategorie { border-top: 1px solid var(--border); }
.kat-telo { padding: 9px 12px 12px; display: flex; flex-direction: column; gap: 7px; max-width: 720px; }
.kat { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 2px 12px; align-items: baseline; font-variant-numeric: tabular-nums; }
.kat .jmeno { font-weight: 550; }
.kat .mesicne { font-family: var(--mono); }
.kat .rocne { font-family: var(--mono); color: var(--text-faint); font-size: 11.5px; }
.kat i { grid-column: 1 / -1; height: 4px; border-radius: 2px; background: var(--accent); opacity: .5; }
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
/* Uložit musí být vidět pořád, i když se člověk zavrtá do historie —
   proto je lišta přilepená ke spodku panelu a historie se posouvá pod ní. */
.detail .foot { display: flex; align-items: center; gap: 6px; padding: 7px 10px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); background: var(--chrome); position: sticky; bottom: 0; z-index: 2; flex-wrap: wrap; box-shadow: 0 -4px 10px rgba(20, 30, 40, .07); }
.detail .historie-blok { padding: 9px 10px 14px; display: flex; flex-direction: column; gap: 7px; }
.detail .hlaska { margin: 0; border-bottom: 0; border-top: 1px solid var(--border); }
.historie { display: flex; flex-direction: column; gap: 7px; }
.zaznam { display: flex; flex-direction: column; gap: 2px; padding-bottom: 6px; border-bottom: 1px solid var(--border-soft); }
.zaznam:last-child { border-bottom: 0; }
.zaznam .hlava { display: flex; gap: 8px; justify-content: space-between; color: var(--text-dim); }
.zaznam .kdy { font-family: var(--mono); font-size: 11.5px; }
.zaznam .co { color: var(--text); }
.zaznam .detail-zmeny { color: var(--text-dim); }

@media (max-width: 860px) {
  /* Nic se nepere o výšku — seznam a pod ním detail, stránka se scrolluje. */
  .main { display: block; }
  .list { border-right: 0; }
  .detail { border-top: 1px solid var(--border); overflow: visible; }
  .detail .foot { position: static; }
  table { min-width: 640px; }
}
@media (max-width: 560px) {
  table { min-width: 0; }
  .col-druh, .col-per, .col-stav { width: auto; }
  /* Nuly by kartu jen zaplevelily — kdo se nepodílí, prostě není vidět.
     Stejně tak „Druh: pravidelný" u každé položky; zůstanou jen výjimky. */
  tbody td.osoba-cell.zero, tbody td.col-druh.bezny { display: none; }
  tbody td.col-num { font-size: 12.5px; }
  .nazev { font-size: 13.5px; }
  .podil { grid-template-columns: minmax(0, 1fr) 74px 56px; row-gap: 2px; }
  .podil .vysledek { grid-column: 2 / -1; text-align: left; }
  .frow2 { grid-template-columns: 1fr; }
}
</style>`;

function grid(prehled: Prehled, s: Souhrn): string {
  if (prehled.polozky.length === 0) {
    return `<div class="prazdno">
      <b>Zatím tu není žádná položka.</b>
      <span>Přidej první náklad tlačítkem nahoře — název, částku, periodu a kdo se na ní skládá.</span>
    </div>`;
  }

  const hlavickyOsob = prehled.osoby
    .map((o) => {
      const rodic = prehled.osoby.find((x) => x.id === (o.pod_member_id ?? null));
      return `<th class="osoba col-num" data-radit="osoba-${o.id}" tabindex="0" role="button" title="${
        rodic
          ? `podíl nese ${esc(rodic.jmeno)} — klikni pro seřazení`
          : 'nese svůj podíl sám — klikni pro seřazení'
      }">${esc(o.jmeno)}${rodic ? `<small>s ${esc(rodic.jmeno)}</small>` : ''}<span class="sipka"></span></th>`;
    })
    .join('');

  const radky = s.radky
    .map((r, i) => {
      const p = r.polozka;
      const bunky = prehled.osoby
        .map((o) => {
          const v = r.naOsobu.get(o.id) ?? 0;
          const text = v === 0 ? '—' : r.jednorazovy ? formatKcZnamenko(v) : formatKc(v);
          return `<td class="col-num osoba-cell${v === 0 ? ' zero' : ''}${v < 0 ? ' minus' : ''}" data-popis="${esc(o.jmeno)}" data-klic="osoba-${o.id}" data-v="${v}">${text}</td>`;
        })
        .join('');

      const stav =
        r.nerozdeleno !== 0
          ? `<span class="s-warn"><span class="dot"></span>zbývá ${formatKc(r.nerozdeleno)}</span>`
          : '<span class="s-ok"><span class="dot"></span>rozděleno</span>';

      const kdy =
        r.jednorazovy && p.datum ? p.datum.split('-').reverse().join('. ') : popisPeriody(p.perioda);

      const kategorie = p.kategorie ?? '';

      return `<tr data-id="${p.id}"${i === 0 ? ' data-selected="true"' : ''} tabindex="0"
    data-kat="${esc(kategorie)}" data-druh="${p.druh}" data-per="${p.perioda}"
    data-stav="${r.nerozdeleno === 0 ? 'rozdeleno' : 'zbyva'}"
    data-jedno="${r.jednorazovy ? '1' : '0'}" data-souctu="${r.doSouctu ? '1' : '0'}">
  <td class="nazev" data-klic="nazev">${esc(p.nazev)}${p.poznamka ? ` <span class="pozn">— ${esc(p.poznamka)}</span>` : ''}</td>
  <td class="col-kat" data-popis="Kategorie" data-klic="kat">${
    kategorie ? esc(kategorie) : '<span class="pozn">bez kategorie</span>'
  }</td>
  <td class="col-druh${p.druh === 'pravidelny' ? ' bezny' : ''}" data-popis="Druh" data-klic="druh"><span class="druh d-${p.druh}"><span class="dot"></span>${popisDruhu(p.druh)}</span></td>
  <td class="col-per" data-popis="Kdy" data-klic="per">${esc(kdy)}</td>
  <td class="col-num" data-popis="Za období" data-klic="obdobi" data-v="${p.castka_celkem}">${formatKc(p.castka_celkem)}</td>
  <td class="col-num${r.castka < 0 ? ' minus' : ''}" data-popis="Měsíčně" data-klic="mesicne" data-v="${r.castka}">${r.jednorazovy ? formatKcZnamenko(r.castka) : formatKc(r.castka)}</td>
  ${bunky}
  <td class="col-stav" data-popis="Stav" data-klic="stav" data-v="${r.nerozdeleno}">${stav}</td>
</tr>`;
    })
    .join('\n');

  const soucty = (mapa: Map<number, number>, seZnamenkem: boolean, klic: string): string =>
    prehled.osoby
      .map((o) => {
        const v = mapa.get(o.id) ?? 0;
        return `<td class="col-num osoba-cell${v < 0 ? ' minus' : ''}" data-soucet="${klic}-${o.id}">${
          seZnamenkem ? formatKcZnamenko(v) : formatKc(v)
        }</td>`;
      })
      .join('');

  // Nabídky filtrů se berou z toho, co v tabulce opravdu je — vypsat pevný
  // seznam by znamenalo nabízet kategorie, které nikdo nepoužil.
  const volby = (hodnoty: string[], prazdne: string): string =>
    [...new Set(hodnoty)]
      .sort((a, b) => a.localeCompare(b, 'cs'))
      .map((h) => `<option value="${esc(h)}">${esc(h === '' ? prazdne : h)}</option>`)
      .join('');

  const filtrVolba = (klic: string, hodnoty: string[], prazdne: string, popis: string): string =>
    `<select data-filtr="${klic}" aria-label="Filtr: ${esc(popis)}" title="Filtrovat podle ${esc(popis)}">
      <option value="">vše</option>${volby(hodnoty, prazdne)}
    </select>`;

  const seradit = (klic: string, popis: string, tridy = ''): string =>
    `<th class="${tridy}" data-radit="${klic}" tabindex="0" role="button"
         title="Seřadit podle ${esc(popis)}">${esc(popis)}<span class="sipka"></span></th>`;

  return `<div class="gridwrap">
  <table id="grid">
    <thead>
      <tr class="radici">
        ${seradit('nazev', 'Položka')}
        ${seradit('kat', 'Kategorie', 'col-kat')}
        ${seradit('druh', 'Druh', 'col-druh')}
        ${seradit('per', 'Perioda / datum', 'col-per')}
        ${seradit('obdobi', 'Za období', 'col-num')}
        ${seradit('mesicne', 'Měsíčně / jednorázově', 'col-num')}
        ${hlavickyOsob}
        ${seradit('stav', 'Stav', 'col-stav')}
      </tr>
      <tr class="filtry">
        <th><input type="search" data-filtr="nazev" placeholder="hledat v názvu…" aria-label="Filtr: název" title="Filtrovat podle názvu a poznámky" /></th>
        <th>${filtrVolba('kat', prehled.polozky.map((p) => p.kategorie ?? ''), 'bez kategorie', 'kategorie')}</th>
        <th>${filtrVolba('druh', prehled.polozky.map((p) => popisDruhu(p.druh)), '', 'druhu')}</th>
        <th>${filtrVolba('per', prehled.polozky.map((p) => popisPeriody(p.perioda)), '', 'periody')}</th>
        <th></th><th></th>
        ${prehled.osoby.map(() => '<th></th>').join('')}
        <th>
          <select data-filtr="stav" aria-label="Filtr: stav" title="Filtrovat podle stavu rozdělení">
            <option value="">vše</option>
            <option value="rozdeleno">rozděleno</option>
            <option value="zbyva">zbývá rozdělit</option>
          </select>
        </th>
      </tr>
    </thead>
    <tbody>${radky}</tbody>
    <tfoot>
      <tr>
        <td>Pravidelné náklady měsíčně</td><td></td><td></td><td></td><td></td>
        <td class="col-num" data-soucet="mesicne">${formatKc(s.mesicneCelkem)}</td>
        ${soucty(s.mesicneOsoba, false, 'mesicne')}
        <td></td>
      </tr>
      <tr>
        <td>Jednorázové <span class="pozn">(promítne se do vyrovnání)</span></td><td></td><td></td><td></td><td></td>
        <td class="col-num${s.saldoCelkem < 0 ? ' minus' : ''}" data-soucet="saldo">${formatKcZnamenko(s.saldoCelkem)}</td>
        ${soucty(s.saldoOsoba, true, 'saldo')}
        <td></td>
      </tr>
    </tfoot>
  </table>
  ${podleKategorii(s)}
</div>`;
}

/**
 * Souhrn po kategoriích pod tabulkou — tentýž pohled, jaký má člen na telefonu.
 *
 * Do ročního součtu jdou jen pravidelné a rozpouštěné náklady: dvanáctinásobek
 * jednorázové položky by kategorie rozhodil a nesouhlasil by s celkem.
 */
function podleKategorii(s: Souhrn): string {
  const kategorie = new Map<string, number>();
  for (const r of s.radky) {
    if (r.castka === 0 || r.jednorazovy) continue;
    const klic = r.polozka.kategorie ?? 'Bez kategorie';
    kategorie.set(klic, (kategorie.get(klic) ?? 0) + r.castka);
  }
  if (kategorie.size === 0) return '';

  const serazene = [...kategorie.entries()].sort((a, b) => b[1] - a[1]);
  const max = Math.max(...serazene.map(([, v]) => v), 1);

  const radky = serazene
    .map(
      ([nazev, castka]) => `<div class="kat">
      <span class="jmeno">${esc(nazev)}</span>
      <span class="mesicne">${formatKc(castka)}</span>
      <span class="rocne">${formatKc(castka * 12)} / rok</span>
      <i style="width:${Math.round((castka / max) * 100)}%"></i>
    </div>`,
    )
    .join('');

  return `<section class="kategorie">
    <div class="panehead"><svg class="icon icon-sm"><use href="#i-grid"/></svg>Po kategoriích
      <span class="count" id="kat-celkem">${formatKc(s.mesicneCelkem)} měsíčně · ${formatKc(s.rocneCelkem)} ročně</span>
    </div>
    <div class="kat-telo">
      <div id="kat-radky">${radky}</div>
      <p class="pozn">
        Jen pravidelné a rozpouštěné náklady — jednorázové položky do ročního součtu nepatří.
        Tohle je ten samý pohled, jaký vidí člen na svém přehledu, a <b>počítá se z toho,
        co je zrovna vidět v tabulce</b> — filtr se do něj promítne.
      </p>
    </div>
  </section>`;
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
    <div class="frow2">
      <div class="frow"><label for="d-zdroj">Zaplaceno z</label>
        <select id="d-zdroj">
          <option value="osoba">vlastní kapsy (vzniká kredit)</option>
          <option value="ucet">účtu domácnosti</option>
        </select>
      </div>
      <div class="frow"><label for="d-rozpustit">Rozpustit přes</label>
        <input type="text" id="d-rozpustit" inputmode="numeric" placeholder="počet měsíců" />
      </div>
    </div>
    <div class="frow2" id="w-rozpustit-od">
      <div class="frow"><label for="d-rozpustit-od">Rozpouštět od</label>
        <input type="text" id="d-rozpustit-od" class="mono" placeholder="RRRR-MM" />
      </div>
      <div class="frow"><label>&nbsp;</label><span class="note" id="d-rozpad-info"></span></div>
    </div>
    <div class="frow"><label for="d-poznamka">Poznámka</label><textarea id="d-poznamka"></textarea></div>

    <div class="subhead">Kdo se skládá
      <button class="tbtn" type="button" id="d-rovnym" title="Rozdělí celou částku na stejné díly mezi zaškrtnuté">Rovným dílem</button>
      <button class="tbtn" type="button" id="d-zbytek-rovnym" title="Nechá zadané pevné částky a zbytek rozdělí mezi ostatní zaškrtnuté">Zbytek rovným dílem</button>
    </div>
    ${podily}
    <div class="zbytek" id="d-zbytek"><span>Nerozděleno</span><b>0 Kč</b></div>
    <div class="dopad" id="d-dopad"></div>
    <span class="note">Odškrtnutá osoba se na položce nepodílí. Kdo má pevnou částku, tomu ji „Zbytek rovným dílem" nechá a rozdělí jen to, co zbývá. Nerozdělený zbytek se nikam neschová — zůstane vidět tady i v seznamu.</span>

  </div>
  <div class="hlaska" id="d-hlaska" hidden></div>
  <div class="foot">
    <button class="btn primary" type="button" id="d-ulozit">Uložit</button>
    <button class="btn" type="button" id="d-zpet">Zahodit změny</button>
    <span class="note" id="d-stav"></span>
  </div>
  <div class="historie-blok">
    <div class="subhead">Historie změn</div>
    <div class="historie" id="d-historie"><span class="note">—</span></div>
  </div>
</section>`;
}

export function renderNaklady(
  prehled: Prehled,
  datum: string,
  kdo: string,
  commit: string,
  vybrano: number | null = null,
  stav: string | null = null,
): string {
  const s = spocitej(prehled);

  // Kdo se počítá někomu jinému (nezletilé dítě), nemá vlastní závazek —
  // jeho podíl se přičte tomu, kdo ho nese. Ve sloupci zůstane vidět zvlášť.
  const zavazek = (o: Osoba, mapa: Map<number, number>): number => {
    let soucet = mapa.get(o.id) ?? 0;
    for (const d of prehled.osoby) {
      if ((d.pod_member_id ?? null) === o.id) soucet += mapa.get(d.id) ?? 0;
    }
    return soucet;
  };

  const stavOsob = prehled.osoby
    .filter((o) => (o.pod_member_id ?? null) === null)
    .map((o: Osoba) => {
      const deti = prehled.osoby.filter((d) => (d.pod_member_id ?? null) === o.id);
      const saldo = zavazek(o, s.saldoOsoba);
      const popis = deti.length > 0 ? `${o.jmeno} (s ${deti.map((d) => d.jmeno).join(', ')})` : o.jmeno;
      return `<span>${esc(popis)} <b>${formatKc(zavazek(o, s.mesicneOsoba))}</b>/měs${
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
      rozpustit_od: p.rozpustit_od ?? '',
      rozpustit_mesicu: p.rozpustit_mesicu ?? '',
      zdroj: p.zdroj_uhrady ?? 'ucet',
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
      <div class="filtr-info" id="filtr-info" hidden>
        <span id="filtr-info-text"></span>
        <button class="tbtn" type="button" id="filtr-zrusit" title="Vrátí tabulku na všechny položky">Zrušit filtr</button>
      </div>
      ${grid(prehled, s)}
    </section>
    ${detail(prehled)}`;

  const status = `
    <span>Pravidelné <b>${formatKc(s.mesicneCelkem)}</b>/měs</span>
    <span>ročně <b>${formatKc(s.rocneCelkem)}</b></span>
    <span>jednorázové <b>${formatKcZnamenko(s.saldoCelkem)}</b></span>
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
// „6 měsíců“ místo holé šestky — popisek pod částkou má jít přečíst jako věta.
const mesicuText = (n) => n + (n === 1 ? ' měsíc' : n < 5 ? ' měsíce' : ' měsíců');

let vybraneId = ${vybrano ?? prehled.polozky[0]?.id ?? 'null'};
const STAV_PO_ULOZENI = ${JSON.stringify(stav)};

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

  // Rozpouštěná položka se chová jako měsíční náklad po dobu svého okna,
  // proto se počítá jinak než jednorázová i než pravidelná.
  const rozpustitN = parseInt(el('d-rozpustit').value.trim(), 10);
  const rozpousti = Number.isInteger(rozpustitN) && rozpustitN > 0;
  el('w-rozpustit-od').style.display = rozpousti ? '' : 'none';
  el('d-rozpad-info').textContent = rozpousti
    ? kc(Math.round(celkem / rozpustitN)) + ' měsíčně po ' + rozpustitN + ' měsíců'
    : '';

  const zn = druh === 'preplatek' ? -1 : 1;
  const del = DELITEL[el('d-perioda').value] || 0;
  el('d-dopad').innerHTML = rozpousti
    ? '<span>Rozpouští se měsíčně</span><b>' + kc(Math.round(celkem / rozpustitN)) + '</b>'
    : jedno
      ? '<span>Promítne se do vyrovnání</span><b>' + kcZn(zn * celkem) + '</b>'
      // Samotné „Měsíčně z toho: 967 Kč“ se u pololetní položky čte jako
      // pololetní částka. Musí být vidět, z čeho vznikla a čím se dělí.
      : '<span>' + (del > 1
          ? 'Měsíční podíl z ' + kc(celkem) + ' ÷ ' + mesicuText(del)
          : 'Měsíčně') + '</span><b>' + kc(del ? Math.round(celkem / del) : 0) + '</b>';

  return { celkem: celkem, podily: podily };
}

function ukazPolozku(id) {
  const p = MODEL.polozky.find((x) => x.id === id) || {
    id: null, nazev: '', kategorie: '', castka: 0, perioda: 'mesicne',
    druh: 'pravidelny', datum: '', hradi: null, poznamka: '', podily: [],
    rozpustit_od: '', rozpustit_mesicu: '', zdroj: 'osoba',
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
  el('d-zdroj').value = p.zdroj || 'ucet';
  el('d-rozpustit').value = p.rozpustit_mesicu === '' ? '' : String(p.rozpustit_mesicu);
  el('d-rozpustit-od').value = p.rozpustit_od || '';
  for (const o of MODEL.osoby) {
    const podil = p.podily.find((x) => x.member_id === o.id);
    q('[data-zapojen="' + o.id + '"]').checked = Boolean(podil);
    q('[data-rezim="' + o.id + '"]').value = podil ? podil.rezim : 'procento';
    q('[data-hodnota="' + o.id + '"]').value = podil ? String(podil.hodnota / 100) : '';
  }
  hlaska('', '');
  prepocitej();
  void nactiHistorii(p.id);
}

// Kdo, kdy a co změnil. Bere se z auditu, který vzniká u každého zápisu.
async function nactiHistorii(id) {
  const cil = el('d-historie');
  if (id === null) { cil.innerHTML = '<span class="note">Nová položka — zatím bez historie.</span>'; return; }
  cil.innerHTML = '<span class="note">načítám…</span>';
  try {
    const odpoved = await fetch('/api/polozka/' + id + '/historie');
    const data = await odpoved.json();
    const zmeny = data.zmeny || [];
    if (zmeny.length === 0) { cil.innerHTML = '<span class="note">Zatím beze změn.</span>'; return; }
    cil.innerHTML = zmeny
      .map((z) =>
        '<div class="zaznam"><div class="hlava"><span class="kdy">' + z.cas + '</span><span>' + z.kdo + '</span></div>' +
        '<span class="co">' + z.popis + '</span>' +
        (z.zmeny && z.zmeny.length ? '<span class="detail-zmeny">' + z.zmeny.join(' · ') + '</span>' : '') +
        '</div>',
      )
      .join('');
  } catch (e) {
    cil.innerHTML = '<span class="note">Historii se nepodařilo načíst: ' + e.message + '</span>';
  }
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
    // Po uložení se stránka načte znovu (souhrny se musí přepočítat) a rovnou
    // ukáže, co se stalo — jinak nejde poznat, jestli se uložilo, a člověk
    // klikne podruhé.
    const stav = data.zmeneno === false ? 'bezezmen' : 'ulozeno';
    const kam = data.id ? '/admin?vybrano=' + data.id + '&stav=' + stav : '/admin?stav=smazano';
    location.assign(kam);
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
    zdroj_uhrady: el('d-zdroj').value,
    rozpustit_mesicu: el('d-rozpustit').value.trim(),
    rozpustit_od: el('d-rozpustit-od').value.trim(),
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

// „Děda platí 4 000, zbytek si ženské rozdělí." Pevně zadané částky zůstanou,
// zbytek se rozpustí mezi ostatní zaškrtnuté — a to do posledního haléře,
// takže nic nezůstane viset jako nerozděleno.
el('d-zbytek-rovnym').addEventListener('click', () => {
  const celkem = Math.round((cislo(el('d-castka').value) || 0) * 100);
  const zapojeni = MODEL.osoby.filter((o) => q('[data-zapojen="' + o.id + '"]').checked);
  const maPevnou = (o) =>
    q('[data-rezim="' + o.id + '"]').value === 'castka' &&
    q('[data-hodnota="' + o.id + '"]').value.trim() !== '';

  const pevni = zapojeni.filter(maPevnou);
  const zbyvajici = zapojeni.filter((o) => !maPevnou(o));
  if (zbyvajici.length === 0) { hlaska('Není komu zbytek rozdělit — všichni zaškrtnutí mají pevnou částku.', 'chyba'); return; }

  const obsazeno = pevni.reduce((soucet, o) => soucet + Math.round((cislo(q('[data-hodnota="' + o.id + '"]').value) || 0) * 100), 0);
  const zbytek = celkem - obsazeno;
  if (zbytek < 0) { hlaska('Pevné částky přesahují celkovou částku položky.', 'chyba'); return; }

  const dil = Math.floor(zbytek / zbyvajici.length);
  let navic = zbytek - dil * zbyvajici.length;
  zbyvajici.forEach((o) => {
    const castka = dil + (navic > 0 ? 1 : 0);
    if (navic > 0) navic--;
    q('[data-rezim="' + o.id + '"]').value = 'castka';
    q('[data-hodnota="' + o.id + '"]').value = String(castka / 100);
  });
  hlaska('', '');
  prepocitej();
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

/* ---------- řazení a filtry ---------- */

const telo = document.querySelector('#grid tbody');
const vsechnyRadky = [...document.querySelectorAll('#grid tbody tr')];
let razeni = { klic: null, smer: 1 };

/** Text buňky pro řazení i pro textový filtr. */
function hodnota(tr, klic) {
  const bunka = tr.querySelector('[data-klic="' + klic + '"]');
  if (!bunka) return '';
  return bunka.dataset.v !== undefined ? Number(bunka.dataset.v) : bunka.textContent.trim();
}

function projdeFiltrem(tr) {
  const hledane = el('filtr').value.trim().toLowerCase();
  if (hledane && !tr.textContent.toLowerCase().includes(hledane)) return false;
  for (const pole of document.querySelectorAll('[data-filtr]')) {
    const chtene = pole.value.trim();
    if (chtene === '') continue;
    const klic = pole.dataset.filtr;
    // Volby porovnávají celou hodnotu, textové pole hledá kdekoli uvnitř.
    const je = klic === 'stav' ? tr.dataset.stav : String(hodnota(tr, klic));
    const shoda =
      pole.tagName === 'SELECT'
        ? je.trim() === chtene || (chtene === 'bez kategorie' && je.trim() === 'bez kategorie')
        : je.toLowerCase().includes(chtene.toLowerCase());
    if (!shoda) return false;
  }
  return true;
}

/**
 * Součty i souhrn po kategoriích se počítají **z viditelných řádků**.
 * Kdyby zůstaly serverové, filtr by ukazoval výběr položek a pod ním celek
 * za všechno — a nikdo by nepoznal, že spolu nesouvisí.
 */
function prepoctiSoucty(videt) {
  const soucty = new Map();
  const pricti = (klic, castka) => soucty.set(klic, (soucty.get(klic) ?? 0) + castka);

  for (const tr of videt) {
    if (tr.dataset.souctu !== '1') continue;
    const kam = tr.dataset.jedno === '1' ? 'saldo' : 'mesicne';
    pricti(kam, hodnota(tr, 'mesicne'));
    for (const bunka of tr.querySelectorAll('[data-klic^="osoba-"]')) {
      pricti(kam + '-' + bunka.dataset.klic.slice(6), Number(bunka.dataset.v));
    }
  }

  for (const bunka of document.querySelectorAll('[data-soucet]')) {
    const v = soucty.get(bunka.dataset.soucet) ?? 0;
    const jeSaldo = bunka.dataset.soucet.startsWith('saldo');
    bunka.textContent = jeSaldo ? kcZn(v) : kc(v);
    bunka.classList.toggle('minus', v < 0);
  }

  // Po kategoriích — jen pravidelné a rozpouštěné, stejně jako na serveru.
  // Když žádná kategorie není, souhrn se nevykresluje a není co přepočítávat.
  if (!el('kat-radky')) return;
  const kategorie = new Map();
  for (const tr of videt) {
    if (tr.dataset.jedno === '1') continue;
    const castka = hodnota(tr, 'mesicne');
    if (castka === 0) continue;
    const nazev = tr.dataset.kat || 'Bez kategorie';
    kategorie.set(nazev, (kategorie.get(nazev) ?? 0) + castka);
  }
  const serazene = [...kategorie.entries()].sort((a, b) => b[1] - a[1]);
  const max = Math.max(...serazene.map(([, v]) => v), 1);
  const celkem = serazene.reduce((a, [, v]) => a + v, 0);
  el('kat-radky').innerHTML = serazene
    .map(
      ([nazev, castka]) =>
        '<div class="kat"><span class="jmeno">' + nazev.replace(/[<>&]/g, '') + '</span>' +
        '<span class="mesicne">' + kc(castka) + '</span>' +
        '<span class="rocne">' + kc(castka * 12) + ' / rok</span>' +
        '<i style="width:' + Math.round((castka / max) * 100) + '%"></i></div>',
    )
    .join('');
  el('kat-celkem').textContent = kc(celkem) + ' měsíčně · ' + kc(celkem * 12) + ' ročně';
}

function pouzij() {
  const videt = vsechnyRadky.filter((tr) => {
    const ok = projdeFiltrem(tr);
    tr.style.display = ok ? '' : 'none';
    return ok;
  });

  if (razeni.klic !== null) {
    const serazene = [...videt].sort((a, b) => {
      const x = hodnota(a, razeni.klic);
      const y = hodnota(b, razeni.klic);
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'cs');
      return r * razeni.smer;
    });
    serazene.forEach((tr) => telo.appendChild(tr));
  }

  prepoctiSoucty(videt);

  el('pocet').textContent =
    videt.length + (videt.length === 1 ? ' položka' : videt.length >= 2 && videt.length <= 4 ? ' položky' : ' položek') +
    (videt.length === vsechnyRadky.length ? '' : ' z ' + vsechnyRadky.length);

  const filtrovano = videt.length !== vsechnyRadky.length;
  el('filtr-info').hidden = !filtrovano;
  if (filtrovano) {
    el('filtr-info-text').textContent =
      'Filtr je zapnutý — součty i kategorie počítají jen z ' + videt.length + ' zobrazených položek.';
  }
}

// Bez tabulky (žádná položka) není co řadit ani filtrovat.
if (telo !== null) {
document.querySelectorAll('[data-radit]').forEach((th) => {
  const radit = () => {
    const klic = th.dataset.radit;
    razeni = { klic, smer: razeni.klic === klic && razeni.smer === 1 ? -1 : 1 };
    document.querySelectorAll('[data-radit]').forEach((x) => x.removeAttribute('data-smer'));
    th.dataset.smer = razeni.smer === 1 ? 'asc' : 'desc';
    pouzij();
  };
  th.addEventListener('click', radit);
  th.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); radit(); }
  });
});

document.querySelectorAll('[data-filtr]').forEach((pole) => {
  pole.addEventListener('input', pouzij);
  pole.addEventListener('change', pouzij);
});
el('filtr').addEventListener('input', pouzij);

el('filtr-zrusit').addEventListener('click', () => {
  document.querySelectorAll('[data-filtr]').forEach((pole) => { pole.value = ''; });
  el('filtr').value = '';
  pouzij();
});
}

// Po návratu z uložení označ řádek a řekni, co se stalo.
if (vybraneId !== null) {
  const radek = document.querySelector('#grid tbody tr[data-id="' + vybraneId + '"]');
  if (radek) {
    document.querySelectorAll('#grid tbody tr').forEach((x) => x.removeAttribute('data-selected'));
    radek.setAttribute('data-selected', 'true');
  }
}

if (STAV_PO_ULOZENI === 'ulozeno') {
  hlaska('Uloženo v ' + new Date().toLocaleTimeString('cs-CZ') + '. Změna je zapsaná v historii níž.', 'ok');
} else if (STAV_PO_ULOZENI === 'bezezmen') {
  hlaska('Nic se nezměnilo, takže se nic neukládalo — v historii nepřibyl záznam.', 'ok');
} else if (STAV_PO_ULOZENI === 'smazano') {
  hlaska('Položka smazána.', 'ok');
}

ukazPolozku(vybraneId);
</script>`;

  return shell({
    aktivni: 'naklady',
    nazevDomu: prehled.nazev_domu,
    titulek: 'Náklady domu',
    commit,
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
