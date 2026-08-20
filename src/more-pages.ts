/**
 * Zbylé stránky správy: Přehled, Osoby, Příspěvky a vyrovnání,
 * Log synchronizace a O aplikaci.
 */
import { spocitej } from './admin-page.js';
import { zalohaVMesici, type Beh, type Nastaveni, type Uzaverka, type Zaloha } from './db.js';
import { formatKc, formatKcZnamenko, mesicNyni, nahoruNaStovky, posunMesic } from './money.js';
import type { Osoba, Prehled } from './model.js';
import { esc, shell } from './ui.js';

/* ---------- společné výpočty ---------- */

export interface RadekVyrovnani {
  osoba: Osoba;
  /** měsíční podíl včetně těch, které osoba zastupuje (nezletilé dítě) */
  mesicne: number;
  jednorazove: number;
  /** aktuální záloha na trvalý příkaz */
  zaloha: number;
  /** navržená záloha podle nákladů a rezervy */
  navrh: number;
  /** součet záloh za měsíce po splatnosti */
  predepsano: number;
  /** skutečný podíl na nákladech za tytéž měsíce */
  skutecne: number;
  zaplaceno: number;
  /** kladné = zbývá doplatit, záporné = přeplatek */
  rozdil: number;
  zastupuje: string[];
  /**
   * Sleduje se u téhle osoby, kolik zaplatila?
   *
   * Do rozdělení nákladů se počítají všichni — od toho je vidět, co dům stojí
   * a na koho co padá. Ale příspěvky chodí na účet jen od někoho; u ostatních
   * by dluh jen narůstal a nic by neznamenal, protože se skládají jinak.
   */
  sledovat: boolean;
}

/**
 * Kolik měsíčních příspěvků je **už po splatnosti**.
 *
 * Měsíc se započítá až dnem splatnosti (default 20.). Do té doby ještě není
 * co dlužit — jinak by appka hlásila dluh hned prvního, což by nebyla pravda.
 * Když je počátek sledování v budoucnu, vyjde nula.
 */
export function pocetMesicu(odMesice: string, denSplatnosti = 20, ted = new Date()): number {
  const shoda = odMesice.match(/^(\d{4})-(\d{2})$/);
  if (!shoda?.[1] || !shoda[2]) return 0;
  const celeMesice =
    (ted.getFullYear() - Number(shoda[1])) * 12 + (ted.getMonth() + 1 - Number(shoda[2]));
  const tentoMesicSplatny = ted.getDate() >= denSplatnosti ? 1 : 0;
  return Math.max(0, celeMesice + tentoMesicSplatny);
}

/** Nejbližší den splatnosti od dneška — co se ukazuje jako „další úhrada". */
export function dalsiSplatnost(denSplatnosti: number, ted = new Date()): Date {
  const letos = new Date(ted.getFullYear(), ted.getMonth(), denSplatnosti);
  if (letos >= new Date(ted.getFullYear(), ted.getMonth(), ted.getDate())) return letos;
  return new Date(ted.getFullYear(), ted.getMonth() + 1, denSplatnosti);
}

const datumCesky = (d: Date): string => d.toLocaleDateString('cs-CZ');

