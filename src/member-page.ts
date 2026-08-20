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
import { zalohaVMesici, type Nastaveni, type Zaloha } from './db.js';
import { pocetMesicu, type RadekVyrovnani } from './more-pages.js';
import { cisloMesice, formatKc, mesicNyni, popisPeriody, posunMesic } from './money.js';
import type { Osoba, Prehled } from './model.js';
import { esc, FAVICON } from './ui.js';

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

/* ---------- měsíc po měsíci: co měl poslat × co přišlo ---------- */

export interface MesicMaDal {
  mesic: string;
  /** kolik měl ten měsíc poslat — záloha platná v tom měsíci */
  maPoslat: number;
  /** co za ten měsíc doopravdy přišlo na účet */
  prislo: number;
  /** je ten měsíc už po splatnosti? do té doby ještě není co dlužit */
  splatny: boolean;
}

/**
 * Rozpad příspěvků po měsících od počátku sledování do dneška.
 *
 * Platba se počítá do měsíce, ve kterém přišla na účet. Když někdo pošle
 * zálohu za prosinec až v lednu, uvidí ji u ledna — a u prosince díru.
 * Je to nepřesné jen zdánlivě: součet za období sedí a je vidět, že se to
 * o měsíc posunulo, což je přesně ta informace, kterou člověk hledá.
 */
