/**
 * Osobní přehled pro člena domácnosti — veřejný, na neuhodnutelném odkazu.
 *
 * Dívá se na to skoro výhradně telefon, takže je stránka stavěná mobilem
 * napřed: velká čísla, jeden sloupec, žádné tabulky ke scrollování do stran.
 *
 * Vidí jen **svoje** čísla a souhrn za dům. Kolik platí ostatní, se odsud
 * nedozví — proto má každý svůj vlastní odkaz.
 */
import qrcode from 'qrcode-generator';
import { spocitej } from './admin-page.js';
import type { Nastaveni } from './db.js';
import type { RadekVyrovnani } from './more-pages.js';
import { formatKc, popisPeriody, posunMesic } from './money.js';
import type { Osoba, Prehled } from './model.js';
import { esc } from './ui.js';

export interface PlatbaClena {
  datum: string;
  castka: number;
  matched_by: string | null;
}

export interface MesicniBod {
  mesic: string;
  castka: number;
  uzavreno: boolean;
}

/* ---------- QR platba ---------- */

/**
 * QR platba podle standardu SPAYD (SPD*1.0). Načte ji každá česká
 * mobilní banka — příjemce, částka i variabilní symbol jsou v ní,
 * takže se nic nepřepisuje ručně a nevznikne překlep ve VS.
 */
export function spaydRetezec(
  iban: string,
  castka: number,
  vs: string | null,
  zprava: string,
): string {
  const casti = [
    'SPD*1.0',
    `ACC:${iban}`,
    `AM:${(castka / 100).toFixed(2)}`,
    'CC:CZK',
  ];
  if (vs) casti.push(`X-VS:${vs}`);
  // Diakritika ve zprávě dělá v bankách paseku, tak ji rovnou odstraním.
  const cisteZprava = zprava
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ./-]/g, '')
    .slice(0, 35);
  if (cisteZprava) casti.push(`MSG:${cisteZprava}`);
  return casti.join('*');
}

function qrSvg(obsah: string): string {
  const kod = qrcode(0, 'M');
  kod.addData(obsah);
  kod.make();
  const pocet = kod.getModuleCount();

  // Vlastní SVG místo createSvgTag: chci jednu cestu, currentColor a
  // rozměr v procentech, aby se QR přizpůsobil šířce telefonu.
  let cesta = '';
  for (let r = 0; r < pocet; r++) {
    for (let s = 0; s < pocet; s++) {
      if (kod.isDark(r, s)) cesta += `M${s} ${r}h1v1h-1z`;
    }
  }
  return `<svg viewBox="-2 -2 ${pocet + 4} ${pocet + 4}" class="qr" role="img" aria-label="QR platba">
    <rect x="-2" y="-2" width="${pocet + 4}" height="${pocet + 4}" fill="#fff"/>
    <path d="${cesta}" fill="#000"/>
  </svg>`;
}

/* ---------- graf ---------- */

/** Sloupcový graf měsíčních podílů. Jednoduchý, bez os — jde o trend, ne o odečítání. */
function graf(bodu: MesicniBod[]): string {
  if (bodu.length === 0) return '<p class="pozn">Zatím není co ukázat.</p>';
  const max = Math.max(...bodu.map((b) => b.castka), 1);
  // Při jednom dvou měsících by sloupec zabral celou šířku a vypadal jako blok;
  // proto se počítá minimálně se šesti pozicemi.
  const sirka = 100 / Math.max(bodu.length, 6);

  const sloupce = bodu
    .map((b, i) => {
      const vyska = Math.max(1, (b.castka / max) * 100);
      const x = i * sirka;
      return `<rect x="${x + sirka * 0.15}" y="${100 - vyska}" width="${sirka * 0.7}" height="${vyska}"
        class="${b.uzavreno ? 'sloupec uzavreno' : 'sloupec'}"><title>${esc(b.mesic)}: ${formatKc(b.castka)}</title></rect>`;
    })
    .join('');

  const popisky = bodu
    .map((b, i) => {
      // Na telefonu se všechny popisky nevejdou, tak jen každý druhý.
      if (bodu.length > 6 && i % 2 === 1) return '';
      const mesic = Number(b.mesic.slice(5, 7));
      return `<span style="left:${(i + 0.5) * sirka}%">${mesic}.</span>`;
    })
    .join('');

  return `<div class="graf">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${sloupce}</svg>
    <div class="popisky">${popisky}</div>
  </div>`;
}