export function vyrovnani(
  prehled: Prehled,
  zaplaceno: Map<number, number>,
  zalohy: Zaloha[],
  nastaveni: Nastaveni,
  uzaverky: Map<string, Uzaverka> = new Map(),
  ted = new Date(),
): { radky: RadekVyrovnani[]; mesicu: number; otevrenych: number } {
  const odMesice = nastaveni.vyuctovani_od;
  const mesicu = pocetMesicu(odMesice, nastaveni.den_splatnosti, ted);
  const tentoMesic = mesicNyni(ted);

  const sectiSDetmi = (o: Osoba, mapa: Map<number, number>): number => {
    let soucet = mapa.get(o.id) ?? 0;
    for (const d of prehled.osoby) if ((d.pod_member_id ?? null) === o.id) soucet += mapa.get(d.id) ?? 0;
    return soucet;
  };

  // Skutečné náklady se sčítají měsíc po měsíci, ne průměrem — rozpouštěné
  // položky v některých měsících běží a v jiných ne, takže průměr by lhal.
  //
  // Uzavřený měsíc se bere ze zamražených čísel. Přepočítávat ho z dnešního
  // nastavení by znamenalo tvrdit, že tehdy platilo, co platí teď.
  const skutecneZaOsobu = new Map<number, number>();
  const predepsanoZaOsobu = new Map<number, number>();
  let otevrenych = 0;
  for (let i = 0; i < mesicu; i++) {
    const mesic = posunMesic(odMesice, i);
    const uzaverka = uzaverky.get(mesic);
    if (uzaverka === undefined) otevrenych++;
    const souhrn = uzaverka === undefined ? spocitej(prehled, mesic) : null;

    for (const o of prehled.osoby) {
      const zamrazene = uzaverka?.podily.get(o.id);
      const podil =
        zamrazene?.podil ??
        (souhrn === null ? 0 : sectiSDetmi(o, souhrn.mesicneOsoba) + sectiSDetmi(o, souhrn.saldoOsoba));
      const zaloha = zamrazene?.zaloha ?? zalohaVMesici(zalohy, o.id, mesic);
      skutecneZaOsobu.set(o.id, (skutecneZaOsobu.get(o.id) ?? 0) + podil);
      predepsanoZaOsobu.set(o.id, (predepsanoZaOsobu.get(o.id) ?? 0) + zaloha);
    }
  }

  // Návrh zálohy: co na osobu vyjde za příštích 12 měsíců, plus rezerva
  // na neplánované nákupy, zaokrouhleno nahoru na stovky.
  const odhadRoku = new Map<number, number>();
  for (let i = 0; i < 12; i++) {
    const souhrn = spocitej(prehled, posunMesic(tentoMesic, i));
    for (const o of prehled.osoby) {
      odhadRoku.set(o.id, (odhadRoku.get(o.id) ?? 0) + sectiSDetmi(o, souhrn.mesicneOsoba));
    }
  }

  const tedSouhrn = spocitej(prehled, tentoMesic);

  const radky = prehled.osoby
    .filter((o) => (o.pod_member_id ?? null) === null)
    .map((osoba): RadekVyrovnani => {
      const mesicne = sectiSDetmi(osoba, tedSouhrn.mesicneOsoba);
      const jednorazove = sectiSDetmi(osoba, tedSouhrn.saldoOsoba);
      const zaloha = zalohaVMesici(zalohy, osoba.id, tentoMesic);
      const predepsano = predepsanoZaOsobu.get(osoba.id) ?? 0;
      const uhrazeno = zaplaceno.get(osoba.id) ?? 0;
      const rocni = odhadRoku.get(osoba.id) ?? 0;

      return {
        osoba,
        mesicne,
        jednorazove,
        zaloha,
        navrh: nahoruNaStovky(Math.round((rocni / 12) * (1 + nastaveni.rezerva_procent / 100))),
        predepsano,
        zaplaceno: uhrazeno,
        rozdil: predepsano - uhrazeno,
        skutecne: skutecneZaOsobu.get(osoba.id) ?? 0,
        sledovat: Boolean(osoba.je_platce),
        zastupuje: prehled.osoby
          .filter((d) => (d.pod_member_id ?? null) === osoba.id)
          .map((d) => d.jmeno),
      };
    });

  return { radky, mesicu, otevrenych };
}

/* ---------- Přehled ---------- */

const STYL_PREHLED = `
<style>
.main { display: block; overflow-y: auto; }
.dlazdice { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 1px; background: var(--border); border-bottom: 1px solid var(--border); }
.dlazdice > div { background: var(--pane); padding: 11px 13px; display: flex; flex-direction: column; gap: 3px; }
.dlazdice .popis { color: var(--text-dim); font-size: 11.5px; }
.dlazdice .cislo { font-family: var(--mono); font-size: 21px; font-variant-numeric: tabular-nums; }
.dlazdice .pod { color: var(--text-faint); font-size: 11.5px; }
.cislo.warn { color: var(--warn); }
.cislo.ok { color: var(--ok); }
.blok { border-bottom: 1px solid var(--border); }
.odkazy { display: flex; gap: 8px; flex-wrap: wrap; padding: 10px 12px; }
.odkazy a { text-decoration: none; }
</style>`;

