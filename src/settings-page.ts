/**
 * Stránka „Nastavení" — podle čeho se poznají příspěvky na účtu,
 * token do Fio a posledních pár změn z logu.
 *
 * Rozdělení nákladů mezi osoby je kalkulace: ukazuje, co dům stojí a na koho
 * co padá. Peníze na účet posílá jen ten, kdo je tu označený jako plátce.
 */
import type { Nastaveni } from './db.js';
import type { Osoba } from './model.js';
import { AI_MODELY, popisVolby } from './ai.js';
import { TEXTY } from './texty.js';
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
.hlavicky, .radek { display: grid; grid-template-columns: 112px 82px 100px 148px 124px 96px minmax(0, 1fr); gap: 9px; align-items: center; }
.hlavicky { font-size: 10.5px; letter-spacing: .55px; text-transform: uppercase; color: var(--text-faint); border-bottom: 1px solid var(--border-soft); padding-bottom: 3px; }
.radek .jmeno { font-weight: 600; }
.radek .stav { color: var(--text-faint); }
.radek .stav.chyba { color: var(--crit); }
.radek[data-platce="false"] input[type="text"] { visibility: hidden; }
.platce { display: flex; align-items: center; gap: 6px; color: var(--text-dim); }
.odkaz { grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 2px 0 6px; }
.odkaz input { flex: 1; min-width: 220px; }
.texty { display: grid; grid-template-columns: 210px minmax(220px, 1fr) minmax(0, 1.1fr); gap: 6px 10px; align-items: center; }
.texty label { color: var(--text-dim); }
.texty input { width: 100%; }
.tokenradek { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.tokenradek input { width: 320px; max-width: 100%; }
.audit td { font-size: 11.5px; }
.audit .cas { width: 132px; font-family: var(--mono); color: var(--text-dim); }
.audit .kdo { width: 190px; color: var(--text-dim); }
.audit .akce { width: 92px; }
@media (max-width: 820px) {
  .texty { grid-template-columns: 1fr; gap: 2px; }
  .texty label { margin-top: 8px; }
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
  /** `https://…` bez lomítka na konci — odkaz musí jít poslat celý, ne jako cesta */
  puvod: string,
  /**
   * Co se stalo těsně předtím, než se stránka načetla znovu. Bez toho by po
   * uložení vypadala stránka úplně stejně a nešlo by poznat, jestli se něco
   * stalo — člověk pak klikne podruhé.
   */
  stav: string | null = null,
  /** je k dispozici free backend (binding na Workers AI)? */
  maAi = false,
  /** je čím platit Claude — klíč z Nastavení nebo secret z prostředí? */
  maKlicAi = false,
  /** je klíč jen v prostředí (wrangler secret)? Pak ho odsud nejde přepsat. */
  klicZProstredi = false,
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
      <select data-rod="${o.id}" aria-label="Rod ${esc(o.jmeno)}"
              title="Jak o téhle osobě appka mluví. Neurčeno = neutrálně, nic se nehádá.">
        <option value=""${o.rod ? '' : ' selected'}>neurčeno</option>
        <option value="zena"${o.rod === 'zena' ? ' selected' : ''}>žena</option>
        <option value="muz"${o.rod === 'muz' ? ' selected' : ''}>muž</option>
      </select>
      <span class="stav" data-stav="${o.id}">${stav}</span>
      <div class="odkaz">
        ${
          o.view_token
            ? `<input type="text" class="mono" readonly value="${esc(puvod)}/v/${esc(o.view_token)}" data-odkaz="${o.id}" aria-label="Osobní odkaz ${esc(o.jmeno)}" onfocus="this.select()" />
               <button class="btn" type="button" data-kopiruj="${o.id}" title="Zkopíruje celou adresu do schránky — dá se rovnou poslat">Kopírovat</button>
               <button class="btn" type="button" data-zrus-odkaz="${o.id}" title="Zneplatní odkaz; kdo ho má uložený, přestane se dostat na přehled">Zrušit</button>`
            : `<span class="note">osobní přehled zatím nemá</span>
               <button class="btn" type="button" data-vytvor-odkaz="${o.id}">Vytvořit odkaz</button>`
        }
      </div>
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

  const HLASKY: Record<string, string> = {
    identifikace: 'Identifikace uložena. Změna je zapsaná v historii dole na stránce.',
    'odkaz-vytvoren': 'Osobní odkaz vytvořen. Zkopíruj ho tlačítkem a pošli tomu, komu patří.',
    'odkaz-zrusen': 'Osobní odkaz zrušen — starý odkaz od teď nikam nevede.',
    sledovani: 'Sledování příspěvků uloženo.',
    token: 'Token do Fio uložen. Další stažení pohybů ho použije.',
    texty: 'Texty uloženy. QR i osobní přehled je od teď používají.',
    ai: 'Backend i model pro AI uloženy.',
    klic: 'Klíč ke Claude uložen. Placený backend ho použije, až si ho vybereš.',
    'klic-smazan': 'Klíč ke Claude smazán. AI běží dál zdarma přes Workers AI.',
  };
  const hlaska = stav === null ? null : (HLASKY[stav] ?? null);

  const obsah = `${STYL}
  <div>
    ${
      hlaska === null
        ? ''
        : `<div class="hlaska ok">${esc(hlaska)}</div>`
    }
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
        <p class="vysvetleni">
          Sloupec <b>Rod</b> říká, jak o té osobě aplikace mluví („poslala jsi míň, než měla").
          Dřív se to odhadovalo z toho, jestli jméno končí na „a" — což u Nikoly nebo Saši
          nevyjde. Když rod necháš neurčený, mluví appka <b>neutrálně</b> a nic nehádá.
        </p>
        <div class="hlavicky">
          <span>Osoba</span><span>Na účet</span><span>VS</span><span>Číslo účtu</span><span>Podíl nese</span><span>Rod</span><span></span>
        </div>
        ${radky}
        <div class="tokenradek">
          <button class="btn primary" type="button" id="ulozit-identifikaci"
                  title="Uloží, kdo posílá na účet, jeho VS a kdo za koho nese podíl">Uložit identifikaci</button>
          <span class="stav" id="identifikace-stav"></span>
        </div>
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
      <div class="panehead"><svg class="icon icon-sm"><use href="#i-doc"/></svg>QR platba a texty pro členy</div>
      <div class="telo">
        <p class="vysvetleni">
          Co má být v <b>QR platbě</b> a jakými slovy appka mluví na osobním přehledu.
          Nic z toho není zadrátované v kódu — píšeš si to sám. Prázdné pole u QR znamená,
          že se ten údaj do kódu <b>nedá vůbec</b> a banka nabídne své vlastní předvyplnění.
        </p>
        <div class="texty">
          <label for="qr-prijemce">Název příjemce v QR</label>
          <input type="text" id="qr-prijemce" maxlength="35" value="${esc(nastaveni.qr_prijemce)}"
                 placeholder="např. Jana Nováková" />
          <span class="note">tohle uvidí člověk v bance jako příjemce platby</span>

          <label for="qr-zprava">Zpráva pro příjemce v QR</label>
          <input type="text" id="qr-zprava" maxlength="35" value="${esc(nastaveni.qr_zprava)}"
                 placeholder="např. Prispevek na dum" />
          <span class="note">objeví se u platby na výpisu</span>
        </div>
        <p class="vysvetleni note">
          Obojí nejvýš <b>35 znaků</b> a <b>bez diakritiky</b> — to je omezení QR platby, ne naše;
          háčky a čárky appka při vkládání do kódu sama odstraní, ať to banky přečtou.
        </p>

        <div class="texty">
          ${TEXTY.map(
            (t) => `<label for="t-${t.klic}">${esc(t.popis)}</label>
          <input type="text" id="t-${t.klic}" data-text="${t.klic}" maxlength="200"
                 value="${esc(nastaveni.texty[t.klic] ?? t.vychozi)}" placeholder="${esc(t.vychozi)}" />
          <span class="note">výchozí: „${esc(t.vychozi)}"</span>`,
          ).join('')}
        </div>
        <div class="tokenradek">
          <button class="btn primary" type="button" id="ulozit-texty"
                  title="Uloží texty do QR i věty na osobním přehledu">Uložit texty</button>
          <span class="note" id="texty-stav"></span>
        </div>
        <p class="vysvetleni note">
          Když pole u věty vyprázdníš, vrátí se výchozí znění uvedené pod ním.
        </p>
      </div>
    </section>

    <section class="panel">
      <div class="panehead"><svg class="icon icon-sm"><use href="#i-info"/></svg>Umělá inteligence</div>
      <div class="telo">
        <p class="vysvetleni">
          AI komentuje vývoj nákladů na Přehledu. <b>Výchozí backend je zdarma</b> —
          Cloudflare Workers AI, data neopustí Cloudflare. Placený Claude je volitelný
          a appka ho sama od sebe nepoužije; jen když si ho tady vybereš, nebo když by
          free backend úplně chyběl.
        </p>
        <p class="vysvetleni">
          Komentáři na Přehledu se posílají <b>jen náklady domu</b> — částky, kategorie a vývoj
          po měsících, žádná jména. Okno <b>Zeptat se AI</b> na Nákladech domu dostane navíc
          <b>rozpad na osoby a kredity včetně jmen</b>, protože bez nich se na dotaz odpovědět nedá.
          Čísla účtů, variabilní symboly ani jednotlivé platby z banky se ven neposílají nikdy.
          A počítá se jen na kliknutí, ne při každém načtení stránky.
        </p>
        <p class="vysvetleni">
          <b>Bez AI aplikace nezůstane.</b> Když placený klíč vyprší nebo Claude neodpoví,
          dotaz se dopočítá zdarma přes Workers AI a u odpovědi je vidět, že zaskočil
          free backend a proč.
        </p>
        <div class="tokenradek">
          <label for="ai-provider">Backend</label>
          <select id="ai-provider">
            <option value=""${nastaveni.ai_provider === '' ? ' selected' : ''}>automaticky (zdarma)</option>
            <option value="workers-ai"${nastaveni.ai_provider === 'workers-ai' ? ' selected' : ''}>jen zdarma — Workers AI</option>
            <option value="anthropic"${nastaveni.ai_provider === 'anthropic' ? ' selected' : ''}>placený Claude</option>
            <option value="off"${nastaveni.ai_provider === 'off' ? ' selected' : ''}>vypnuto</option>
          </select>
          <label for="ai-model">Model</label>
          <select id="ai-model">
            <option value=""${nastaveni.ai_model === '' ? ' selected' : ''}>výchozí pro zvolený backend</option>
            ${AI_MODELY.map(
              (m) =>
                `<option value="${esc(m.id)}"${nastaveni.ai_model === m.id ? ' selected' : ''}>${esc(m.popis)}</option>`,
            ).join('')}
          </select>
          <button class="btn primary" type="button" id="ulozit-ai" title="Uloží backend i model">Uložit</button>
          <span class="note" id="ai-stav"></span>
        </div>
        <p class="vysvetleni note">
          Model se vybírá zvlášť od backendu. <b>Na dotazy nad tabulkou není nejmenší model
          nejlevnější, jen se plete</b> — Llama 3.1 8B si na dotaz „kolik platí máma"
          vymyslela rozpad, který v datech není. Proto je výchozí Llama 3.3 70B, taky zdarma.
          Když vybraný model nepatří ke zvolenému backendu, použije se výchozí model toho
          backendu — volání by jinak spadlo na neznámém ID.
        </p>
        <p class="vysvetleni note">${esc(popisVolby(nastaveni.ai_provider, maAi, maKlicAi))}</p>

        <div class="tokenradek">
          <span class="stav">Klíč ke Claude: <b class="mono">${
            nastaveni.claude_klic_naznak
              ? esc(nastaveni.claude_klic_naznak)
              : klicZProstredi
                ? 'jen v prostředí (wrangler secret)'
                : 'zatím žádný'
          }</b></span>
        </div>
        <div class="tokenradek">
          <input type="password" id="claude-klic" placeholder="sk-ant-…" autocomplete="off" spellcheck="false" />
          <button class="btn primary" type="button" id="ulozit-klic" title="Uloží klíč od Anthropic. Uložený klíč se odsud už nedá přečíst, jen přepsat.">Uložit klíč</button>
          <button class="btn" type="button" id="smazat-klic" title="Smaže klíč. AI tím nezmizí — poběží dál zdarma přes Workers AI.">Smazat klíč</button>
          <span class="note" id="klic-stav"></span>
        </div>
        <p class="vysvetleni note">
          Klíč se zakládá na <span class="mono">console.anthropic.com</span> → API keys. Ukládá se
          stejně jako token do Fio: v aplikaci se už nedá přečíst, jen přepsat, a do historie změn
          jde jen fakt, že se měnil — ne hodnota. Klíč vložený tady má přednost před
          <span class="mono">ANTHROPIC_API_KEY</span> z prostředí.
        </p>
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

