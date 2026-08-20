/**
 * Stránka „Uzávěrky" — zamrazení toho, co v daném měsíci platilo.
 *
 * Náklady se v čase mění: internet zdraží, uhlí doběhne, rozdělení se upraví.
 * Dokud měsíc není uzavřený, počítá se z aktuálního nastavení — a zpětně by
 * tedy tvrdil, že tehdy platilo, co platí dnes. Uzávěrka to utne.
 */
import { spocitej } from './admin-page.js';
import { kdyZavreMesic } from './automat.js';
import type { Nastaveni, Uzaverka, Zaloha } from './db.js';
import { zalohaVMesici } from './db.js';
import { formatKc, mesicNyni, posunMesic } from './money.js';
import type { Osoba, Prehled } from './model.js';
import { esc, shell } from './ui.js';

const STYL = `
<style>
.main { display: block; overflow-y: auto; }
.telo { padding: 11px 12px 16px; display: flex; flex-direction: column; gap: 12px; max-width: 960px; }
.vysvetleni { color: var(--text-dim); margin: 0; max-width: 76ch; }
.mesic { border: 1px solid var(--border); border-radius: 2px; }
.mesic .hlava { display: flex; align-items: center; gap: 10px; padding: 7px 11px; background: var(--chrome-hi); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.mesic .hlava b { font-family: var(--mono); font-size: 13.5px; }
.mesic .hlava .spacer { flex: 1; }
.mesic .telo-mesice { padding: 8px 11px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 12px; font-variant-numeric: tabular-nums; }
.mesic .telo-mesice span:nth-child(even) { font-family: var(--mono); text-align: right; }
.stav-ok { color: var(--ok); }
.stav-otevreno { color: var(--warn); }
.automat { border: 1px solid var(--border); border-radius: 2px; padding: 9px 11px; display: flex; flex-direction: column; gap: 5px; background: var(--chrome-hi); max-width: 76ch; }
.automat label { display: flex; align-items: center; gap: 7px; cursor: pointer; }
@media (max-width: 560px) { .telo { padding: 10px 9px 14px; } }
</style>`;