export function maDalPoMesicich(
  zalohy: Zaloha[],
  platby: PlatbaClena[],
  member_id: number,
  nastaveni: Nastaveni,
  ted = new Date(),
): MesicMaDal[] {
  const od = nastaveni.vyuctovani_od;
  const dnes = mesicNyni(ted);
  const splatnych = pocetMesicu(od, nastaveni.den_splatnosti, ted);

  const prisloVMesici = new Map<string, number>();
  for (const p of platby) {
    const mesic = p.datum.slice(0, 7);
    prisloVMesici.set(mesic, (prisloVMesici.get(mesic) ?? 0) + p.castka);
  }

  const mesice: MesicMaDal[] = [];
  // Běžící měsíc patří do výpisu, i když ještě není splatný — ať je vidět,
  // že se na něj čeká, a ne aby prostě chyběl.
  for (let i = 0; cisloMesice(posunMesic(od, i)) <= cisloMesice(dnes); i++) {
    const mesic = posunMesic(od, i);
    const splatny = i < splatnych;
    mesice.push({
      mesic,
      maPoslat: zalohaVMesici(zalohy, member_id, mesic),
      prislo: prisloVMesici.get(mesic) ?? 0,
      splatny,
    });
  }
  return mesice;
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
  zalohy: Zaloha[],
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

  // U každé položky i **můj** podíl — to je ta část, kvůli které se sem chodí.
  // Kolik z toho platí ostatní, tady schválně není.
  const mojeIds = [osoba.id, ...prehled.osoby.filter((d) => (d.pod_member_id ?? null) === osoba.id).map((d) => d.id)];
  const mujPodilRadku = (r: (typeof souhrnDomu.radky)[number]): number =>
    mojeIds.reduce((a, id) => a + (r.naOsobu.get(id) ?? 0), 0);

  const polozkyDomu = souhrnDomu.radky
    .filter((r) => r.castka !== 0 && !r.jednorazovy)
    .sort((a, b) => b.castka - a.castka)
    .map((r) => {
      const muj = mujPodilRadku(r);
      return `<div class="polozka">
      <span class="nazev">${esc(r.polozka.nazev)}</span>
      <span class="cislo">${formatKc(r.castka)}</span>
      <small>${esc(popisPeriody(r.polozka.perioda))}${
        r.polozka.poznamka ? ` · ${esc(r.polozka.poznamka)}` : ''
      }</small>
      <small class="cislo ${muj > 0 ? 'moje' : ''}">${muj > 0 ? `z toho já ${formatKc(muj)}` : 'nepodílím se'}</small>
    </div>`;
    })
    .join('');

  const mujMesicne = souhrnDomu.radky
    .filter((r) => !r.jednorazovy)
    .reduce((a, r) => a + mujPodilRadku(r), 0);

  /* --- měsíc po měsíci: co měl poslat × co přišlo --- */

  const mesice = maDalPoMesicich(zalohy, platby, osoba.id, nastaveni);
  const soucetMa = mesice.filter((m) => m.splatny).reduce((a, m) => a + m.maPoslat, 0);
  const soucetDal = mesice.reduce((a, m) => a + m.prislo, 0);
  // Do celkového „zaplaceno" se počítá i to, co člověk zaplatil ze svého
  // (nákup pro dům) — ve výpisu z účtu to není, tak se to musí přiznat zvlášť,
  // jinak by součty ve výpisu nesouhlasily s číslem nahoře.
  const jinak = radek.zaplaceno - soucetDal;

  const radkyMesicu = mesice
    .map((m) => {
      const stav = !m.splatny
        ? 'ceka'
        : m.prislo >= m.maPoslat
          ? 'ok'
          : m.prislo > 0
            ? 'cast'
            : 'chybi';
      const popis = !m.splatny
        ? 'ještě není splatné'
        : m.prislo >= m.maPoslat
          ? 'zaplaceno'
          : m.prislo > 0
            ? `chybí ${formatKc(m.maPoslat - m.prislo)}`
            : 'zatím nepřišlo';
      const [rok, cislo] = m.mesic.split('-');
      return `<div class="mesic ${stav}">
      <span class="kdy">${Number(cislo)}/${rok?.slice(2) ?? ''}</span>
      <span class="cislo ma">${m.maPoslat === 0 ? '—' : formatKc(m.maPoslat)}</span>
      <span class="cislo dal">${m.prislo === 0 ? '—' : formatKc(m.prislo)}</span>
      <span class="popis">${popis}</span>
    </div>`;
    })
    .join('');

  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>Můj příspěvek — ${esc(nastaveni.nazev_domu)}</title>
${FAVICON}
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
.polozka { grid-template-columns: 1fr auto; }
.polozka .nazev { font-weight: 550; }
.polozka small { color: var(--tlumene); font-size: 12.5px; }
.polozka small.moje { color: var(--akcent); font-weight: 600; }
.paticka { color: var(--tlumene); font-size: 12px; text-align: center; }

/* měsíc po měsíci — dva sloupce: co měl poslat a co přišlo */
.hlavicky-mesicu, .mesic {
  display: grid; grid-template-columns: 54px 1fr 1fr; gap: 1px 8px;
  align-items: baseline; font-variant-numeric: tabular-nums;
}
.hlavicky-mesicu { color: var(--tlumene); font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; padding-bottom: 4px; border-bottom: 1px solid var(--linka); }
.hlavicky-mesicu span:not(:first-child) { text-align: right; }
.mesic { padding: 7px 0; border-bottom: 1px solid var(--linka); }
.mesic .kdy { font-family: var(--mono); color: var(--tlumene); font-size: 13.5px; }
.mesic .ma { color: var(--tlumene); }
.mesic .dal { font-weight: 600; }
.mesic .popis { grid-column: 2 / -1; text-align: right; font-size: 12.5px; color: var(--tlumene); }
.mesic.ok .dal { color: var(--ok); }
.mesic.chybi .dal, .mesic.cast .dal { color: var(--dluh); }
.mesic.ok .popis { color: var(--ok); }
.mesic.chybi .popis, .mesic.cast .popis { color: var(--dluh); }
.mesic.ceka { opacity: .62; }
.soucty { display: grid; grid-template-columns: 54px 1fr 1fr; gap: 2px 8px; padding-top: 8px; font-variant-numeric: tabular-nums; }
.soucty .cislo { text-align: right; }
.soucty .celkem { font-weight: 650; }
.doplnek { display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; padding-top: 6px; margin-top: 6px; border-top: 1px solid var(--linka); font-variant-numeric: tabular-nums; }
.doplnek .vysledek { font-weight: 650; }

/* prokliky do panelu */
.prokliky { display: flex; flex-wrap: wrap; gap: 6px; }
.tlacitko {
  font: inherit; font-size: 13.5px; color: var(--akcent); background: var(--karta);
  border: 1px solid var(--linka); border-radius: 999px; padding: 6px 12px; cursor: pointer;
}
.tlacitko:hover { border-color: var(--akcent); }
.stav .tlacitko { margin-top: 12px; }

/* hamburger a výsuvný panel */
.hlavicka-vpravo { display: flex; align-items: center; gap: 10px; }
.ham { background: var(--karta); border: 1px solid var(--linka); border-radius: 8px; padding: 5px 8px; cursor: pointer; color: var(--text); display: flex; }
.ham svg { width: 18px; height: 18px; stroke: currentColor; stroke-width: 1.7; }
.zaves { position: fixed; inset: 0; background: rgba(8, 14, 20, .5); border: 0; padding: 0; }
.panel {
  position: fixed; top: 0; right: 0; bottom: 0; width: min(460px, 94vw); z-index: 2;
  background: var(--pozadi); border-left: 1px solid var(--linka); overflow-y: auto;
  padding: 12px 12px 40px; display: flex; flex-direction: column; gap: 12px;
  box-shadow: -10px 0 28px rgba(8, 14, 20, .22);
}
.panel-hlava { display: flex; justify-content: space-between; align-items: center; position: sticky; top: -12px; background: var(--pozadi); padding: 4px 0 6px; margin: -4px 0 0; }
.zavri { font: inherit; font-size: 18px; line-height: 1; background: var(--karta); border: 1px solid var(--linka); border-radius: 8px; padding: 5px 10px; color: var(--text); cursor: pointer; }
.panel .karta { scroll-margin-top: 44px; }
</style>
</head>
<body>
  <div class="hlavicka">
    <h1>${esc(osoba.jmeno)}</h1>
    <div class="hlavicka-vpravo">
      <span>${esc(nastaveni.nazev_domu)}</span>
      <button class="ham" id="ham" aria-label="Podrobnosti" aria-expanded="false" aria-controls="panel">
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M2 4.5h14M2 9h14M2 13.5h14" stroke-linecap="round"/></svg>
      </button>
    </div>
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
    ${
      qr === null
        ? ''
        : `<button class="tlacitko" type="button" data-otevri="s-qr">Zaplatit QR kódem</button>`
    }
  </section>

  <section class="karta">
    <h2>Měsíc po měsíci</h2>
    <div class="hlavicky-mesicu">
      <span>Měsíc</span><span>Má poslat</span><span>Přišlo</span>
    </div>
    ${radkyMesicu || '<p class="pozn">Sledování ještě nezačalo.</p>'}
    <div class="soucty">
      <span class="celkem">Celkem</span>
      <span class="cislo celkem">${formatKc(soucetMa)}</span>
      <span class="cislo celkem">${formatKc(soucetDal)}</span>
    </div>
    <div class="doplnek">
      ${
        jinak !== 0
          ? `<span>Zaplaceno mimo účet (nákup ze svého)</span><span class="cislo">${formatKc(jinak)}</span>`
          : ''
      }
      ${
        radek.zustatek !== 0
          ? `<span>${radek.zustatek > 0 ? 'Doplatek z vyúčtování' : 'K dobru z vyúčtování'}</span><span class="cislo">${formatKc(
              Math.abs(radek.zustatek),
            )}</span>`
          : ''
      }
      <span class="vysledek">${dluzi ? 'Zbývá doplatit' : radek.rozdil < 0 ? 'Předplaceno' : 'Vyrovnáno'}</span>
      <span class="cislo vysledek">${formatKc(Math.abs(radek.rozdil))}</span>
    </div>
    <p class="pozn">
      „Má poslat" je záloha platná v tom měsíci, „Přišlo" je to, co v něm dorazilo na účet.
      Platba za minulý měsíc, která přijde se zpožděním, se ukáže u měsíce, kdy doopravdy přišla.
      Běžící měsíc se do dluhu počítá až dnem splatnosti.
    </p>
    <div class="prokliky">
      <button class="tlacitko" type="button" data-otevri="s-platby">Jednotlivé platby</button>
    </div>
  </section>

  <div class="prokliky">
    ${qr === null ? '' : `<button class="tlacitko" type="button" data-otevri="s-qr">QR platba</button>`}
    <button class="tlacitko" type="button" data-otevri="s-platby">Moje platby</button>
    <button class="tlacitko" type="button" data-otevri="s-podil">Můj podíl po měsících</button>
    <button class="tlacitko" type="button" data-otevri="s-naklady">Náklady domu na rok</button>
  </div>

  <div class="paticka">Přehled je jen ke čtení · verze ${esc(commit)}</div>

  <button class="zaves" id="zaves" type="button" aria-label="Zavřít podrobnosti" hidden></button>
  <aside class="panel" id="panel" aria-label="Podrobnosti" hidden>
    <div class="panel-hlava">
      <b>Podrobnosti</b>
      <button class="zavri" id="zavri" type="button" aria-label="Zavřít">✕</button>
    </div>

    ${
      qr === null
        ? ''
        : `<section class="karta" id="s-qr">
      <h2>QR platba</h2>
      ${qr}
      <p class="pozn">
        Naskenuj v mobilní bance — částka i variabilní symbol se vyplní samy.
        Když máš trvalý příkaz, tohle potřebovat nebudeš; hodí se na doplatek.
      </p>
    </section>`
    }

    <section class="karta" id="s-platby">
      <h2>Moje platby</h2>
      ${radkyPlateb}
    </section>

    <section class="karta" id="s-podil">
      <h2>Můj podíl po měsících</h2>
      ${graf(vyvoj)}
      <p class="pozn">
        Kolik na mě v tom měsíci připadlo z nákladů domu — to je něco jiného než záloha.
        Plné sloupce jsou uzavřené měsíce, světlé se ještě můžou změnit. Za sledované období
        to dělá ${formatKc(radek.skutecne)}; rozdíl proti zálohám srovná vyúčtování.
      </p>
    </section>

    <section class="karta" id="s-naklady">
      <h2>Náklady domu na rok</h2>
      <div class="rozpis">
        <span class="soucet">Celkem</span><span class="cislo soucet">${formatKc(rocne)}</span>
      </div>
      <p class="pozn">Tolik stojí provoz domu za rok — bez ohledu na to, kdo se na čem podílí.</p>
      ${radkyKategorii}
      <h2 style="margin-top:16px">Z čeho se to skládá</h2>
      <div class="rozpis" style="margin-bottom:6px">
        <span class="soucet">Můj podíl měsíčně</span><span class="cislo soucet">${formatKc(mujMesicne)}</span>
      </div>
      ${polozkyDomu}
      <p class="pozn">Částky jsou měsíční; roční jsou dvanáctinásobek.</p>
    </section>
  </aside>

<script>
const panel = document.getElementById('panel');
const zaves = document.getElementById('zaves');
const ham = document.getElementById('ham');

function prepni(otevrit, kam) {
  panel.hidden = !otevrit;
  zaves.hidden = !otevrit;
  ham.setAttribute('aria-expanded', otevrit ? 'true' : 'false');
  // Pozadí se pod otevřeným panelem nesmí scrollovat, jinak si na telefonu
  // člověk posune stránku a neví, kam se vrátil.
  document.body.style.overflow = otevrit ? 'hidden' : '';
  if (!otevrit) { ham.focus(); return; }
  const cil = kam ? document.getElementById(kam) : null;
  // Bez skoku na začátek by panel zůstal tam, kde ho člověk minule opustil.
  panel.scrollTop = 0;
  if (cil) cil.scrollIntoView({ block: 'start' });
}

ham.addEventListener('click', () => prepni(true));
zaves.addEventListener('click', () => prepni(false));
document.getElementById('zavri').addEventListener('click', () => prepni(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) prepni(false); });
document.querySelectorAll('[data-otevri]').forEach((b) => {
  b.addEventListener('click', () => prepni(true, b.dataset.otevri));
});
</script>
</body>
</html>`;
}
