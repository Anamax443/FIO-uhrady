/**
 * Stránka „Nastavení" — identifikace plateb podle VS, token do Fio
 * a posledních pár změn z logu.
 */
import type { Nastaveni } from './db.js';
import type { Osoba } from './model.js';
import { esc, shell } from './ui.js';

interface OsobaSVS extends Osoba {
  vs?: string | null;
}

interface ZaznamAuditu {
  cas: string;
  kdo: string;
  akce: string;
  entita: string;
  entita_id: string | null;
  popis: string;
}

const STYL = `
<style>
.main { grid-template-columns: minmax(0, 1fr); align-content: start; overflow-y: auto; }
.panel { border-bottom: 1px solid var(--border); }
.panel .telo { padding: 11px 12px 14px; display: flex; flex-direction: column; gap: 10px; max-width: 860px; }
.vysvetleni { color: var(--text-dim); max-width: 74ch; }
.vysvetleni code { font-family: var(--mono); font-size: 11.5px; }
.radek { display: grid; grid-template-columns: 150px 130px minmax(0, 1fr); gap: 10px; align-items: center; }
.radek label { color: var(--text-dim); }
.radek .stav { color: var(--text-faint); }
.radek .stav.ok { color: var(--ok); }
.radek .stav.chyba { color: var(--crit); }
.tokenradek { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.tokenradek input { width: 320px; max-width: 100%; }
.audit td { font-size: 11.5px; }
.audit .cas { width: 132px; font-family: var(--mono); color: var(--text-dim); }
.audit .kdo { width: 190px; color: var(--text-dim); }
.audit .akce { width: 92px; }
@media (max-width: 700px) {
  .radek { grid-template-columns: 1fr 1fr; }
  .radek .stav { grid-column: 1 / -1; }
  .audit .kdo { display: none; }
}
</style>`;

export function renderNastaveni(
  osoby: OsobaSVS[],
  nastaveni: Nastaveni,
  audit: ZaznamAuditu[],
  kdo: string,
): string {
  const radkyVS = osoby
    .map(
      (o) => `<div class="radek" data-osoba="${o.id}">
      <label for="vs-${o.id}">${esc(o.jmeno)}</label>
      <input type="text" id="vs-${o.id}" class="mono" inputmode="numeric" maxlength="10"
             value="${esc(o.vs ?? '')}" placeholder="bez VS" data-vs="${o.id}" />
      <span class="stav" data-stav="${o.id}">${
        o.vs ? 'platby s tímto VS se přiřadí této osobě' : 'platí mimo účet — VS se nepoužije'
      }</span>
    </div>`,
    )
    .join('');

  const radkyAuditu =
    audit.length === 0
      ? '<tr><td colspan="4" class="note">Zatím žádná změna.</td></tr>'
      : audit
          .map(
            (z) => `<tr>
        <td class="cas">${esc(z.cas)}</td>
        <td class="kdo">${esc(z.kdo)}</td>
        <td class="akce">${esc(z.akce)}</td>
        <td>${esc(z.popis)}</td>
      </tr>`,
          )
          .join('');

  const obsah = `${STYL}
  <div>
    <section class="panel">
      <div class="panehead"><svg class="icon icon-sm"><use href="#i-users"/></svg>Identifikace plateb podle VS</div>
      <div class="telo">
        <p class="vysvetleni">
          Podle variabilního symbolu se pozná, čí platba přišla na účet. Když plátce VS nevyplní,
          dopiš ho v internetbankingu Fio do komentáře u pohybu — aplikace ho tam najde a platbu
          přiřadí stejně, jako by VS byl vyplněný. Hledá se v tomto pořadí:
          <code>VS</code> → <code>komentář</code> → <code>zpráva pro příjemce</code> →
          <code>uživatelská identifikace</code>. Z textu se berou jen čísla, která odpovídají
          některému VS z této tabulky — jinak by se chytala náhodná čísla z poznámek.
        </p>
        ${radkyVS}
        <div><button class="btn primary" type="button" id="ulozit-vs">Uložit variabilní symboly</button></div>
      </div>
    </section>

    <section class="panel">
      <div class="panehead"><svg class="icon icon-sm"><use href="#i-key"/></svg>Připojení k Fio bance</div>
      <div class="telo">
        <p class="vysvetleni">
          Token se zakládá v internetbankingu Fio (Nastavení → API). Vydej ho <b>jen pro čtení</b> —
          aplikace pohyby pouze stahuje, nic neplatí. Uložený token se odsud už nedá přečíst,
          jde jen přepsat novým.
        </p>
        <div class="tokenradek">
          <span class="stav">Uložený token: <b class="mono">${
            nastaveni.fio_token_naznak ? esc(nastaveni.fio_token_naznak) : 'zatím žádný'
          }</b></span>
        </div>
        <div class="tokenradek">
          <input type="password" id="token" placeholder="vlož nový token" autocomplete="off" spellcheck="false" />
          <button class="btn primary" type="button" id="ulozit-token">Uložit token</button>
          <span class="note" id="token-stav"></span>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panehead"><svg class="icon icon-sm"><use href="#i-log"/></svg>Poslední změny
        <span class="count">${audit.length} záznamů</span>
      </div>
      <div class="gridwrap">
        <table class="audit">
          <thead><tr><th class="cas">Kdy</th><th class="kdo">Kdo</th><th class="akce">Akce</th><th>Co</th></tr></thead>
          <tbody>${radkyAuditu}</tbody>
        </table>
      </div>
    </section>
  </div>`;

  const skript = `<script>
const el = (id) => document.getElementById(id);

async function posli(url, telo, hotovo) {
  try {
    const odpoved = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(telo),
    });
    const data = await odpoved.json();
    hotovo(odpoved.ok, data.chyba || '');
  } catch (e) {
    hotovo(false, 'Server neodpověděl: ' + e.message);
  }
}

el('ulozit-vs').addEventListener('click', async () => {
  const zmeny = [...document.querySelectorAll('[data-vs]')].map((i) => ({
    member_id: Number(i.dataset.vs), vs: i.value.trim() === '' ? null : i.value.trim(),
  }));
  await posli('/api/vs', { zmeny: zmeny }, (ok, chyba) => {
    if (ok) { location.reload(); return; }
    const stav = document.querySelector('[data-stav]');
    if (stav) { stav.textContent = chyba; stav.className = 'stav chyba'; }
  });
});

el('ulozit-token').addEventListener('click', async () => {
  const pole = el('token');
  el('token-stav').textContent = 'ukládám…';
  await posli('/api/fio-token', { token: pole.value }, (ok, chyba) => {
    if (ok) { pole.value = ''; location.reload(); return; }
    el('token-stav').textContent = chyba;
  });
});
</script>`;

  return shell({
    aktivni: 'nastaveni',
    nazevDomu: nastaveni.nazev_domu,
    titulek: 'Nastavení',
    obsah,
    status: `<span>Nastavení</span><span>osob <b>${osoby.length}</b></span><span class="spacer"></span><span>přihlášen: ${esc(kdo)}</span>`,
    skript,
  });
}