export function renderPrehled(
  prehled: Prehled,
  zaplaceno: Map<number, number>,
  zalohy: Zaloha[],
  nastaveni: Nastaveni,
  uzaverky: Map<string, Uzaverka>,
  beh: Beh | null,
  nepriraze: number,
  kdo: string,
  commit: string,
): string {
  const s = spocitej(prehled);
  const { radky, mesicu } = vyrovnani(prehled, zaplaceno, zalohy, nastaveni, uzaverky);
  const odMesice = nastaveni.vyuctovani_od;
  // Dluh se sčítá jen u těch, od koho příspěvky na účet opravdu chodí.
  const dluzi = radky.filter((r) => r.sledovat).reduce((a, r) => a + Math.max(0, r.rozdil), 0);

  const radkyOsob = radky
    .map(
      (r) => `<tr>
    <td data-popis="Osoba">${esc(r.osoba.jmeno)}${
      r.zastupuje.length ? ` <span class="note">(s ${esc(r.zastupuje.join(', '))})</span>` : ''
    }</td>
    <td class="col-num" data-popis="Měsíčně">${formatKc(r.mesicne)}</td>
    ${
      r.sledovat
        ? `<td class="col-num" data-popis="Předepsáno">${formatKc(r.predepsano)}</td>
    <td class="col-num" data-popis="Zaplaceno">${formatKc(r.zaplaceno)}</td>
    <td class="col-num ${r.rozdil > 0 ? 's-warn' : r.rozdil < 0 ? 'minus' : ''}" data-popis="Rozdíl">${
      r.rozdil === 0 ? 'vyrovnáno' : formatKcZnamenko(r.rozdil)
    }</td>`
        : `<td colspan="3" class="note" data-popis="Příspěvky">nesleduje se — na účet neposílá</td>`
    }
  </tr>`,
    )
    .join('');

  const obsah = `${STYL_PREHLED}
  <div>
    <div class="panehead"><svg class="icon icon-sm"><use href="#i-grid"/></svg>Přehled — ${esc(prehled.nazev_domu)}</div>
    <div class="dlazdice">
      <div><span class="popis">Náklady domu měsíčně</span><span class="cislo">${formatKc(s.mesicneCelkem)}</span><span class="pod">ročně ${formatKc(s.rocneCelkem)}</span></div>
      <div><span class="popis">Zbývá doplatit</span><span class="cislo${dluzi > 0 ? ' warn' : ' ok'}">${formatKc(dluzi)}</span><span class="pod">za ${mesicu} ${mesicu === 1 ? 'měsíc' : mesicu < 5 ? 'měsíce' : 'měsíců'} od ${esc(odMesice)}</span></div>
      <div><span class="popis">Jednorázové saldo</span><span class="cislo">${formatKcZnamenko(s.saldoCelkem)}</span><span class="pod">nedoplatky minus přeplatky</span></div>
      <div><span class="popis">Položek</span><span class="cislo">${prehled.polozky.length}</span><span class="pod">${
        s.nedokoncenych > 0 ? `${s.nedokoncenych} nedokončených` : 'všechny rozdělené'
      }</span></div>
      <div><span class="popis">Platby bez přiřazení</span><span class="cislo${nepriraze > 0 ? ' warn' : ''}">${nepriraze}</span><span class="pod">${
        nepriraze > 0 ? 'čekají na ruční přiřazení' : 'všechno přiřazené'
      }</span></div>
      <div><span class="popis">Poslední stažení z banky</span><span class="cislo" style="font-size:13px">${
        beh === null ? 'zatím nikdy' : esc(beh.zacatek)
      }</span><span class="pod">${beh === null ? 'chybí token nebo se ještě nespouštělo' : esc(beh.stav)}</span></div>
    </div>

    <section class="blok">
      <div class="panehead"><svg class="icon icon-sm"><use href="#i-users"/></svg>Kdo kolik</div>
      <div class="gridwrap">
        <table>
          <thead><tr><th>Osoba</th><th class="col-num">Měsíčně</th><th class="col-num">Předepsáno</th><th class="col-num">Zaplaceno</th><th class="col-num">Rozdíl</th></tr></thead>
          <tbody>${radkyOsob}</tbody>
        </table>
      </div>
    </section>

    <div class="odkazy">
      <a class="btn" href="/admin">Náklady domu</a>
      <a class="btn" href="/admin/uhrady">Úhrady z Fio</a>
      <a class="btn" href="/admin/vyrovnani">Příspěvky a vyrovnání</a>
    </div>
  </div>`;

  return shell({
    aktivni: 'prehled',
    nazevDomu: prehled.nazev_domu,
    titulek: 'Přehled',
    commit,
    obsah,
    status: `<span>osob <b>${radky.length}</b></span><span>položek <b>${prehled.polozky.length}</b></span><span class="spacer"></span><span>přihlášen: ${esc(kdo)}</span>`,
  });
}

