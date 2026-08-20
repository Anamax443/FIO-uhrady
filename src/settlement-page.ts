/**
 * Stránka „Vyúčtování" — jednou za období se srovná záloha se skutečností.
 *
 * Záloha je schválně fixní, aby trvalý příkaz nemusel nikdo měnit každý měsíc.
 * Skutečné náklady ale kolísají, takže se rozdíl někde nasčítá. Vyúčtování ho
 * uzavře a **rozpustí do nové zálohy** — stejně jako u energií. Co se jednou
 * vyúčtovalo, se v dalším období už nepočítá; proto se čísla zamrazí
 * a počátek sledování se posune za konec období.
 */
import { spocitej } from './admin-page.js';
import { zalohaVMesici } from './db.js';
import type {
  Nastaveni,
  RadekVyuctovaniDb,
  Uzaverka,
  Vyuctovani,
  Zaloha,
  ZpusobVyrovnani,
} from './db.js';
import { cisloMesice, formatKc, mesicNyni, nahoruNaStovky, posunMesic } from './money.js';
import type { Osoba, Prehled } from './model.js';
import { esc, shell } from './ui.js';

export interface RadekVyuctovani {
  osoba: Osoba;
  zastupuje: string[];
  /** chodí od téhle osoby záloha na účet? */
  sledovat: boolean;
  /** součet záloh za období */
  predepsano: number;
  /** co za období přišlo — z účtu i placené ze svého */
  zaplaceno: number;
  /** skutečný podíl na nákladech za období */
  skutecne: number;
  /** skutecne − zaplaceno; kladné = má doplatit, záporné = má k dobru */
  rozdil: number;
  /** základ nové zálohy: odhad na příštích 12 měsíců + rezerva */
  zaklad: number;
  /** základ i s rozpuštěným rozdílem — návrh, když se nedoplatek rozloží */
  sRozdilem: number;
  /** nedoplatek přesahuje práh z Nastavení — rozpouštět ho appka sama nenavrhuje */
  nadPrah: boolean;
}

export interface Podklad {
  od: string;
  do: string;
  mesicu: number;
  /** měsíc, od kterého platí nové zálohy a začne další období */
  dalsi: string;
  radky: RadekVyuctovani[];
  /** uzavřené navazující měsíce, které jde vyúčtovat */
  moznaObdobi: string[];
}

/**
 * Které měsíce jde vyúčtovat: uzavřené a **navazující** od počátku sledování.
 *
 * Otevřený měsíc se pořád počítá z aktuálního nastavení, takže by se
 * vyúčtované číslo mohlo zpětně změnit. Díra uprostřed období by zase
 * znamenala, že se něco nezúčtovalo a přitom se za to období zavřelo.
 */
export function vyuctovatelneMesice(
  nastaveni: Nastaveni,
  uzaverky: Map<string, Uzaverka>,
  ted = new Date(),
): string[] {
  const mesice: string[] = [];
  const dnes = mesicNyni(ted);
  let m = nastaveni.vyuctovani_od;
  while (m <= dnes && uzaverky.has(m)) {
    mesice.push(m);
    m = posunMesic(m, 1);
  }
  return mesice;
}

/**
 * Spočítá podklad pro vyúčtování za období od počátku sledování do `obdobiDo`.
 *
 * `zaplaceno` musí být za **totéž období** — jinak by se do vyúčtování dostaly
 * peníze, které na něj nepatří.
 */