export function renderUzaverky(
  prehled: Prehled,
  zalohy: Zaloha[],
  uzaverky: Map<string, Uzaverka>,
  nastaveni: Nastaveni,
  mesicu: number,
  kdo: string,
  commit: string,
): string {
  const jmeno = (id: number): string => prehled.osoby.find((o) => o.id === id)?.jmeno ?? '?';
  const nese = (o: Osoba): number[] =>
    prehled.osoby.filter((d) => (d.pod_member_id ?? null) === o.id).map((d) => d.id);

  // Nabízí se jen měsíce, které už jsou po splatnosti — budoucnost uzavírat nejde.
  const mesice: string[] = [];
  for (let i = mesicu - 1; i >= 0; i--) mesice.push(posunMesic(nastaveni.vyuctovani_od, i));
  const bezicMesic = mesicNyni();

  const bloky = mesice
    .map((mesic) => {
      const uzaverka = uzaverky.get(mesic);
      const souhrn = spocitej(prehled, mesic);

      const radky = prehled.osoby
        .filter((o) => (o.pod_member_id ?? null) === null)
        .map((o) => {
          const deti = nese(o);
          const zamrazene = uzaverka?.podily.get(o.id);
          const podil =
            zamrazene?.podil ??
            [o.id, ...deti].reduce(
              (a, id) => a + (souhrn.mesicneOsoba.get(id) ?? 0) + (souhrn.saldoOsoba.get(id) ?? 0),
              0,
            );
          const zaloha = zamrazene?.zaloha ?? zalohaVMesici(zalohy, o.id, mesic);
          return `<span>${esc(o.jmeno)}${deti.length ? ` <span class="note">(s ${esc(deti.map(jmeno).join(', '))})</span>` : ''}</span><span>${formatKc(podil)}${
            zaloha > 0 ? ` <span class="note">/ záloha ${formatKc(zaloha)}</span>` : ''
          }</span>`;
        })
        .join('');

      const naklady = uzaverka?.naklady_celkem ?? souhrn.mesicneCelkem + souhrn.saldoCelkem;

      return `<section class="mesic">
      <div class="hlava">
        <b>${esc(mesic)}</b>
        <span class="${uzaverka ? 'stav-ok' : 'stav-otevreno'}"><span class="dot"></span>${
          uzaverka ? `uzavřeno ${esc(uzaverka.uzavreno_at)}` : 'otevřeno — počítá se z aktuálního nastavení'
        }</span>
        <span class="spacer"></span>
        ${
          uzaverka
            ? `<button class="btn" type="button" data-zrus="${esc(mesic)}">Zrušit uzávěrku</button>`
            : `<button class="btn primary" type="button" data-uzavri="${esc(mesic)}">Uzavřít měsíc</button>`
        }
        <span class="note" data-stav="${esc(mesic)}"></span>
      </div>
      <div class="telo-mesice">
        <span><b>Náklady domu za měsíc</b></span><span><b>${formatKc(naklady)}</b></span>
        ${radky}
      </div>
    </section>`;
    })
    .join('');

  const uzavrenych = mesice.filter((m) => uzaverky.has(m)).length;

  const obsah = `${STYL}
  <div>
    <div class="panehead"><svg class="icon icon-sm"><use href="#i-lock"/></svg>Měsíční uzávěrky
      <span class="count">${uzavrenych} z ${mesice.length} uzavřeno</span>
    </div>
    <div class="telo">
      <p class="vysvetleni">
        Uzávěrka <b>zamrazí</b>, co v daném měsíci platilo — jaké byly náklady, kolik připadlo
        na koho a jaká platila záloha. Vyrovnání pak ten měsíc počítá ze zamražených čísel.
      </p>
      <p class="vysvetleni">
        Dokud je měsíc otevřený, počítá se z <b>aktuálního</b> nastavení. Když se pak náklad změní
        nebo doběhne rozpouštěné uhlí, zpětný pohled by tvrdil, že tehdy platilo dnešní číslo.
        Proto se měsíce po splatnosti uzavírají.
      </p>
      <div class="automat">
        <label>
          <input type="checkbox" id="auto-uzaverka"${nastaveni.auto_uzaverka ? ' checked' : ''} />
          <b>Zavírat měsíce sám</b>
        </label>
        <span class="note">
          Měsíc se uzavře <b>${nastaveni.den_splatnosti}. dne následujícího měsíce</b> —
          ${esc(bezicMesic)} tedy ${esc(kdyZavreMesic(bezicMesic, nastaveni.den_splatnosti))}.
          Ten měsíc navíc je schválně: platba poslaná na poslední chvíli se připíše až za pár dní
          a bez té rezervy by uzávěrka zamrazila díru, která žádná není.
        </span>
        <span class="note" id="auto-stav"></span>
      </div>
      <p class="vysvetleni note">
        Automat nikdy nepřepíše, co už je hotové — uzavřený měsíc nechá být. Uzávěrku jde zrušit
        i zavřít ručně, když se najde chyba; všechno se zapisuje do historie se jménem a časem,
        takže je poznat, co udělal člověk a co appka sama.
      </p>
      ${bloky || '<p class="vysvetleni">Zatím není co uzavírat — první měsíc bude po splatnosti.</p>'}
    </div>
  </div>`;

  const skript = `<script>
async function posli(url, telo, mesic) {
  const stav = document.querySelector('[data-stav="' + mesic + '"]');
  stav.textContent = 'pracuju…';
  const odpoved = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(telo),
  });
  const data = await odpoved.json().catch(() => ({}));
  if (odpoved.ok) location.reload(); else stav.textContent = data.chyba || 'Nepovedlo se.';
}

document.querySelectorAll('[data-uzavri]').forEach((b) => {
  b.addEventListener('click', () => posli('/api/uzaverka', { obdobi: b.dataset.uzavri }, b.dataset.uzavri));
});
document.querySelectorAll('[data-zrus]').forEach((b) => {
  b.addEventListener('click', () => {
    if (!confirm('Zrušit uzávěrku ' + b.dataset.zrus + '? Měsíc se pak zase počítá z aktuálního nastavení.')) return;
    void posli('/api/uzaverka/zrusit', { obdobi: b.dataset.zrus }, b.dataset.zrus);
  });
});

const prepinac = document.getElementById('auto-uzaverka');
prepinac.addEventListener('change', async () => {
  const stav = document.getElementById('auto-stav');
  stav.textContent = 'ukládám…';
  const odpoved = await fetch('/api/automat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ auto_uzaverka: prepinac.checked }),
  });
  const data = await odpoved.json().catch(() => ({}));
  stav.textContent = odpoved.ok
    ? (prepinac.checked ? 'Zapnuto — měsíce se budou zavírat samy.' : 'Vypnuto — měsíce zavírej ručně tlačítkem.')
    : (data.chyba || 'Nepovedlo se uložit.');
});
</script>`;

  return shell({
    aktivni: 'uzaverky',
    nazevDomu: prehled.nazev_domu,
    titulek: 'Uzávěrky',
    commit,
    obsah,
    status: `<span>měsíců <b>${mesice.length}</b></span><span>uzavřeno <b>${uzavrenych}</b></span>${
      mesice.length - uzavrenych > 0
        ? `<span class="warn">otevřeno <b>${mesice.length - uzavrenych}</b></span>`
        : ''
    }<span class="spacer"></span><span>přihlášen: ${esc(kdo)}</span>`,
    skript,
  });
}

/** Spočítá, co se má do uzávěrky zamrazit. */
export function podkladUzaverky(
  prehled: Prehled,
  zalohy: Zaloha[],
  obdobi: string,
): {
  obdobi: string;
  naklady_celkem: number;
  podily: { member_id: number; podil: number; zaloha: number }[];
  polozky: { cost_item_id: number; nazev: string; castka: number }[];
} {
  const souhrn = spocitej(prehled, obdobi);

  const podily = prehled.osoby
    .filter((o) => (o.pod_member_id ?? null) === null)
    .map((o) => {
      const deti = prehled.osoby.filter((d) => (d.pod_member_id ?? null) === o.id).map((d) => d.id);
      const podil = [o.id, ...deti].reduce(
        (a, id) => a + (souhrn.mesicneOsoba.get(id) ?? 0) + (souhrn.saldoOsoba.get(id) ?? 0),
        0,
      );
      return { member_id: o.id, podil, zaloha: zalohaVMesici(zalohy, o.id, obdobi) };
    });

  const polozky = souhrn.radky
    .filter((r) => r.castka !== 0)
    .map((r) => ({ cost_item_id: r.polozka.id, nazev: r.polozka.nazev, castka: r.castka }));

  return {
    obdobi,
    naklady_celkem: souhrn.mesicneCelkem + souhrn.saldoCelkem,
    podily,
    polozky,
  };
}

export const dnesniMesic = mesicNyni;
