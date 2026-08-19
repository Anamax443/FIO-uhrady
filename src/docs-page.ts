/**
 * Stránka „Dokumentace" — jak se s aplikací pracuje a podle čeho počítá.
 *
 * Psané pro člověka, který do appky přijde bez znalosti vnitřností: co kde
 * nastavit, co které číslo znamená a co dělat, když něco nesedí.
 */
import { esc, shell } from './ui.js';

const STYL = `
<style>
.main { display: block; overflow-y: auto; }
.dok { display: grid; grid-template-columns: 210px minmax(0, 1fr); align-items: start; }
.obsah-menu { position: sticky; top: 0; padding: 12px 10px; border-right: 1px solid var(--border); display: flex; flex-direction: column; gap: 3px; }
.obsah-menu a { color: var(--text-dim); text-decoration: none; padding: 3px 6px; border-radius: 2px; }
.obsah-menu a:hover { background: var(--hover); color: var(--text); }
.text { padding: 14px 16px 40px; max-width: 78ch; display: flex; flex-direction: column; gap: 16px; }
.text section { display: flex; flex-direction: column; gap: 7px; scroll-margin-top: 8px; }
.text h2 { margin: 0; font-size: 14px; font-weight: 600; padding-bottom: 4px; border-bottom: 1px solid var(--border-soft); }
.text h3 { margin: 6px 0 0; font-size: 12.5px; font-weight: 600; }
.text p, .text li { margin: 0; color: var(--text-dim); }
.text b { color: var(--text); }
.text ul, .text ol { margin: 0; padding-left: 19px; display: flex; flex-direction: column; gap: 4px; }
.text code { font-family: var(--mono); font-size: 11.5px; background: var(--chrome); padding: 0 3px; border: 1px solid var(--border-soft); border-radius: 2px; }
.text table { border: 1px solid var(--border); }
.text th, .text td { border-bottom: 1px solid var(--border-soft); padding: 4px 8px; height: auto; white-space: normal; }
.text th { background: var(--head); text-align: left; font-weight: 600; }
.poznamka { border-left: 2px solid var(--accent); background: var(--accent-soft); padding: 7px 10px; }
.varovani { border-left: 2px solid var(--warn); background: var(--warn-soft, rgba(150, 112, 13, .12)); padding: 7px 10px; }
@media (max-width: 860px) {
  .dok { grid-template-columns: 1fr; }
  .obsah-menu { position: static; border-right: 0; border-bottom: 1px solid var(--border); flex-flow: row wrap; }
  .text { padding: 12px 11px 32px; }
}
</style>`;

interface Kapitola {
  id: string;
  nadpis: string;
  telo: string;
}