/* ---------- Osoby ---------- */

const STYL_OSOBY = `
<style>
.main { display: block; overflow-y: auto; }
.telo { padding: 11px 12px 16px; display: flex; flex-direction: column; gap: 10px; max-width: 820px; }
.vysvetleni { color: var(--text-dim); margin: 0; max-width: 74ch; }
.hlavicky, .radek { display: grid; grid-template-columns: 150px minmax(0, 1fr) 84px 84px; gap: 10px; align-items: center; }
.hlavicky { font-size: 10.5px; letter-spacing: .55px; text-transform: uppercase; color: var(--text-faint); border-bottom: 1px solid var(--border-soft); padding-bottom: 3px; }
.radek input[type="text"], .radek input[type="email"] { width: 100%; }
.volba { display: flex; align-items: center; gap: 6px; color: var(--text-dim); }
.nova { border-top: 1px solid var(--border-soft); padding-top: 10px; }
@media (max-width: 620px) {
  .hlavicky { display: none; }
  .radek { grid-template-columns: 1fr 1fr; padding: 8px 0; border-bottom: 1px solid var(--border-soft); }
  .radek input[type="text"], .radek input[type="email"] { grid-column: 1 / -1; }
}
</style>`;

export function renderOsoby(osoby: Osoba[], nazevDomu: string, kdo: string, commit: string): string {
  const radky = osoby
    .map(
      (o) => `<div class="radek" data-osoba="${o.id}">
      <input type="text" data-jmeno="${o.id}" value="${esc(o.jmeno)}" maxlength="60" aria-label="Jméno" />
      <input type="email" data-email="${o.id}" value="${esc(o.email ?? '')}" placeholder="e-mail pro vyúčtování" aria-label="E-mail" />
      <label class="volba"><input type="checkbox" data-admin="${o.id}"${o.je_admin ? ' checked' : ''} /> admin</label>
      <label class="volba"><input type="checkbox" data-aktivni="${o.id}"${o.aktivni === 0 ? '' : ' checked'} /> evidovat</label>
    </div>`,
    )
    .join('');

  const obsah = `${STYL_OSOBY}
  <div>
    <div class="panehead"><svg class="icon icon-sm"><use href="#i-users"/></svg>Osoby<span class="count">${osoby.length}</span></div>
    <div class="telo">
      <p class="vysvetleni">
        Osoby, mezi které se dělí náklady. <b>E-mail</b> slouží k rozeslání vyúčtování,
        <b>admin</b> dostane souhrn za celou domácnost a smí do správy.
      </p>
      <p class="vysvetleni">
        <b>Evidovat</b> říká, jestli se s osobou dál počítá. Odškrtnutá osoba se přestane
        nabízet při rozdělování nákladů a zmizí z přehledů, ale <b>zůstane v historii</b> —
        smazat člověka, na kterého se váže minulé vyúčtování, by rozbilo záznamy o tom,
        kdo co kdy platil. Proto se lidé nemažou, jen přestanou evidovat.
      </p>
      <p class="vysvetleni note">
        Variabilní symboly a to, kdo za koho platí, se nastavuje v <a href="/admin/nastaveni">Nastavení</a>.
      </p>

      <div class="hlavicky"><span>Jméno</span><span>E-mail</span><span>Role</span><span>Evidovat</span></div>
      ${radky}

      <div class="nova">
        <div class="radek">
          <input type="text" id="nova-jmeno" placeholder="nová osoba" maxlength="60" aria-label="Jméno nové osoby" />
          <input type="email" id="nova-email" placeholder="e-mail (nepovinné)" aria-label="E-mail nové osoby" />
          <label class="volba"><input type="checkbox" id="nova-admin" /> admin</label>
          <button class="btn" type="button" id="pridat">Přidat</button>
        </div>
      </div>

      <div><button class="btn primary" type="button" id="ulozit">Uložit změny</button>
        <span class="note" id="stav"></span></div>
    </div>
  </div>`;

  const skript = `<script>
const el = (id) => document.getElementById(id);
async function posli(telo) {
  const odpoved = await fetch('/api/osoba', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(telo),
  });
  const data = await odpoved.json().catch(() => ({}));
  return { ok: odpoved.ok, chyba: data.chyba || '' };
}

el('ulozit').addEventListener('click', async () => {
  el('stav').textContent = 'ukládám…';
  for (const r of document.querySelectorAll('.radek[data-osoba]')) {
    const id = Number(r.dataset.osoba);
    const v = await posli({
      id: id,
      jmeno: r.querySelector('[data-jmeno="' + id + '"]').value,
      email: r.querySelector('[data-email="' + id + '"]').value,
      je_admin: r.querySelector('[data-admin="' + id + '"]').checked,
      aktivni: r.querySelector('[data-aktivni="' + id + '"]').checked,
    });
    if (!v.ok) { el('stav').textContent = v.chyba; return; }
  }
  location.reload();
});

el('pridat').addEventListener('click', async () => {
  const jmeno = el('nova-jmeno').value.trim();
  if (jmeno === '') { el('stav').textContent = 'Vyplň jméno nové osoby.'; return; }
  const v = await posli({ id: null, jmeno: jmeno, email: el('nova-email').value, je_admin: el('nova-admin').checked, aktivni: true });
  if (v.ok) location.reload(); else el('stav').textContent = v.chyba;
});
</script>`;

  return shell({
    aktivni: 'osoby',
    nazevDomu,
    titulek: 'Osoby',
    commit,
    obsah,
    status: `<span>osob <b>${osoby.length}</b></span><span>s e-mailem <b>${osoby.filter((o) => o.email).length}</b></span><span class="spacer"></span><span>přihlášen: ${esc(kdo)}</span>`,
    skript,
  });
}