// Po uložení se stránka načte znovu (přepočítat odvozené texty) — a rovnou
// s tím, co se stalo. Prostý reload by vypadal, jako by se nestalo nic.
const znovu = (stav) => location.assign('/admin/nastaveni?stav=' + stav);

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
  const tlacitko = el('ulozit-identifikaci');
  tlacitko.disabled = true;
  el('identifikace-stav').textContent = 'ukládám…';
  const zmeny = [...document.querySelectorAll('.radek')].map((r) => {
    const id = Number(r.dataset.osoba);
    const hodnota = (sel) => { const v = r.querySelector(sel).value.trim(); return v === '' ? null : v; };
    const pod = r.querySelector('[data-pod="' + id + '"]').value;
    const rod = r.querySelector('[data-rod="' + id + '"]').value;
    return {
      member_id: id,
      je_platce: r.querySelector('[data-platce="' + id + '"]').checked,
      vs: hodnota('[data-vs="' + id + '"]'),
      ucet: hodnota('[data-ucet="' + id + '"]'),
      pod_member_id: pod === '' ? null : Number(pod),
      rod: rod === '' ? null : rod,
    };
  });
  const vysledek = await posli('/api/identifikace', { zmeny: zmeny });
  if (vysledek.ok) { znovu('identifikace'); return; }
  tlacitko.disabled = false;
  el('identifikace-stav').textContent = vysledek.chyba;
  el('identifikace-stav').className = 'stav chyba';
});