const KAPITOLY: Kapitola[] = [
  {
    id: 'k-cemu',
    nadpis: 'K čemu to je',
    telo: `
      <p>
        Aplikace vede <b>náklady domácnosti</b> a dělí je mezi její členy. Není to nájem —
        je to přehled o tom, co provoz domu stojí a jaký podíl na tom kdo má.
      </p>
      <p>
        Druhá polovina práce je <b>párování příspěvků</b>: aplikace si sama stahuje pohyby
        z účtu u Fio banky a poznává, od koho platba přišla. Díky tomu je vidět, kolik už
        kdo poslal a kolik ještě zbývá.
      </p>`,
  },
  {
    id: 'naklady',
    nadpis: 'Náklady domu',
    telo: `
      <p>
        Každý náklad je jedna položka: název, částka, jak často se platí, a kdo se na ní skládá.
        Částka se zadává <b>za jedno období</b> — u ročního nákladu roční částka, ne měsíční průměr.
        Ať se dá porovnat s fakturou.
      </p>
      <h3>Druhy položek</h3>
      <table>
        <tr><th>Druh</th><th>Co znamená</th><th>Kam se počítá</th></tr>
        <tr><td>pravidelný</td><td>opakovaný náklad (elektřina, internet)</td><td>do měsíčního průměru</td></tr>
        <tr><td>jednorázový</td><td>jednorázový výdaj (oprava kotle)</td><td>rovnou do vyrovnání</td></tr>
        <tr><td>nedoplatek</td><td>doplatek z vyúčtování</td><td>rovnou do vyrovnání</td></tr>
        <tr><td>přeplatek</td><td>vrácený přeplatek</td><td>do vyrovnání se znaménkem mínus</td></tr>
      </table>
      <p>
        Jednorázové věci schválně nevstupují do měsíčního průměru — jinak by průměr skákal podle
        toho, jestli zrovna přišla oprava kotle.
      </p>
      <h3>Kdo se skládá</h3>
      <p>
        U položky zaškrtneš lidi, kteří se na ní podílejí, a zadáš buď <b>procento</b>, nebo
        <b>pevnou částku</b>. Tlačítko <b>Rovným dílem</b> rozpočítá zaškrtnuté na stejné díly.
        Kombinace se u každé položky liší — na jedné se skládá jeden pár, na druhé jiný.
      </p>
      <div class="poznamka">
        Co se nerozdělí, zůstane vidět jako <b>nerozděleno</b> a položka svítí jako nedokončená.
        Zbytek se nikam neschovává — jinak by souhrn tvrdil něco, co není pravda.
      </div>`,
  },
  {
    id: 'osoby',
    nadpis: 'Osoby',
    telo: `
      <p>
        Osoby jsou ti, mezi které se náklady dělí. U každé se dá vyplnit <b>e-mail</b>
        (kam chodí vyúčtování) a <b>příznak admin</b> (kdo dostane souhrn za celou domácnost).
      </p>
      <h3>Podíl nese někdo jiný</h3>
      <p>
        U nezletilého dítěte se nastaví, že jeho podíl nese rodič. Dítě má dál <b>vlastní podíl</b>,
        aby bylo vidět, co stojí — ale v přehledu a ve vyrovnání se jeho částka připočte rodiči
        a ukáže se jako „Máma (nese i Eliška)".
      </p>
      <p>
        Osoba se nemaže, jen vyřadí z evidence. Smazat člověka, na kterého se váže minulé
        vyúčtování, by rozbilo historii.
      </p>`,
  },
  {
    id: 'platby',
    nadpis: 'Jak se poznají platby',
    telo: `
      <p>
        Aplikace stahuje pohyby z Fio API a u každého hledá, komu patří. Postupuje v tomto pořadí
        a první nález vyhrává:
      </p>
      <ol>
        <li><b>Variabilní symbol</b> z příkazu — hlavní znak, s ním může platba přijít odkudkoli.</li>
        <li><b>Číslo účtu</b> plátce, pokud je u osoby vyplněné (nepovinné).</li>
        <li><b>Komentář u pohybu</b> — ten, který k platbě dopíšeš v internetbankingu Fio,
            když plátce VS zapomněl.</li>
        <li><b>Zpráva pro příjemce</b> a <b>identifikace plátce</b>.</li>
        <li>Nenašlo se nic → platba zůstane <b>bez přiřazení</b> a přiřadí se ručně v seznamu.</li>
      </ol>
      <div class="poznamka">
        Z textových polí se berou <b>jen čísla, která odpovídají některému evidovanému VS</b>.
        Jinak by se do párování chytala náhodná čísla z poznámek — datum, částka, cizí číslo faktury.
      </div>
      <p>
        U každé platby je v seznamu vidět, <b>čím</b> se poznala („podle VS", „z komentáře", „ručně").
        Ruční přiřazení automatický běh nikdy nepřepíše.
      </p>
      <h3>Kdy se stahuje</h3>
      <p>
        Automaticky každých 15 minut, nebo ručně tlačítkem <b>Stáhnout z banky</b>. Stahuje se vždy
        posledních 14 dní s překryvem; duplicity nevzniknou, protože se pohyby rozlišují podle
        identifikátoru z banky. Každý běh — i ten, který nic nenašel — je vidět v Logu synchronizace.
      </p>`,
  },
  {
    id: 'vyrovnani',
    nadpis: 'Příspěvky a vyrovnání',
    telo: `
      <p>Kolik měl kdo dohromady zaplatit se počítá takto:</p>
      <p>
        <code>měsíční podíl × počet měsíců od začátku období + jednorázové položky − co přišlo na účet</code>
      </p>
      <p>
        Kladný výsledek znamená <b>zbývá doplatit</b>, záporný <b>přeplatek</b>. Začátek období
        se nastavuje přímo na té stránce.
      </p>
      <div class="varovani">
        Starší měsíce se zatím počítají <b>dnešními</b> částkami. Když se náklad v čase změnil,
        výpočet to nezohlední — na to budou potřeba měsíční uzávěrky, které zamrazí, co v daném
        měsíci platilo. Do té doby ber vyrovnání jako orientační, ne jako účetní doklad.
      </div>`,
  },
  {
    id: 'nastaveni',
    nadpis: 'Nastavení a token do banky',
    telo: `
      <p>
        V Nastavení se určuje, <b>kdo posílá peníze na účet</b> a podle čeho ho poznat (VS,
        případně číslo účtu), a vkládá se <b>token do Fio</b>.
      </p>
      <h3>Token</h3>
      <p>
        Zakládá se v internetbankingu Fio (Nastavení → API) a musí být vydaný <b>jen pro čtení</b> —
        aplikace pohyby pouze stahuje, nic neplatí. Uložený token se z aplikace nedá přečíst zpět,
        vidíš jen jeho konec; jde ho pouze přepsat novým.
      </p>`,
  },
  {
    id: 'zmeny',
    nadpis: 'Kdo co změnil',
    telo: `
      <p>
        Každá změna se ukládá spolu se <b>jménem a časem</b> — a to v jedné dávce se samotnou
        změnou, takže nemůže vzniknout úprava bez záznamu.
      </p>
      <ul>
        <li>Historie jedné položky je v jejím detailu, včetně rozdílu („částka: 299 Kč → 349 Kč").</li>
        <li>Souhrn posledních změn napříč aplikací je v Nastavení.</li>
      </ul>`,
  },
  {
    id: 'pristup',
    nadpis: 'Přístup a bezpečnost',
    telo: `
      <p>
        Do správy se chodí přes <b>PIN</b>. PIN se nikam neukládá — v databázi je jen jeho otisk
        se solí. Po pěti chybných pokusech se adresa na 15 minut zamkne, po deseti na hodinu.
        Přihlášení drží podepsaná cookie s platností 12 hodin.
      </p>
      <p>
        Silnější varianta je <b>Cloudflare Access</b>: přihlášení e-mailem s druhým faktorem.
        Když je zapnutý, má přednost před PINem a do záznamů o změnách se píše skutečný e-mail
        místo „PIN (adresa)".
      </p>
      <div class="varovani">
        Čtyřmístný PIN na veřejné adrese je slabší ochrana než Access — proti hádání ho drží
        jen to zpomalení. Na data, na kterých záleží, zapni Access.
      </div>`,
  },
  {
    id: 'export',
    nadpis: 'Export dat',
    telo: `
      <p>
        Náklady se dají stáhnout do <b>CSV pro Excel</b> tlačítkem v Nákladech domu. Soubor má
        středníky, českou desetinnou čárku a značku kódování, takže ho Excel otevře rovnou,
        bez průvodce importem.
      </p>`,
  },
];

export function renderDokumentace(nazevDomu: string, kdo: string, commit: string): string {
  const menu = KAPITOLY.map((k) => `<a href="#${k.id}">${esc(k.nadpis)}</a>`).join('');
  const text = KAPITOLY.map(
    (k) => `<section id="${k.id}"><h2>${esc(k.nadpis)}</h2>${k.telo}</section>`,
  ).join('');

  const obsah = `${STYL}
  <div>
    <div class="panehead"><svg class="icon icon-sm"><use href="#i-doc"/></svg>Dokumentace</div>
    <div class="dok">
      <nav class="obsah-menu">${menu}</nav>
      <div class="text">
        <p>
          Jak se s aplikací pracuje a podle čeho počítá. Psáno tak, aby se v tom vyznal
          i někdo, kdo ji nestavěl.
        </p>
        ${text}
      </div>
    </div>
  </div>`;

  return shell({
    aktivni: 'dokumentace',
    nazevDomu,
    titulek: 'Dokumentace',
    commit,
    obsah,
    status: `<span>kapitol <b>${KAPITOLY.length}</b></span><span class="spacer"></span><span>přihlášen: ${esc(kdo)}</span>`,
  });
}