/* ---------- Příspěvky a vyrovnání ---------- */

const STYL_VYROVNANI = `
<style>
.main { display: block; overflow-y: auto; }
.telo { padding: 11px 12px 16px; display: flex; flex-direction: column; gap: 12px; max-width: 940px; }
.vysvetleni { color: var(--text-dim); margin: 0; max-width: 76ch; }
.osoba-blok { border: 1px solid var(--border); border-radius: 2px; }
.osoba-blok .hlava { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 7px 11px; background: var(--chrome-hi); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.osoba-blok .hlava b { font-size: 13.5px; }
.osoba-blok .vypocet { padding: 9px 11px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px 12px; font-variant-numeric: tabular-nums; }
.osoba-blok .vypocet span:nth-child(even) { font-family: var(--mono); text-align: right; }
.osoba-blok .vysledek { border-top: 1px solid var(--border-soft); margin-top: 5px; padding-top: 5px; font-weight: 600; }
.osoba-blok .oddil { margin-top: 9px; padding-top: 7px; border-top: 1px solid var(--border-soft); font-size: 10.5px; letter-spacing: .5px; text-transform: uppercase; color: var(--text-faint); grid-column: 1 / -1; }
.zaloha-radek { display: flex; align-items: center; gap: 8px; padding: 8px 11px; border-top: 1px solid var(--border-soft); flex-wrap: wrap; }
.zaloha-radek input { width: 100px; }
.zbyva { color: var(--warn); }
.preplatek { color: var(--ok); }
.skupina { margin: 6px 0 0; font-size: 11px; letter-spacing: .5px; text-transform: uppercase; color: var(--text-faint); font-weight: 600; }
.obdobi { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; color: var(--text-dim); }
.obdobi .btn { text-decoration: none; }
@media (max-width: 560px) { .telo { padding: 10px 9px 14px; } }
</style>`;