export function podkladVyuctovani(
  prehled: Prehled,
  zalohy: Zaloha[],
  uzaverky: Map<string, Uzaverka>,
  nastaveni: Nastaveni,
  zaplaceno: Map<number, number>,
  obdobiDo: string,
  ted = new Date(),
): Podklad {
  const moznaObdobi = vyuctovatelneMesice(nastaveni, uzaverky, ted);
  const od = nastaveni.vyuctovani_od;
  const mesicu = Math.max(0, cisloMesice(obdobiDo) - cisloMesice(od) + 1);
  const dalsi = posunMesic(obdobiDo, 1);

  const sectiSDetmi = (o: Osoba, mapa: Map<number, number>): number => {
    let soucet = mapa.get(o.id) ?? 0;
    for (const d of prehled.osoby) if ((d.pod_member_id ?? null) === o.id) soucet += mapa.get(d.id) ?? 0;
    return soucet;
  };

  // Za období se sčítají zamražená čísla z uzávěrek. Přepočítávat je z dnešního
  // nastavení by znamenalo tvrdit, že tehdy platilo, co platí teď.
  const predepsanoZa = new Map<number, number>();
  const skutecneZa = new Map<number, number>();
  for (let i = 0; i < mesicu; i++) {
    const mesic = posunMesic(od, i);
    const uzaverka = uzaverky.get(mesic);
    const souhrn = uzaverka === undefined ? spocitej(prehled, mesic) : null;
    for (const o of prehled.osoby) {
      const zamrazene = uzaverka?.podily.get(o.id);
      const podil =
        zamrazene?.podil ??
        (souhrn === null ? 0 : sectiSDetmi(o, souhrn.mesicneOsoba) + sectiSDetmi(o, souhrn.saldoOsoba));
      const zaloha = zamrazene?.zaloha ?? zalohaVMesici(zalohy, o.id, mesic);
      skutecneZa.set(o.id, (skutecneZa.get(o.id) ?? 0) + podil);
      predepsanoZa.set(o.id, (predepsanoZa.get(o.id) ?? 0) + zaloha);
    }
  }

  // Odhad na příštích 12 měsíců — od měsíce, kterým začne další období.
  const odhadRoku = new Map<number, number>();
  for (let i = 0; i < 12; i++) {
    const souhrn = spocitej(prehled, posunMesic(dalsi, i));
    for (const o of prehled.osoby) {
      odhadRoku.set(o.id, (odhadRoku.get(o.id) ?? 0) + sectiSDetmi(o, souhrn.mesicneOsoba));
    }
  }

  const radky = prehled.osoby
    .filter((o) => (o.pod_member_id ?? null) === null)
    .map((osoba): RadekVyuctovani => {
      const skutecne = skutecneZa.get(osoba.id) ?? 0;
      const uhrazeno = sectiSDetmi(osoba, zaplaceno);
      const rozdil = skutecne - uhrazeno;
      const mesicni = (odhadRoku.get(osoba.id) ?? 0) / 12;
      const zaklad = nahoruNaStovky(Math.round(mesicni * (1 + nastaveni.rezerva_procent / 100)));

      return {
        osoba,
        sledovat: Boolean(osoba.je_platce),
        predepsano: predepsanoZa.get(osoba.id) ?? 0,
        zaplaceno: uhrazeno,
        skutecne,
        rozdil,
        zaklad,
        sRozdilem: Math.max(
          0,
          nahoruNaStovky(Math.round(mesicni * (1 + nastaveni.rezerva_procent / 100) + rozdil / 12)),
        ),
        nadPrah: rozdil > nastaveni.prah_doplatku,
        zastupuje: prehled.osoby
          .filter((d) => (d.pod_member_id ?? null) === osoba.id)
          .map((d) => d.jmeno),
      };
    });

  return { od, do: obdobiDo, mesicu, dalsi, radky, moznaObdobi };
}

/**
 * Přeloží podklad na řádky k uložení. Volá se **na serveru znovu** — z prohlížeče
 * se berou jen rozhodnutí (rozpustit × doplatit a částka zálohy), ne čísla.
 */
