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
      </p>
      <div class="poznamka">
        <b>Je to podklad, ne účetnictví.</b> Smyslem je, aby bylo doložitelně vidět, co dům
        stojí a jak na tom kdo je s příspěvkem — ne vystavovat předpisy k úhradě. Nic se
        nevymáhá, čísla mají hlavně informovat.
      </div>`,
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
    id: 'rozpousteni',
    nadpis: 'Nákup není spotřeba',
    telo: `
      <p>
        Uhlí za 42 000 Kč se protopí za celou sezónu, ne v měsíci nákupu. Kdyby appka
        hodila celou částku do jednoho měsíce, vyskočil by tenhle měsíc příspěvek do nesmyslné
        výše a příští měsíc by zase spadl.
      </p>
      <p>
        Proto se u položky dá zadat <b>rozpuštění</b>: přes kolik měsíců a od kterého.
        42 000 Kč na 12 měsíců = 3 500 Kč měsíčně, které se dělí mezi lidi jako každý
        jiný náklad. Po dvanácti měsících položka z měsíčních nákladů zmizí sama.
      </p>
      <p>
        Další dokoupení je <b>samostatná položka</b> se svým rozpuštěním — klidně běží
        souběžně s tou první.
      </p>
      <h3>Kdo to zaplatil</h3>
      <p>
        U položky se určuje, jestli se platila <b>ze společného účtu</b>, nebo
        <b>z něčí kapsy</b>. Když děda koupí uhlí za své, vloží do domácnosti reálné peníze —
        appka mu je připíše stejně jako platbu příkazem a jeho kredit se umořuje tím,
        jak se náklad rozpouští.
      </p>
      <div class="poznamka">
        Rozlišení zdroje je důležité kvůli dvojímu počítání: bez něj by se náklad
        objevil dvakrát — jednou jako výdaj a podruhé jako něčí vklad.
      </div>`,
  },
  {
    id: 'vyrovnani',
    nadpis: 'Zálohy a vyrovnání',
    telo: `
      <p>
        Příspěvek se platí <b>fixní zálohou</b> — trvalým příkazem, každý měsíc stejná částka.
        Dluh se počítá <b>ze zálohy</b>, ne z kolísajících nákladů: co má kdo poslat,
        se během období nemění.
      </p>
      <p>
        <code>dluh = záloha × počet měsíců po splatnosti − co přišlo</code>
      </p>
      <p>
        Měsíc se započítá až <b>dnem splatnosti</b> (nastavuje se, výchozí 20.). Do té doby
        ještě není co dlužit.
      </p>
      <h3>Jak vzniká záloha</h3>
      <p>
        Aplikace spočítá, kolik na osobu vyjde za příštích dvanáct měsíců, přidá
        <b>rezervu na neplánované nákupy</b> a zaokrouhlí nahoru na stovky. Návrh pak
        <b>potvrdí admin</b> — appka zálohu nikdy nestanoví sama. Zaokrouhluje se nahoru
        schválně: malý přeplatek se vrací líp, než se shání nedoplatek.
      </p>
      <h3>Vyúčtování</h3>
      <p>
        Vedle záloh se sčítají <b>skutečné náklady</b>. Rozdíl mezi zaplaceným a skutečností
        je přeplatek nebo nedoplatek — ten se při vyúčtování <b>rozpustí do nové zálohy</b>,
        takže trvalý příkaz se přepíše jednou za období a zase je klid.
        Podrobně v kapitole <a href="#vyuctovani">Vyúčtování období</a>.
      </p>`,
  },
  {
    id: 'uzaverky',
    nadpis: 'Měsíční uzávěrky',
    telo: `
      <p>
        Náklady se v čase mění — internet zdraží, uhlí doběhne, rozdělení se upraví.
        Dokud je měsíc <b>otevřený</b>, počítá se z aktuálního nastavení, takže zpětný pohled
        by tvrdil, že tehdy platilo dnešní číslo.
      </p>
      <p>
        <b>Uzávěrka zamrazí</b>, co v měsíci opravdu platilo: celkové náklady, podíl každé osoby,
        platnou zálohu a soupis položek. Vyrovnání pak ten měsíc bere ze zamražených čísel
        a pozdější změny s ním už nehnou.
      </p>
      <ul>
        <li>Uzavírají se jen měsíce <b>po splatnosti</b> — budoucnost zamrazit nejde.</li>
        <li>Uzávěrku lze <b>zrušit</b>, když se najde chyba; měsíc se pak zase počítá z aktuálního
            nastavení. Uzavření i zrušení se zapisuje do historie se jménem a časem.</li>
        <li>Ve Vyrovnání je vidět, kolik měsíců ještě uzavřených není.</li>
      </ul>`,
  },
  {
    id: 'vyuctovani',
    nadpis: 'Vyúčtování období',
    telo: `
      <p>
        Záloha je schválně <b>fixní</b>, aby trvalý příkaz nemusel nikdo měnit každý měsíc.
        Skutečné náklady ale kolísají, takže se rozdíl někde nasčítá. Vyúčtování ho jednou
        za období srovná — stejně jako u energií.
      </p>
      <p>
        <code>rozdíl = skutečný podíl na nákladech − co za období přišlo</code>
      </p>
      <p>Za období se sčítají <b>zamražená čísla z uzávěrek</b>, proto jde vyúčtovat jen
        uzavřené a navazující měsíce. Otevřený měsíc se pořád počítá z dnešního nastavení
        a vyúčtované číslo by se pak mohlo zpětně změnit.</p>
      <h3>Co se s rozdílem stane</h3>
      <ul>
        <li><b>Rozpustit do zálohy</b> — rozdíl se rozloží do dvanácti měsíců a přičte
            k nové záloze. Trvalý příkaz zůstane fixní, jen se jednou přepíše.</li>
        <li><b>Doplatit jednorázově</b> — rozdíl zůstane stát jako částka k doplacení
            (nebo k vrácení) a ve Vyrovnání se ukazuje zvlášť, mimo zálohu.</li>
      </ul>
      <p>
        Nedoplatek nad <b>práh z Nastavení</b> appka sama rozpustit nenavrhne — zvedl by
        zálohu příliš, tak se radši zeptá. Poslední slovo má stejně admin: částku zálohy
        jde přepsat ručně.
      </p>
      <h3>Období na sebe navazují</h3>
      <p>
        Uložením vyúčtování se <b>počátek sledování posune</b> za konec období a nové zálohy
        začnou platit od následujícího měsíce. Co se jednou zúčtovalo, se v dalším období
        už nepočítá — jinak by se stejný přeplatek odečítal od dluhu donekonečna.
      </p>
      <p>
        Zrušit jde jen <b>poslední</b> vyúčtování; sledování se vrátí na začátek jeho období.
        Zálohy, které stanovilo, přitom zůstávají v platnosti — jsou to historická data
        a mění se ve Vyrovnání.
      </p>
      <div class="varovani">
        Platba za prosinec, která přijde až v lednu, spadne do <b>dalšího</b> období.
        Vyúčtování ji ukáže jako nedoplatek a v novém období se objeví jako předplacené —
        vyrovná se to samo, jen to na přelomu období vypadá rozhozeně.
      </div>`,
  },
  {
    id: 'odkaz',
    nadpis: 'Osobní přehled pro člena',
    telo: `
      <p>
        Každý člen může dostat <b>vlastní odkaz</b> na svůj přehled — vytvoří se v Nastavení
        u jeho řádku. Odkaz je náhodný a neuhodnutelný; kdo ho má, dostane se na stránku
        bez přihlášení.
      </p>
      <p>Na svém přehledu vidí:</p>
      <ul>
        <li><b>kolik zbývá doplatit</b> nebo kolik má předplaceno, velkým písmem hned nahoře;</li>
        <li><b>QR platbu</b> na tu částku — naskenuje se v mobilní bance, částka i variabilní
            symbol se vyplní samy, takže nevznikne překlep;</li>
        <li>výši své zálohy a datum nejbližší splatnosti;</li>
        <li><b>graf</b> svého podílu po měsících a seznam svých plateb;</li>
        <li><b>náklady domu na rok</b> po kategoriích a položkách.</li>
      </ul>
      <div class="poznamka">
        Ze svého přehledu se <b>nedozví nic o ostatních</b> — kolik platí kdo jiný tam není.
        Souhrn za dům je bez rozpadu na osoby.
      </div>
      <p>
        Odkaz jde kdykoli <b>zrušit</b> a vytvořit nový; ten starý tím okamžitě přestane platit.
        Vytvoření i zrušení se zapisuje do historie.
      </p>`,
  },  {
    id: 'nastaveni',
    nadpis: 'Nastavení a token do banky',
    telo: `
      <p>
        V Nastavení se určuje, <b>kdo posílá peníze na účet</b> a podle čeho ho poznat (VS,
        případně číslo účtu), <b>od kdy se příspěvky sledují</b>, <b>kolikátého jsou splatné</b>
        a vkládá se <b>token do Fio</b>.
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
