/**
 * Stránka „Úhrady z Fio" — co přišlo na účet a komu se to přiřadilo.
 *
 * U každé platby je vidět, **čím** se poznala (VS, komentář, ručně…), ne jen
 * výsledek. Když se nepoznala, je to normální stav a dá se přiřadit ručně —
 * ne chyba, kterou by měl někdo hledat v logu.
 */
import type { Beh, Platba } from './db.js';
import { formatKc } from './money.js';
import type { Osoba } from './model.js';
import { esc, shell } from './ui.js';

const POPIS_ZDROJE: Record<string, string> = {
  vs: 'podle VS',
  ucet: 'podle čísla účtu',
  komentar: 'z komentáře u pohybu',
  zprava: 'ze zprávy pro příjemce',
  uziv_ident: 'z identifikace plátce',
  rucne: 'ručně',
};

const STYL = `
<style>
.main { grid-template-rows: auto auto 1fr; align-content: start; }
table { min-width: 900px; }
.col-datum { width: 92px; font-family: var(--mono); color: var(--text-dim); }
.col-cast { width: 104px; }
.col-vs { width: 92px; font-family: var(--mono); }
.col-kdo { width: 150px; }
.col-obdobi { width: 96px; }
.col-obdobi input { width: 100%; height: 20px; padding: 0 4px; font-family: var(--mono); font-size: 11.5px; }
.col-obdobi input.zmeneno { border-color: var(--accent); color: var(--accent); }
.col-jak { width: 178px; color: var(--text-dim); }
.protistrana { color: var(--text-dim); }
.prazdno { padding: 26px 18px; color: var(--text-dim); display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.beh { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-bottom: 1px solid var(--border); background: var(--chrome-hi); flex-wrap: wrap; }
.beh .detail { color: var(--text-dim); }
select.prirad { height: 20px; padding: 0 3px; }
@media (max-width: 700px) {
  table { min-width: 0; }
  .col-vs, .protistrana, .col-jak { display: none; }
}
</style>`;