export function renderVyrovnani(
  prehled: Prehled,
  zaplaceno: Map<number, number>,
  zalohy: Zaloha[],
  nastaveni: Nastaveni,
  uzaverky: Map<string, Uzaverka>,
  kdo: string,
  commit: string,
): string {
  const { radky, mesicu, otevrenych } = vyrovnani(prehled, zaplaceno, zalohy, nastaveni, uzaverky);
  const odMesice = nastaveni.vyuctovani_od;

  const blok = (r: RadekVyrovnani): string => {
    const stav = !r.sledovat
      ? '<span class="note">příspěvky se nesledují</span>'
      : r.rozdil > 0
        ? `<span class="zbyva">zbývá doplatit ${formatKc(r.rozdil)}</span>`
        : r.rozdil < 0
          ? `<span class="preplatek">předplaceno ${formatKc(-r.rozdil)}</span>`
          : '<span>vyrovnáno</span>';

    // U koho příspěvky nechodí přes účet, se ukáže jen jeho podíl na nákladech.
    // Dopočítávat mu dluh by vyrobilo číslo, které nic neznamená.
    if (!r.sledovat) {
      return `<section class="osoba-blok">
      <div class="hlava"><b>${esc(r.osoba.jmeno)}${
        r.zastupuje.length ? ` <span class="note">(nese i ${esc(r.zastupuje.join(', '))})</span>` : ''
      }</b>${stav}</div>
      <div class="vypocet">
        <span>Měsíční podíl na nákladech</span><span>${formatKc(r.mesicne)}</span>
        <span>Ročně</span><span>${formatKc(r.mesicne * 12)}</span>
        ${r.zaplaceno !== 0 ? `<span>Zaplatil${r.osoba.jmeno.endsWith('a') ? 'a' : ''} ze svého</span><span>${formatKc(r.zaplaceno)}</span>` : ''}
      </div>
    </section>`;
    }

    return `<section class="osoba-blok">
      <div class="hlava">
        <b>${esc(r.osoba.jmeno)}${r.zastupuje.length ? ` <span class="note">(nese i ${esc(r.zastupuje.join(', '))})</span>` : ''}</b>
        ${stav}
      </div>
      <div class="vypocet">
        <span>Záloha na trvalý příkaz</span><span>${r.zaloha === 0 ? 'nestanovena' : formatKc(r.zaloha) + ' / měs'}</span>
        <span>Předepsáno za ${mesicu} ${mesicu === 1 ? 'měsíc' : mesicu >= 2 && mesicu <= 4 ? 'měsíce' : 'měsíců'}</span><span>${formatKc(r.predepsano)}</span>
        <span>Přišlo na účet (i placené ze svého)</span><span>${formatKc(r.zaplaceno)}</span>
        <span class="vysledek">${r.rozdil >= 0 ? 'Zbývá doplatit' : 'Předplaceno'}</span><span class="vysledek">${formatKc(Math.abs(r.rozdil))}</span>

        <span class="oddil">Jak to vychází proti skutečným nákladům</span>
        <span>Skutečný podíl za ${mesicu} ${mesicu === 1 ? 'měsíc' : mesicu >= 2 && mesicu <= 4 ? 'měsíce' : 'měsíců'}</span><span>${formatKc(r.skutecne)}</span>
        <span>Rozdíl proti zaplacenému</span><span>${formatKcZnamenko(r.zaplaceno - r.skutecne)}</span>
        <span class="note">${
          r.zaplaceno - r.skutecne >= 0
            ? 'přeplatek se vrátí ve vyúčtování — sníží příští zálohu'
            : 'nedoplatek se ve vyúčtování rozpustí do příští zálohy'
        }</span><span></span>
      </div>
      <div class="zaloha-radek">
        <span class="note">Návrh zálohy podle nákladů (+ ${nastaveni.rezerva_procent} % rezerva):</span>
        <b class="mono">${formatKc(r.navrh)}</b>
        <input type="text" class="mono" data-castka="${r.osoba.id}" value="${(r.navrh / 100).toFixed(0)}" aria-label="Záloha ${esc(r.osoba.jmeno)}" />
        <span class="note">Kč / měs od</span>
        <input type="text" class="mono" data-od="${r.osoba.id}" value="${esc(mesicNyni())}" style="width:88px" aria-label="Platnost od" />
        <button class="btn" type="button" data-uloz="${r.osoba.id}">Stanovit zálohu</button>
        <span class="note" data-stav="${r.osoba.id}"></span>
      </div>
    </section>`;
  };

  const sledovani = radky.filter((r) => r.sledovat);
  const ostatni = radky.filter((r) => !r.sledovat);

  const bloky =
    sledovani.map(blok).join('') +
    (ostatni.length
      ? `<h3 class="skupina">Ostatní členové — jen podíl na nákladech</h3>` + ostatni.map(blok).join('')
      : '');

  const obsah = `${STYL_VYROVNANI}
  <div>
    <div class="panehead"><svg class="icon icon-sm"><use href="#i-doc"/></svg>Příspěvky a vyrovnání</div>
    <div class="telo">
      <p class="vysvetleni">
        Příspěvek se platí <b>fixní zálohou</b> na trvalý příkaz — každý měsíc stejná částka.
        Dluh se počítá ze zálohy, ne z kolísajících nákladů: co má kdo poslat, se během období nemění.
        Skutečné náklady se sčítají vedle a srovnají se s nimi až při vyúčtování.
      </p>
      <p class="vysvetleni">
        Do rozdělení nákladů se počítají <b>všichni evidovaní</b>, ale zálohu a dluh sleduje appka
        jen u toho, od koho příspěvky chodí na účet — nastavuje se to v
        <a href="/admin/nastaveni">Nastavení</a>.
      </p>
      <div class="obdobi">
        <span>Sledováno od <b class="mono">${esc(odMesice)}</b></span>
        <span>· splatnost <b>${nastaveni.den_splatnosti}.</b> dne</span>
        <span>· příští úhrada <b>${datumCesky(dalsiSplatnost(nastaveni.den_splatnosti))}</b></span>
        <span>· po splatnosti <b>${mesicu}</b></span>
        <a class="btn" href="/admin/nastaveni">Změnit v Nastavení</a>
      </div>
      ${bloky || '<p class="vysvetleni">Zatím tu není nikdo, komu by se dal spočítat podíl.</p>'}
    </div>
  </div>`;

  const skript = `<script>
document.querySelectorAll('[data-uloz]').forEach((tlacitko) => {
  tlacitko.addEventListener('click', async () => {
    const id = tlacitko.dataset.uloz;
    const stav = document.querySelector('[data-stav="' + id + '"]');
    stav.textContent = 'ukládám…';
    const odpoved = await fetch('/api/zaloha', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        member_id: Number(id),
        castka: document.querySelector('[data-castka="' + id + '"]').value.trim(),
        plati_od: document.querySelector('[data-od="' + id + '"]').value.trim(),
      }),
    });
    const data = await odpoved.json().catch(() => ({}));
    if (odpoved.ok) location.reload(); else stav.textContent = data.chyba || 'Nepovedlo se uložit.';
  });
});
</script>`;

  const celkem = sledovani.reduce((a, r) => a + Math.max(0, r.rozdil), 0);

  return shell({
    aktivni: 'vyrovnani',
    nazevDomu: prehled.nazev_domu,
    titulek: 'Příspěvky a vyrovnání',
    commit,
    obsah,
    status: `<span>od <b>${esc(odMesice)}</b></span><span>měsíců <b>${mesicu}</b></span><span>zbývá doplatit <b>${formatKc(celkem)}</b></span><span>sledováno <b>${sledovani.length}</b> z ${radky.length}</span>${otevrenych > 0 ? `<span class="warn">neuzavřeno <b>${otevrenych}</b> měs.</span>` : ""}<span class="spacer"></span><span>přihlášen: ${esc(kdo)}</span>`,
    skript,
  });
}