export function radkyKUlozeni(
  podklad: Podklad,
  rozhodnuti: Map<number, { zpusob: ZpusobVyrovnani; nova_zaloha: number }>,
): { radky: RadekVyuctovaniDb[]; zalohy: { member_id: number; castka: number }[] } {
  const zalohy: { member_id: number; castka: number }[] = [];

  const radky = podklad.radky.map((r): RadekVyuctovaniDb => {
    const volba = rozhodnuti.get(r.osoba.id);
    // Bez zálohy není do čeho rozpouštět — u toho, od koho příspěvky nechodí,
    // zůstává rozdíl stát mimo zálohu.
    const zpusob: ZpusobVyrovnani = !r.sledovat ? 'jednorazove' : (volba?.zpusob ?? 'do_zalohy');
    const nova_zaloha = !r.sledovat
      ? 0
      : (volba?.nova_zaloha ?? (zpusob === 'do_zalohy' ? r.sRozdilem : r.zaklad));
    // Zálohu zakládá vyúčtování jen tomu, od koho příspěvky chodí. Ostatním by
    // v historii záloh zůstala nula, která by přebila starší platnou částku.
    if (r.sledovat) zalohy.push({ member_id: r.osoba.id, castka: nova_zaloha });
    return {
      member_id: r.osoba.id,
      predepsano: r.predepsano,
      zaplaceno: r.zaplaceno,
      skutecne: r.skutecne,
      rozdil: r.rozdil,
      zpusob,
      nova_zaloha,
      zustatek: zustatekRadku(r, zpusob),
    };
  });

  return { radky, zalohy };
}

/**
 * Kolik z rozdílu zůstane viset mimo zálohu.
 *
 * U toho, od koho příspěvky nechodí na účet, se **dluh nesleduje** — skládá se
 * jinak a narůstající číslo by nic neznamenalo. Peníze, které do domácnosti
 * opravdu dal (nákup ze svého), se naopak zapsat musí: to je skutečná
 * pohledávka a nesmí zmizet.
 */
function zustatekRadku(r: RadekVyuctovani, zpusob: ZpusobVyrovnani): number {
  if (!r.sledovat) return Math.min(0, r.rozdil);
  return zpusob === 'jednorazove' ? r.rozdil : 0;
}

/* ---------- stránka ---------- */

const STYL = `
<style>
.main { display: block; overflow-y: auto; }
.telo { padding: 11px 12px 16px; display: flex; flex-direction: column; gap: 12px; max-width: 960px; }
.vysvetleni { color: var(--text-dim); margin: 0; max-width: 76ch; }
.obdobi { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; color: var(--text-dim); }
.obdobi .btn, .obdobi a { text-decoration: none; }
.osoba-blok { border: 1px solid var(--border); border-radius: 2px; }
.osoba-blok .hlava { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 7px 11px; background: var(--chrome-hi); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.osoba-blok .hlava b { font-size: 13.5px; }
.osoba-blok .vypocet { padding: 9px 11px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px 12px; font-variant-numeric: tabular-nums; }
.osoba-blok .vypocet span:nth-child(even) { font-family: var(--mono); text-align: right; }
.osoba-blok .vysledek { border-top: 1px solid var(--border-soft); margin-top: 5px; padding-top: 5px; font-weight: 600; }
.volba { padding: 8px 11px; border-top: 1px solid var(--border-soft); display: flex; flex-direction: column; gap: 6px; }
.volba label { display: flex; align-items: baseline; gap: 7px; cursor: pointer; }
.volba .popisek { color: var(--text-dim); }
.zaloha-radek { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 3px; }
.zaloha-radek input { width: 104px; }
.zbyva { color: var(--warn); }
.preplatek { color: var(--ok); }
.varovani { color: var(--warn); }
.skupina { margin: 6px 0 0; font-size: 11px; letter-spacing: .5px; text-transform: uppercase; color: var(--text-faint); font-weight: 600; }
.akce { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-top: 4px; }
.historie { border: 1px solid var(--border); border-radius: 2px; }
.historie .radek { display: flex; align-items: baseline; gap: 10px; padding: 6px 11px; border-top: 1px solid var(--border-soft); flex-wrap: wrap; }
.historie .radek:first-of-type { border-top: 0; }
.historie .radek .spacer { flex: 1; }
@media (max-width: 560px) { .telo { padding: 10px 9px 14px; } }
</style>`;

const sklonujMesice = (n: number): string =>
  `${n} ${n === 1 ? 'měsíc' : n >= 2 && n <= 4 ? 'měsíce' : 'měsíců'}`;