export function renderUhrady(
  platby: Platba[],
  osoby: Osoba[],
  beh: Beh | null,
  kdo: string,
  commit: string,
  nazevDomu: string,
  maToken: boolean,
): string {
  const volby = (vybrany: number | null): string =>
    ['<option value="">— nepřiřazeno —</option>']
      .concat(
        osoby.map(
          (o) => `<option value="${o.id}"${o.id === vybrany ? ' selected' : ''}>${esc(o.jmeno)}</option>`,
        ),
      )
      .join('');

  const radky =
    platby.length === 0
      ? ''
      : platby
          .map((p) => {
            const jak = p.matched_by
              ? `${POPIS_ZDROJE[p.matched_by] ?? p.matched_by}${
                  p.matched_value ? ` (${esc(p.matched_value)})` : ''
                }`
              : '<span class="s-warn"><span class="dot"></span>nepoznáno</span>';
            // Prázdné `obdobi` mají jen platby stažené před zavedením sloupce —
            // pro ně platí měsíc z data, ať v tabulce nesvítí prázdno.
            const obdobi = p.obdobi ?? p.datum.slice(0, 7);
            const jinyMesic = obdobi !== p.datum.slice(0, 7);
            return `<tr>
    <td class="col-datum">${esc(p.datum)}</td>
    <td class="col-num col-cast">${formatKc(p.castka)}</td>
    <td class="col-vs">${p.vs ? esc(p.vs) : '—'}</td>
    <td>${esc(p.protiucet_nazev ?? '')} <span class="protistrana">${esc(p.komentar ?? p.zprava ?? '')}</span></td>
    <td class="col-kdo">
      <select class="prirad" data-platba="${esc(p.fio_id)}" aria-label="Komu patří platba">${volby(p.member_id)}</select>
    </td>
    <td class="col-obdobi">
      <input type="text" class="obdobi${jinyMesic ? ' zmeneno' : ''}" value="${esc(obdobi)}"
             data-obdobi="${esc(p.fio_id)}" inputmode="numeric" maxlength="7" placeholder="RRRR-MM"
             aria-label="Za který měsíc platba je"
             title="${jinyMesic ? 'Ručně přepsáno — platba přišla ' + esc(p.datum) : 'Předvyplněno podle data platby; dá se přepsat, když někdo platí za jiný měsíc'}" />
    </td>
    <td class="col-jak">${jak}</td>
  </tr>`;
          })
          .join('\n');

  const obsah = `${STYL}
  <div>
    <div class="panehead">
      <svg class="icon icon-sm"><use href="#i-bank"/></svg>Úhrady z Fio
      <span class="count">${platby.length} plateb</span>
    </div>
    <div class="toolbar">
      <button class="tbtn primary" type="button" id="stahnout"${maToken ? '' : ' disabled title="nejdřív vlož token v Nastavení"'}>
        <svg class="icon icon-sm"><use href="#i-refresh"/></svg>Stáhnout z banky
      </button>
      <span class="sep"></span>
      <span class="note" id="stav-syncu">${
        beh === null
          ? 'zatím se nestahovalo'
          : beh.stav === 'chyba'
            ? `poslední pokus ${esc(beh.zacatek)} selhal: ${esc(beh.detail ?? '')}`
            : `naposledy ${esc(beh.zacatek)} — ${esc(beh.detail ?? 'bez podrobností')}`
      }</span>
    </div>
    ${
      platby.length === 0
        ? `<div class="prazdno">
        <b>Zatím tu není žádná platba.</b>
        <span>${
          maToken
            ? 'Stáhni pohyby tlačítkem nahoře — načte se posledních 14 dní.'
            : 'Nejdřív vlož token do Fio v Nastavení, pak půjde stahovat.'
        }</span>
      </div>`
        : `<div class="gridwrap">
      <table>
        <thead><tr>
          <th class="col-datum">Datum</th><th class="col-num col-cast">Částka</th>
          <th class="col-vs">VS</th><th>Plátce a poznámka</th>
          <th class="col-kdo">Přiřazeno</th>
          <th class="col-obdobi" title="Měsíc, za který se platí — nemusí sedět s datem připsání">Za měsíc</th>
          <th class="col-jak">Jak se poznalo</th>
        </tr></thead>
        <tbody>${radky}</tbody>
      </table>
    </div>`
    }
  </div>`;

  const nepoznane = platby.filter((p) => p.member_id === null).length;

  const skript = `<script>
const el = (id) => document.getElementById(id);

async function posli(url, telo) {
  const odpoved = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(telo || {}),
  });
  const data = await odpoved.json().catch(() => ({}));
  return { ok: odpoved.ok, data: data };
}

el('stahnout').addEventListener('click', async () => {
  const tl = el('stahnout');
  tl.disabled = true;
  el('stav-syncu').textContent = 'stahuju z banky…';
  const v = await posli('/api/sync');
  if (v.ok) { location.reload(); return; }
  el('stav-syncu').textContent = v.data.chyba || 'Stažení se nepovedlo.';
  tl.disabled = false;
});

document.querySelectorAll('.prirad').forEach((s) => {
  s.addEventListener('change', async () => {
    const v = await posli('/api/platba/prirad', {
      fio_id: s.dataset.platba,
      member_id: s.value === '' ? null : Number(s.value),
    });
    if (v.ok) location.reload();
    else { el('stav-syncu').textContent = v.data.chyba || 'Přiřazení se nepovedlo.'; }
  });
});

// Měsíc se ukládá až po opuštění pole — jinak by se posílal po každé číslici.
document.querySelectorAll('.obdobi').forEach((pole) => {
  const puvodni = pole.value;
  const uloz = async () => {
    if (pole.value.trim() === puvodni) return;
    const v = await posli('/api/platba/obdobi', {
      fio_id: pole.dataset.obdobi,
      obdobi: pole.value.trim() === '' ? null : pole.value.trim(),
    });
    if (v.ok) { location.reload(); return; }
    el('stav-syncu').textContent = v.data.chyba || 'Měsíc se nepovedlo uložit.';
    pole.value = puvodni;
  };
  pole.addEventListener('blur', uloz);
  pole.addEventListener('keydown', (e) => { if (e.key === 'Enter') pole.blur(); });
});
</script>`;

  return shell({
    aktivni: 'uhrady',
    nazevDomu,
    titulek: 'Úhrady z Fio',
    commit,
    obsah,
    status: `<span>plateb <b>${platby.length}</b></span>${
      nepoznane > 0 ? `<span class="warn">bez přiřazení <b>${nepoznane}</b></span>` : ''
    }<span>${beh === null ? 'nestahovalo se' : 'poslední běh: ' + esc(beh.stav)}</span><span class="spacer"></span><span>přihlášen: ${esc(kdo)}</span>`,
    skript,
  });
}