/* ---------- Log synchronizace ---------- */

export function renderLog(behy: Beh[], nazevDomu: string, kdo: string, commit: string): string {
  const radky =
    behy.length === 0
      ? '<tr><td colspan="4" class="note">Zatím žádný běh. Stahování se spouští z Úhrad z Fio nebo automaticky každých 15 minut.</td></tr>'
      : behy
          .map(
            (b) => `<tr>
      <td class="mono" data-popis="Začátek">${esc(b.zacatek)}</td>
      <td data-popis="Stav"><span class="${
        b.stav === 'chyba' ? 's-crit' : b.stav === 'ok' ? 's-ok' : ''
      }"><span class="dot"></span>${esc(b.stav)}</span></td>
      <td class="col-num" data-popis="Nových">${b.novych}</td>
      <td data-popis="Podrobnost">${esc(b.detail ?? '')}</td>
    </tr>`,
          )
          .join('');

  const obsah = `<style>.main { display: block; overflow-y: auto; } td.mono { width: 150px; }</style>
  <div>
    <div class="panehead"><svg class="icon icon-sm"><use href="#i-log"/></svg>Log synchronizace<span class="count">${behy.length} běhů</span></div>
    <div class="gridwrap">
      <table>
        <thead><tr><th>Začátek</th><th>Stav</th><th class="col-num">Nových</th><th>Podrobnost</th></tr></thead>
        <tbody>${radky}</tbody>
      </table>
    </div>
  </div>`;

  return shell({
    aktivni: 'log',
    nazevDomu,
    titulek: 'Log synchronizace',
    commit,
    obsah,
    status: `<span>běhů <b>${behy.length}</b></span><span>chybných <b>${behy.filter((b) => b.stav === 'chyba').length}</b></span><span class="spacer"></span><span>přihlášen: ${esc(kdo)}</span>`,
  });
}

/* ---------- O aplikaci ---------- */

