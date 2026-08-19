/**
 * Stránka „Nastavení" — podle čeho se poznají příspěvky na účtu,
 * token do Fio a posledních pár změn z logu.
 *
 * Rozdělení nákladů mezi osoby je kalkulace: ukazuje, co dům stojí a na koho
 * co padá. Peníze na účet posílá jen ten, kdo je tu označený jako plátce.
 */
import type { Nastaveni } from './db.js';
import type { Osoba } from './model.js';
import { esc, shell } from './ui.js';

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
.panel .telo { padding: 11px 12px 14px; display: flex; flex-direction: column; gap: 10px; max-width: 900px; }
.vysvetleni { color: var(--text-dim); max-width: 76ch; margin: 0; }
.vysvetleni code { font-family: var(--mono); font-size: 11.5px; }
.hlavicky, .radek { display: grid; grid-template-columns: 118px 88px 104px 152px 132px minmax(0, 1fr); gap: 10px; align-items: center; }
.hlavicky { font-size: 10.5px; letter-spacing: .55px; text-transform: uppercase; color: var(--text-faint); border-bottom: 1px solid var(--border-soft); padding-bottom: 3px; }
.radek .jmeno { font-weight: 600; }
.radek .stav { color: var(--text-faint); }
.radek .stav.chyba { color: var(--crit); }
.radek[data-platce="false"] input[type="text"] { visibility: hidden; }
.platce { display: flex; align-items: center; gap: 6px; color: var(--text-dim); }
.tokenradek { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.tokenradek input { width: 320px; max-width: 100%; }
.audit td { font-size: 11.5px; }
.audit .cas { width: 132px; font-family: var(--mono); color: var(--text-dim); }
.audit .kdo { width: 190px; color: var(--text-dim); }
.audit .akce { width: 92px; }
@media (max-width: 820px) {
  .hlavicky { display: none; }
  .radek { grid-template-columns: 1fr 1fr; gap: 6px 10px; padding: 8px 0; border-bottom: 1px solid var(--border-soft); }
  .radek .jmeno, .radek .stav { grid-column: 1 / -1; }
  .radek[data-platce="false"] input { display: none; }
  .audit .kdo { display: none; }
}

/* Telefon: nic nesmí přetéct doprava, jinak se text ořízne uprostřed slova. */
@media (max-width: 560px) {
  .panel .telo { max-width: 100%; padding: 10px 9px 12px; }
  .vysvetleni { max-width: 100%; overflow-wrap: anywhere; }
  .radek { grid-template-columns: 1fr; gap: 4px; }
  .radek > * { min-width: 0; }
  /* Zaškrtávátko se roztáhnout nesmí — jinak odskočí od svého popisku. */
  .radek input:not([type="checkbox"]), .radek select { width: 100%; }
  .tokenradek { flex-direction: column; align-items: stretch; }
  .tokenradek input { width: 100%; }
}
</style>`;

export function renderNastaveni(
  osoby: Osoba[],
  nastaveni: Nastaveni,
  audit: ZaznamAuditu[],
  kdo: string,
  commit: string,
): string {
  const jmeno = (id: number | null | undefined): string =>
    osoby.find((x) => x.id === id)?.jmeno ?? '';

  const radky = osoby
    .map((o) => {
      const platce = Boolean(o.je_platce);
      const podKym = o.pod_member_id ?? null;
      // Nabízí se jen ti, kdo sami pod nikým nejsou — řetěz by se špatně četl.
      const volby = osoby
        .filter((x) => x.id !== o.id && (x.pod_member_id ?? null) === null)
        .map(
          (x) => `<option value="${x.id}"${x.id === podKym ? ' selected' : ''}>${esc(x.jmeno)}</option>`,
        )
        .join('');

      const stav = podKym
        ? `podíl se počítá ${esc(jmeno(podKym))}`
        : platce
          ? o.vs
            ? `příspěvky s VS ${esc(o.vs)} se počítají ${esc(o.jmeno)}`
            : 'chybí VS — příspěvky nepůjde poznat'
          : 'na účet neposílá, počítá se jí jen podíl na nákladech';

      return `<div class="radek" data-osoba="${o.id}" data-platce="${platce}">
      <span class="jmeno">${esc(o.jmeno)}</span>
      <label class="platce"><input type="checkbox" data-platce="${o.id}"${platce ? ' checked' : ''} /> posílá</label>
      <input type="text" class="mono" inputmode="numeric" maxlength="10" data-vs="${o.id}"
             value="${esc(o.vs ?? '')}" placeholder="VS" aria-label="VS ${esc(o.jmeno)}" />
      <input type="text" class="mono" data-ucet="${o.id}"
             value="${esc(o.ucet ?? '')}" placeholder="účet (nepovinné)" aria-label="Účet ${esc(o.jmeno)}" />
      <select data-pod="${o.id}" aria-label="Podíl ${esc(o.jmeno)} se počítá">
        <option value="">nese sám</option>${volby}
      </select>
      <span class="stav" data-stav="${o.id}">${stav}</span>
    </div>`;
    })
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
      <div class="panehead"><svg class="icon icon-sm"><use href="#i-users"/></svg>Podle čeho se poznají příspěvky</div>
      <div class="telo">
        <p class="vysvetleni">
          Rozdělení nákladů mezi osoby je kalkulace — ukazuje, co dům stojí a na koho co padá.
          Peníze na účet ale reálně posílá jen někdo; zaškrtni koho a podle čeho ho poznat.
        </p>
        <p class="vysvetleni">
          Hlavní znak je <b>variabilní symbol</b> — s ním může příspěvek přijít odkudkoli,
          klidně z cizího účtu nebo složenkou. Číslo účtu je jen doplněk pro případ, že VS
          v příkazu chybí. Když chybí obojí, hledá se VS ještě v komentáři, který u pohybu
          dopíšeš v internetbankingu Fio, a pak ve zprávě pro příjemce:
          <code>VS</code> → <code>komentář</code> → <code>zpráva pro příjemce</code> →
          <code>uživatelská identifikace</code>. Z textu se berou jen čísla, která odpovídají
          některému VS z této tabulky — jinak by se chytala náhodná čísla z poznámek.
        </p>
        <p class="vysvetleni">
          Nezletilé dítě má svůj podíl, ať je vidět, co stojí — ale závazek za něj nese rodič.
          Nastav to sloupcem <b>Podíl nese</b>; v přehledu pak zůstane vidět zvlášť i sečtený.
        </p>
        <div class="hlavicky">
          <span>Osoba</span><span>Na účet</span><span>VS</span><span>Číslo účtu</span><span>Podíl nese</span><span></span>
        </div>
        ${radky}
        <div><button class="btn primary" type="button" id="ulozit-identifikaci">Uložit identifikaci</button></div>
      </div>
    </section>

    <section class="panel">
      <div class="panehead"><svg class="icon icon-sm"><use href="#i-doc"/></svg>Sledování příspěvků v čase</div>
      <div class="telo">
        <p class="vysvetleni">
          Příspěvek se platí <b>každý měsíc</b>. Od zadaného počátku se přičítá jeden měsíční podíl
          za každý měsíc, který je <b>už po splatnosti</b> — do dne splatnosti se běžící měsíc
          nepočítá, protože ještě není co dlužit.
        </p>
        <div class="tokenradek">
          <label for="od">Sledovat od</label>
          <input type="text" id="od" class="mono" style="width:110px" value="${esc(nastaveni.vyuctovani_od)}" placeholder="RRRR-MM" />
          <label for="den">Splatnost dne</label>
          <input type="text" id="den" class="mono" style="width:60px" inputmode="numeric" value="${nastaveni.den_splatnosti}" />
          <button class="btn primary" type="button" id="ulozit-sledovani">Uložit</button>
          <span class="note" id="sledovani-stav"></span>
        </div>
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

document.querySelectorAll('[data-platce]').forEach((box) => {
  if (box.tagName !== 'INPUT') return;
  box.addEventListener('change', () => {
    box.closest('.radek').dataset.platce = box.checked ? 'true' : 'false';
  });
});

async function posli(url, telo) {
  try {
    const odpoved = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(telo),
    });
    const data = await odpoved.json();
    return { ok: odpoved.ok, chyba: data.chyba || '' };
  } catch (e) {
    return { ok: false, chyba: 'Server neodpověděl: ' + e.message };
  }
}

el('ulozit-identifikaci').addEventListener('click', async () => {
  const zmeny = [...document.querySelectorAll('.radek')].map((r) => {
    const id = Number(r.dataset.osoba);
    const hodnota = (sel) => { const v = r.querySelector(sel).value.trim(); return v === '' ? null : v; };
    const pod = r.querySelector('[data-pod="' + id + '"]').value;
    return {
      member_id: id,
      je_platce: r.querySelector('[data-platce="' + id + '"]').checked,
      vs: hodnota('[data-vs="' + id + '"]'),
      ucet: hodnota('[data-ucet="' + id + '"]'),
      pod_member_id: pod === '' ? null : Number(pod),
    };
  });
  const vysledek = await posli('/api/identifikace', { zmeny: zmeny });
  if (vysledek.ok) { location.reload(); return; }
  const stav = document.querySelector('[data-stav]');
  if (stav) { stav.textContent = vysledek.chyba; stav.className = 'stav chyba'; }
});

el('ulozit-sledovani').addEventListener('click', async () => {
  el('sledovani-stav').textContent = 'ukládám…';
  const vysledek = await posli('/api/sledovani', { od: el('od').value.trim(), den: el('den').value.trim() });
  if (vysledek.ok) { location.reload(); return; }
  el('sledovani-stav').textContent = vysledek.chyba;
});

el('ulozit-token').addEventListener('click', async () => {
  const pole = el('token');
  el('token-stav').textContent = 'ukládám…';
  const vysledek = await posli('/api/fio-token', { token: pole.value });
  if (vysledek.ok) { pole.value = ''; location.reload(); return; }
  el('token-stav').textContent = vysledek.chyba;
});
</script>`;

  const platci = osoby.filter((o) => o.je_platce).map((o) => o.jmeno);

  return shell({
    aktivni: 'nastaveni',
    nazevDomu: nastaveni.nazev_domu,
    titulek: 'Nastavení',
    commit,
    obsah,
    status: `<span>Nastavení</span><span>osob <b>${osoby.length}</b></span><span>na účet posílá: <b>${
      platci.length > 0 ? esc(platci.join(', ')) : 'zatím nikdo'
    }</b></span><span class="spacer"></span><span>přihlášen: ${esc(kdo)}</span>`,
    skript,
  });
}