export function renderVyuctovani(
  podklad: Podklad,
  hotova: Vyuctovani[],
  nastaveni: Nastaveni,
  nazevDomu: string,
  kdo: string,
  commit: string,
): string {
  const { radky, moznaObdobi, mesicu } = podklad;
  const jmena = new Map(podklad.radky.map((r) => [r.osoba.id, r.osoba.jmeno]));

  const blok = (r: RadekVyuctovani): string => {
    const stav =
      !r.sledovat && r.rozdil >= 0
        ? '<span class="note">dluh se nesleduje</span>'
        : r.rozdil > 0
          ? `<span class="zbyva">nedoplatek ${formatKc(r.rozdil)}</span>`
          : r.rozdil < 0
            ? `<span class="preplatek">${r.sledovat ? 'přeplatek' : 'má k dobru'} ${formatKc(-r.rozdil)}</span>`
            : '<span>vyrovnáno</span>';

    const volba = r.sledovat
      ? `<div class="volba">
        <label>
          <input type="radio" name="zpusob-${r.osoba.id}" value="do_zalohy" data-zpusob="${r.osoba.id}"${
            r.nadPrah ? '' : ' checked'
          } />
          <span><b>Rozpustit do zálohy</b><br /><span class="popisek">rozdíl se rozloží do dvanácti měsíců, trvalý příkaz zůstane fixní</span></span>
        </label>
        <label>
          <input type="radio" name="zpusob-${r.osoba.id}" value="jednorazove" data-zpusob="${r.osoba.id}"${
            r.nadPrah ? ' checked' : ''
          } />
          <span><b>${r.rozdil >= 0 ? 'Doplatit jednorázově' : 'Vrátit jednorázově'}</b><br /><span class="popisek">${
            r.rozdil >= 0
              ? 'rozdíl zůstane stát jako částka k doplacení, záloha se počítá jen z nákladů'
              : 'přeplatek se vrátí mimo zálohu'
          }</span></span>
        </label>
        ${
          r.nadPrah
            ? `<p class="vysvetleni varovani">Nedoplatek přesahuje práh ${formatKc(
                nastaveni.prah_doplatku,
              )} z Nastavení — rozpuštění do zálohy by ji zvedlo hodně, tak se appka radši ptá.</p>`
            : ''
        }
        <div class="zaloha-radek">
          <span class="popisek">Nová záloha od <b class="mono">${esc(podklad.dalsi)}</b>:</span>
          <input type="text" class="mono" data-zaloha="${r.osoba.id}"
                 data-zaklad="${(r.zaklad / 100).toFixed(0)}" data-srozdilem="${(r.sRozdilem / 100).toFixed(0)}"
                 value="${((r.nadPrah ? r.zaklad : r.sRozdilem) / 100).toFixed(0)}"
                 aria-label="Nová záloha ${esc(r.osoba.jmeno)}" />
          <span class="popisek">Kč / měs · ze samotných nákladů by vyšla ${formatKc(r.zaklad)}</span>
        </div>
      </div>`
      : `<div class="volba"><p class="vysvetleni">
          ${
            r.rozdil < 0
              ? `Vložil${r.osoba.jmeno.endsWith('a') ? 'a' : ''} do domácnosti víc, než na ${
                  r.osoba.jmeno.endsWith('a') ? 'ni' : 'něj'
                } za období připadlo. <b>${formatKc(
                  -r.rozdil,
                )}</b> se zapíše jako pohledávka — jsou to reálné peníze a nemají zmizet.`
              : `Od téhle osoby příspěvky na účet nechodí, takže se u ní <b>dluh nesleduje</b>
                 — skládá se jinak a narůstající číslo by nic neznamenalo. Řádek je tu proto,
                 aby bylo vidět, co na ${
                   r.osoba.jmeno.endsWith('a') ? 'ni' : 'něj'
                 } za období připadlo.`
          }
        </p></div>`;

    return `<section class="osoba-blok" data-osoba="${r.osoba.id}">
      <div class="hlava">
        <b>${esc(r.osoba.jmeno)}${
          r.zastupuje.length ? ` <span class="note">(nese i ${esc(r.zastupuje.join(', '))})</span>` : ''
        }</b>${stav}
      </div>
      <div class="vypocet">
        <span>Předepsané zálohy za ${sklonujMesice(mesicu)}</span><span>${formatKc(r.predepsano)}</span>
        <span>Skutečně zaplaceno (i placené ze svého)</span><span>${formatKc(r.zaplaceno)}</span>
        <span>Skutečný podíl na nákladech</span><span>${formatKc(r.skutecne)}</span>
        <span class="vysledek">${r.rozdil >= 0 ? 'Nedoplatek' : 'Přeplatek'}</span><span class="vysledek">${formatKc(
          Math.abs(r.rozdil),
        )}</span>
      </div>
      ${volba}
    </section>`;
  };

  const sledovani = radky.filter((r) => r.sledovat);
  const ostatni = radky.filter((r) => !r.sledovat);

  const vyber =
    moznaObdobi.length === 0
      ? `<p class="vysvetleni varovani">
          Vyúčtovat zatím není co: od <b class="mono">${esc(podklad.od)}</b> není uzavřený ani jeden měsíc.
          Nejdřív je zavři na stránce <a href="/admin/uzaverky">Uzávěrky</a> — z otevřeného měsíce
          se počítá z dnešního nastavení a vyúčtované číslo by se pak mohlo zpětně změnit.
        </p>`
      : `<form class="obdobi" method="get" action="/admin/vyuctovani">
          <span>Vyúčtovat od <b class="mono">${esc(podklad.od)}</b> do</span>
          <select name="do" class="mono">
            ${moznaObdobi
              .map(
                (m) => `<option value="${esc(m)}"${m === podklad.do ? ' selected' : ''}>${esc(m)}</option>`,
              )
              .join('')}
          </select>
          <button class="btn" type="submit" title="Přepočítat podklad pro jiný konec období">Přepočítat</button>
          <span class="note">· uzavřených měsíců k dispozici: ${moznaObdobi.length}</span>
        </form>`;

  const historie =
    hotova.length === 0
      ? ''
      : `<h3 class="skupina">Hotová vyúčtování</h3>
        <div class="historie">
          ${hotova
            .map((v, i) => {
              // Co z vyúčtování opravdu vzešlo — ne holý rozdíl. Řádky, ze kterých
              // nic neplyne (u koho se dluh nesleduje), se sem netahají.
              const souhrn = v.radky
                .map((r) => {
                  const jmeno = esc(jmena.get(r.member_id) ?? '#' + r.member_id);
                  if (r.zustatek > 0) return `${jmeno} doplatí ${formatKc(r.zustatek)}`;
                  if (r.zustatek < 0) return `${jmeno} má k dobru ${formatKc(-r.zustatek)}`;
                  if (r.nova_zaloha > 0) return `${jmeno} záloha ${formatKc(r.nova_zaloha)}`;
                  return null;
                })
                .filter((t) => t !== null)
                .join(' · ');
              return `<div class="radek">
                <b class="mono">${esc(v.obdobi_od)} – ${esc(v.obdobi_do)}</b>
                <span class="note">${esc(v.vytvoreno_at)}${v.vytvoril ? ' · ' + esc(v.vytvoril) : ''}</span>
                <span>${souhrn || 'beze zbytku'}</span>
                <span class="spacer"></span>
                ${
                  i === 0
                    ? `<button class="btn" type="button" data-zrus="${esc(v.obdobi_do)}"
                         title="Zruší poslední vyúčtování a vrátí sledování na ${esc(v.obdobi_od)}">Zrušit poslední</button>`
                    : ''
                }
              </div>`;
            })
            .join('')}
        </div>
        <p class="vysvetleni note">
          Zrušit jde jen poslední vyúčtování — starší by se nedalo vrátit, aniž by se novější
          počítalo dvakrát. Zálohy, které vyúčtování stanovilo, přitom zůstávají v platnosti;
          mění se na stránce <a href="/admin/vyrovnani">Příspěvky a vyrovnání</a>.
        </p>`;

  const obsah = `${STYL}
  <div>
    <div class="panehead"><svg class="icon icon-sm"><use href="#i-doc"/></svg>Vyúčtování období</div>
    <div class="telo">
      <p class="vysvetleni">
        Záloha je schválně <b>fixní</b>, aby trvalý příkaz nemusel nikdo měnit každý měsíc.
        Skutečné náklady ale kolísají, takže se rozdíl někde nasčítá. Vyúčtování ho jednou
        za období srovná a <b>rozpustí do nové zálohy</b> — stejně jako u energií.
      </p>
      <p class="vysvetleni">
        Vyúčtovat jde jen <b>uzavřené</b> měsíce. Co se jednou vyúčtuje, se v dalším období
        už nepočítá: počátek sledování se posune za konec období a další dluh se sčítá od nuly.
      </p>
      ${vyber}
      ${
        moznaObdobi.length === 0
          ? ''
          : `${sledovani.map(blok).join('')}
             ${
               ostatni.length
                 ? `<h3 class="skupina">Ostatní členové — bez zálohy</h3>${ostatni.map(blok).join('')}`
                 : ''
             }
             <div class="akce">
               <button class="btn primary" type="button" id="ulozit"
                       title="Zamrazí čísla za období, stanoví nové zálohy a posune sledování na ${esc(podklad.dalsi)}">
                 Vyúčtovat období ${esc(podklad.od)} – ${esc(podklad.do)}
               </button>
               <span class="note" id="stav"></span>
             </div>`
      }
      ${historie}
    </div>
  </div>`;

  const skript = `<script>
const stav = document.getElementById('stav');

// Návrh zálohy se mění podle toho, jestli se rozdíl rozpouští, nebo ne.
// Přepisuje se jen dokud do pole člověk sám nesáhne.
document.querySelectorAll('[data-zpusob]').forEach((prepinac) => {
  prepinac.addEventListener('change', () => {
    const pole = document.querySelector('[data-zaloha="' + prepinac.dataset.zpusob + '"]');
    if (!pole || pole.dataset.rucne === '1') return;
    pole.value = prepinac.value === 'do_zalohy' ? pole.dataset.srozdilem : pole.dataset.zaklad;
  });
});
document.querySelectorAll('[data-zaloha]').forEach((pole) => {
  pole.addEventListener('input', () => { pole.dataset.rucne = '1'; });
});

const ulozit = document.getElementById('ulozit');
if (ulozit) ulozit.addEventListener('click', async () => {
  const rozhodnuti = [...document.querySelectorAll('[data-zaloha]')].map((pole) => ({
    member_id: Number(pole.dataset.zaloha),
    zpusob: (document.querySelector('[data-zpusob="' + pole.dataset.zaloha + '"]:checked') || {}).value || 'do_zalohy',
    nova_zaloha: pole.value.trim(),
  }));
  stav.textContent = 'ukládám…';
  const odpoved = await fetch('/api/vyuctovani', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ do: ${JSON.stringify(podklad.do)}, rozhodnuti }),
  });
  const data = await odpoved.json().catch(() => ({}));
  if (odpoved.ok) location.href = '/admin/vyrovnani'; else stav.textContent = data.chyba || 'Nepovedlo se uložit.';
});

document.querySelectorAll('[data-zrus]').forEach((tlacitko) => {
  tlacitko.addEventListener('click', async () => {
    if (!confirm('Zrušit vyúčtování do ' + tlacitko.dataset.zrus + '? Sledování se vrátí na začátek období, zálohy z něj zůstanou.')) return;
    const odpoved = await fetch('/api/vyuctovani/zrusit', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ do: tlacitko.dataset.zrus }),
    });
    const data = await odpoved.json().catch(() => ({}));
    if (odpoved.ok) location.reload(); else alert(data.chyba || 'Nepovedlo se zrušit.');
  });
});
</script>`;

  const nedoplatky = sledovani.reduce((a, r) => a + Math.max(0, r.rozdil), 0);
  const preplatky = sledovani.reduce((a, r) => a + Math.max(0, -r.rozdil), 0);

  return shell({
    aktivni: 'vyuctovani',
    nazevDomu,
    titulek: 'Vyúčtování',
    commit,
    obsah,
    status: `<span>období <b class="mono">${esc(podklad.od)} – ${esc(podklad.do)}</b></span><span>měsíců <b>${mesicu}</b></span><span>nedoplatky <b>${formatKc(
      nedoplatky,
    )}</b></span><span>přeplatky <b>${formatKc(preplatky)}</b></span><span class="spacer"></span><span>přihlášen: ${esc(
      kdo,
    )}</span>`,
    skript,
  });
}