document.querySelectorAll('[data-vytvor-odkaz]').forEach((b) => {
  b.addEventListener('click', async () => {
    b.disabled = true;
    b.textContent = 'vytvářím…';
    const v = await posli('/api/odkaz', { member_id: Number(b.dataset.vytvorOdkaz) });
    if (v.ok) { znovu('odkaz-vytvoren'); return; }
    b.disabled = false;
    b.textContent = 'Vytvořit odkaz';
    alert(v.chyba);
  });
});
document.querySelectorAll('[data-zrus-odkaz]').forEach((b) => {
  b.addEventListener('click', async () => {
    if (!confirm('Zrušit odkaz? Kdo ho má uložený, přestane se dostat na přehled.')) return;
    const v = await posli('/api/odkaz/zrusit', { member_id: Number(b.dataset.zrusOdkaz) });
    if (v.ok) { znovu('odkaz-zrusen'); return; }
    alert(v.chyba);
  });
});
document.querySelectorAll('[data-kopiruj]').forEach((b) => {
  b.addEventListener('click', async () => {
    // V poli je už celá adresa i s doménou — kopíruje se přesně to, co je vidět.
    const pole = document.querySelector('[data-odkaz="' + b.dataset.kopiruj + '"]');
    try { await navigator.clipboard.writeText(pole.value); b.textContent = 'Zkopírováno'; }
    catch { pole.select(); b.textContent = 'Vyber a zkopíruj'; }
    setTimeout(() => { b.textContent = 'Kopírovat'; }, 2000);
  });
});