export function renderOApp(
  nazevDomu: string,
  pocty: { osob: number; polozek: number; plateb: number; zmen: number },
  maToken: boolean,
  kdo: string,
  commit: string,
): string {
  const obsah = `<style>
.main { display: block; overflow-y: auto; }
.telo { padding: 12px; display: flex; flex-direction: column; gap: 12px; max-width: 76ch; }
.telo p, .telo ul { margin: 0; color: var(--text-dim); }
.telo ul { padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.telo b { color: var(--text); }
.fakta { display: grid; grid-template-columns: 190px 1fr; gap: 4px 12px; }
.fakta span:nth-child(odd) { color: var(--text-faint); }
</style>
  <div>
    <div class="panehead"><svg class="icon icon-sm"><use href="#i-info"/></svg>O aplikaci</div>
    <div class="telo">
      <p>
        <b>FIO-uhrady</b> počítá, co stojí provoz domu <b>${esc(nazevDomu)}</b>, rozděluje náklady
        mezi členy domácnosti a páruje příspěvky, které přijdou na účet u Fio banky.
      </p>
      <ul>
        <li><b>Náklady domu</b> — položky, jejich perioda a kdo se na které skládá.</li>
        <li><b>Úhrady z Fio</b> — co přišlo na účet a čím se poznalo, komu to patří.</li>
        <li><b>Příspěvky a vyrovnání</b> — kolik měl kdo zaplatit a kolik zaplatil.</li>
        <li><b>Osoby</b> a <b>Nastavení</b> — kdo se počítá, pod jakým VS a s jakým tokenem do banky.</li>
      </ul>
      <p>
        Platba se přiřadí podle variabilního symbolu. Když plátce VS nevyplní, hledá se číslo
        v komentáři, který k pohybu dopíšeš v internetbankingu Fio. Přiřazuje se jen číslo, které
        odpovídá některému evidovanému VS — jinak by se chytala náhodná čísla z poznámek.
      </p>
      <div class="fakta">
        <span>Verze</span><span class="mono">${esc(commit)}</span>
        <span>Databáze</span><span>${pocty.osob} osob · ${pocty.polozek} položek · ${pocty.plateb} plateb</span>
        <span>Záznamů o změnách</span><span>${pocty.zmen}</span>
        <span>Token do Fio</span><span>${maToken ? 'uložený' : 'chybí — vlož ho v Nastavení'}</span>
        <span>Stahování z banky</span><span>automaticky každých 15 minut</span>
        <span>Přihlášen</span><span>${esc(kdo)}</span>
      </div>
      <p class="note">
        Každá změna se ukládá se jménem a časem. U položky je historie vidět rovnou v detailu,
        souhrn posledních změn je v Nastavení.
      </p>
      <div><form method="post" action="/api/odhlaseni"><button class="btn" type="submit">Odhlásit se</button></form></div>
    </div>
  </div>`;

  return shell({
    aktivni: 'oapp',
    nazevDomu,
    titulek: 'O aplikaci',
    commit,
    obsah,
    status: `<span>verze <b>${esc(commit)}</b></span><span class="spacer"></span><span>přihlášen: ${esc(kdo)}</span>`,
  });
}

/**
 * Podíl osoby po měsících — pro graf na jejím přehledu.
 * Uzavřené měsíce ze zamražených čísel, otevřené z aktuálního nastavení.
 */
export function vyvojPodilu(
  prehled: Prehled,
  uzaverky: Map<string, Uzaverka>,
  nastaveni: Nastaveni,
  member_id: number,
  ted = new Date(),
): { mesic: string; castka: number; uzavreno: boolean }[] {
  const mesicu = Math.max(1, pocetMesicu(nastaveni.vyuctovani_od, nastaveni.den_splatnosti, ted));
  const deti = prehled.osoby.filter((d) => (d.pod_member_id ?? null) === member_id).map((d) => d.id);

  const body: { mesic: string; castka: number; uzavreno: boolean }[] = [];
  for (let i = 0; i < mesicu; i++) {
    const mesic = posunMesic(nastaveni.vyuctovani_od, i);
    const uzaverka = uzaverky.get(mesic);
    if (uzaverka) {
      body.push({ mesic, castka: uzaverka.podily.get(member_id)?.podil ?? 0, uzavreno: true });
      continue;
    }
    const souhrn = spocitej(prehled, mesic);
    const castka = [member_id, ...deti].reduce(
      (a, id) => a + (souhrn.mesicneOsoba.get(id) ?? 0) + (souhrn.saldoOsoba.get(id) ?? 0),
      0,
    );
    body.push({ mesic, castka, uzavreno: false });
  }
  return body;
}