/* ---------- stránka ---------- */

export function renderClen(
  osoba: Osoba,
  radek: RadekVyrovnani,
  vyvoj: MesicniBod[],
  platby: PlatbaClena[],
  prehled: Prehled,
  nastaveni: Nastaveni,
  iban: string | null,
  splatnost: Date,
  commit: string,
): string {
  const dluzi = radek.rozdil > 0;
  const castkaQr = radek.rozdil > 0 ? radek.rozdil : radek.zaloha;
  const zprava = `Prispevek ${nastaveni.nazev_domu}`.slice(0, 35);
  const qr =
    iban && castkaQr > 0
      ? qrSvg(spaydRetezec(iban, castkaQr, osoba.vs ?? null, zprava))
      : null;

  // Souhrn za dům — bez rozpadu na osoby. Kdo kolik platí, sem nepatří.
  const souhrnDomu = spocitej(prehled);
  const rocne = souhrnDomu.mesicneCelkem * 12;
  // Do ročního součtu jdou jen opakované a rozpouštěné náklady — u těch je
  // dvanáctinásobek měsíčního dílu správně. Jednorázová položka se násobit
  // dvanácti nesmí, jinak by kategorie nesouhlasily s celkem.
  const kategorie = new Map<string, number>();
  for (const r of souhrnDomu.radky) {
    if (r.castka === 0 || r.jednorazovy) continue;
    const klic = r.polozka.kategorie ?? 'Ostatní';
    kategorie.set(klic, (kategorie.get(klic) ?? 0) + r.castka * 12);
  }
  const maxKat = Math.max(...[...kategorie.values()], 1);

  const radkyKategorii = [...kategorie.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(
      ([nazev, castka]) => `<div class="kat">
      <span>${esc(nazev)}</span>
      <span class="cislo">${formatKc(castka)}</span>
      <i style="width:${Math.round((castka / maxKat) * 100)}%"></i>
    </div>`,
    )
    .join('');

  const radkyPlateb =
    platby.length === 0
      ? '<p class="pozn">Zatím tu není žádná platba.</p>'
      : platby
          .map(
            (p) => `<div class="platba">
        <span>${esc(p.datum.split('-').reverse().join('. '))}</span>
        <span class="cislo">${formatKc(p.castka)}</span>
      </div>`,
          )
          .join('');

  const polozkyDomu = souhrnDomu.radky
    .filter((r) => r.castka !== 0 && !r.jednorazovy)
    .sort((a, b) => b.castka - a.castka)
    .map(
      (r) => `<div class="polozka">
      <span>${esc(r.polozka.nazev)}<small>${esc(popisPeriody(r.polozka.perioda))}</small></span>
      <span class="cislo">${formatKc(r.castka)}</span>
    </div>`,
    )
    .join('');

  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>Můj příspěvek — ${esc(nastaveni.nazev_domu)}</title>
<style>
:root {
  --pozadi: #f2f4f6; --karta: #ffffff; --text: #16202a; --tlumene: #667080;
  --linka: #dde3e9; --akcent: #31628c; --dluh: #a93b31; --ok: #3d7f4c;
  --ui: "Segoe UI Variable Text", "Segoe UI", -apple-system, system-ui, sans-serif;
  --mono: "Cascadia Mono", Consolas, ui-monospace, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --pozadi: #12171c; --karta: #1b2127; --text: #e7edf2; --tlumene: #96a3b0;
    --linka: #2a323a; --akcent: #6a9cce; --dluh: #e2705a; --ok: #63ac72;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 12px 12px 32px; background: var(--pozadi); color: var(--text);
  font-family: var(--ui); font-size: 16px; line-height: 1.45;
  -webkit-font-smoothing: antialiased;
  display: flex; flex-direction: column; gap: 12px;
  max-width: 560px; margin-inline: auto;
}
h1 { font-size: 17px; margin: 0; }
h2 { font-size: 15px; margin: 0 0 8px; }
.hlavicka { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; color: var(--tlumene); font-size: 13px; }
.karta { background: var(--karta); border: 1px solid var(--linka); border-radius: 10px; padding: 14px; }
.stav { text-align: center; padding: 20px 14px; }
.stav .popis { color: var(--tlumene); font-size: 13px; text-transform: uppercase; letter-spacing: .06em; }
.stav .velke { font-size: 40px; font-weight: 650; letter-spacing: -.02em; font-variant-numeric: tabular-nums; margin: 4px 0; }
.stav .velke.dluh { color: var(--dluh); }
.stav .velke.ok { color: var(--ok); }
.stav .pod { color: var(--tlumene); font-size: 14px; }
.qr { width: 100%; max-width: 260px; height: auto; margin: 14px auto 6px; display: block; border-radius: 6px; }
.rozpis { display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; font-variant-numeric: tabular-nums; }
.rozpis .cislo, .cislo { font-family: var(--mono); text-align: right; }
.rozpis .soucet { border-top: 1px solid var(--linka); padding-top: 5px; margin-top: 3px; font-weight: 650; }
.pozn { color: var(--tlumene); font-size: 13.5px; margin: 6px 0 0; }
.graf { position: relative; height: 130px; margin-top: 4px; }
.graf svg { width: 100%; height: 110px; display: block; }
.sloupec { fill: var(--akcent); opacity: .45; }
.sloupec.uzavreno { opacity: 1; }
.popisky { position: relative; height: 16px; color: var(--tlumene); font-size: 11px; }
.popisky span { position: absolute; transform: translateX(-50%); }
.platba, .kat, .polozka { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; padding: 7px 0; border-bottom: 1px solid var(--linka); }
.platba:last-child, .polozka:last-child { border-bottom: 0; }
.kat { position: relative; border-bottom: 0; padding-bottom: 12px; }
.kat i { grid-column: 1 / -1; height: 4px; border-radius: 2px; background: var(--akcent); opacity: .5; }
.polozka small { display: block; color: var(--tlumene); font-size: 12.5px; }
.paticka { color: var(--tlumene); font-size: 12px; text-align: center; }
</style>
</head>
<body>
  <div class="hlavicka">
    <h1>${esc(osoba.jmeno)}</h1>
    <span>${esc(nastaveni.nazev_domu)}</span>
  </div>

  <section class="karta stav">
    <div class="popis">${dluzi ? 'Zbývá doplatit' : radek.rozdil < 0 ? 'Máš předplaceno' : 'Vyrovnáno'}</div>
    <div class="velke ${dluzi ? 'dluh' : 'ok'}">${formatKc(Math.abs(radek.rozdil))}</div>
    <div class="pod">
      Záloha <b>${formatKc(radek.zaloha)}</b> měsíčně${
        radek.zaloha > 0
          ? ` · splatnost ${splatnost.toLocaleDateString('cs-CZ')}`
          : ' — zatím nestanovena'
      }
    </div>
    ${qr ?? ''}
    ${qr ? `<div class="pozn">Naskenuj v mobilní bance — částka i variabilní symbol se vyplní samy.</div>` : ''}
  </section>

  <section class="karta">
    <h2>Jak to vychází</h2>
    <div class="rozpis">
      <span>Předepsané zálohy</span><span class="cislo">${formatKc(radek.predepsano)}</span>
      <span>Zaplaceno</span><span class="cislo">${formatKc(radek.zaplaceno)}</span>
      <span class="soucet">${dluzi ? 'Zbývá doplatit' : 'Rozdíl'}</span><span class="cislo soucet">${formatKc(Math.abs(radek.rozdil))}</span>
    </div>
    <p class="pozn">
      Skutečný podíl na nákladech za sledované období je ${formatKc(radek.skutecne)}. Rozdíl proti
      zálohám se srovná při ročním vyúčtování — přeplatek sníží příští zálohu, nedoplatek ji zvýší.
    </p>
  </section>

  <section class="karta">
    <h2>Můj podíl po měsících</h2>
    ${graf(vyvoj)}
    <p class="pozn">Plné sloupce jsou uzavřené měsíce, světlé se ještě můžou změnit.</p>
  </section>

  <section class="karta">
    <h2>Moje platby</h2>
    ${radkyPlateb}
  </section>

  <section class="karta">
    <h2>Náklady domu na rok</h2>
    <div class="rozpis">
      <span class="soucet">Celkem</span><span class="cislo soucet">${formatKc(rocne)}</span>
    </div>
    <p class="pozn">Tolik stojí provoz domu za rok — bez ohledu na to, kdo se na čem podílí.</p>
    ${radkyKategorii}
    <h2 style="margin-top:14px">Z čeho se to skládá</h2>
    ${polozkyDomu}
    <p class="pozn">Částky jsou měsíční; roční jsou dvanáctinásobek.</p>
  </section>

  <div class="paticka">Přehled je jen ke čtení · verze ${esc(commit)}</div>
</body>
</html>`;
}