el('ulozit-sledovani').addEventListener('click', async () => {
  el('sledovani-stav').textContent = 'ukládám…';
  const vysledek = await posli('/api/sledovani', { od: el('od').value.trim(), den: el('den').value.trim() });
  if (vysledek.ok) { znovu('sledovani'); return; }
  el('sledovani-stav').textContent = vysledek.chyba;
});

el('ulozit-texty').addEventListener('click', async () => {
  el('texty-stav').textContent = 'ukládám…';
  const texty = {};
  document.querySelectorAll('[data-text]').forEach((pole) => { texty[pole.dataset.text] = pole.value; });
  const vysledek = await posli('/api/texty', {
    qr_prijemce: el('qr-prijemce').value,
    qr_zprava: el('qr-zprava').value,
    texty: texty,
  });
  if (vysledek.ok) { znovu('texty'); return; }
  el('texty-stav').textContent = vysledek.chyba;
});

el('ulozit-ai').addEventListener('click', async () => {
  el('ai-stav').textContent = 'ukládám…';
  const vysledek = await posli('/api/ai', {
    provider: el('ai-provider').value,
    model: el('ai-model').value,
  });
  if (vysledek.ok) { znovu('ai'); return; }
  el('ai-stav').textContent = vysledek.chyba;
});

el('ulozit-klic').addEventListener('click', async () => {
  const pole = el('claude-klic');
  el('klic-stav').textContent = 'ukládám…';
  const vysledek = await posli('/api/claude-klic', { klic: pole.value });
  if (vysledek.ok) { pole.value = ''; znovu('klic'); return; }
  el('klic-stav').textContent = vysledek.chyba;
});

el('smazat-klic').addEventListener('click', async () => {
  if (!confirm('Smazat klíč ke Claude? AI tím nevypneš — poběží dál zdarma přes Workers AI.')) return;
  el('klic-stav').textContent = 'mažu…';
  const vysledek = await posli('/api/claude-klic', { klic: '' });
  if (vysledek.ok) { znovu('klic-smazan'); return; }
  el('klic-stav').textContent = vysledek.chyba;
});

el('ulozit-token').addEventListener('click', async () => {
  const pole = el('token');
  el('token-stav').textContent = 'ukládám…';
  const vysledek = await posli('/api/fio-token', { token: pole.value });
  if (vysledek.ok) { pole.value = ''; znovu('token'); return; }
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
