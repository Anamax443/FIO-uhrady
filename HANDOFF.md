# HANDOFF — deník stavu: FIO-uhrady

Append-only. Nejnovější záznam nahoru. Slouží k pokračování z jiného počítače / po pauze.

## 2026-08-21 — model se vybírá, graf se kreslí, Enter odesílá

**Špatné odpovědi měly tři různé příčiny** a stálo za to je oddělit:

1. **Model se vymlouval.** Podklad končil větou „na otázky na ně odpověz, že takové
   údaje k dispozici nemáš" a malý model si z ní udělal univerzální výmluvu — na
   „vykresli graf nákladů" recitoval čísla účtů a variabilní symboly, které s grafem
   nemají nic společného. Pravidlo je teď úzké a váže se jen na ty konkrétní údaje.
2. **Nikde nestálo, co model umí.** Systémový prompt říkal jen, co nesmí.
3. **8B model si vymýšlí.** Na „kolik platí máma" vrátil rozpad 2 000 + 350 + 205 Kč,
   který v datech vůbec není. Pojistka `jenOverenaCisla` to chytila, ale odpověď
   s ⚠ je pořád k ničemu.

**Model se vybírá v Nastavení** (`AI_MODELY` v `src/ai.ts`, nastavení `ai_model`) —
vzor převzatý z appky na hodnocení hráčů, která to má vyřešené stejně. Nabídka je
v kódu vidět a dá se opravit jedním commitem; co účet umí, vypíše `npx wrangler ai
models`. **Výchozí je nově Llama 3.3 70B**, taky zdarma: nejmenší model tu nešetří,
jen se plete. Když uložená volba nepatří ke zvolenému backendu, vezme se výchozí
model toho backendu — jinak by volání spadlo na neznámém ID. Uvažující model
(`gpt-oss-120b`) dostává čtyřnásobný strop tokenů, protože vnitřní úvaha se do
`max_tokens` počítá a jinak nezbude na odpověď.

**Graf appka opravdu nakreslí.** Uživatel to řekl přesně: *„nejde mi o to, aby se
vymluvil, ale aby to udělal."* Model proto vybírá **jen co zobrazit** (`"graf":
"kategorie" | "polozky" | "osoby" | "vyvoj"`) a **čísla dodá aplikace** ze svých dat
(`sestavGraf`). Kdyby čísla dodával model, platila by o nich stejná nedůvěra jako
o větách a graf by nešlo ukázat vůbec. Slabší modely to pole vynechávají, takže je
tu ještě záchrana podle znění dotazu (`zvolenyGraf`) — kdo si řekne o graf, dostane ho.

**Graf „osoby" sčítá s dětmi.** Napřed rozepisoval každého zvlášť, ale věta od modelu
mluvila o mámě včetně Elišky (6 488 Kč) a graf ukazoval mámu samotnou (3 497 Kč).
Text a obrázek si musí odpovídat, jinak čtenář neví, které číslo platí.

**Prompt rozlišuje tři pojmy**, které model slévá do jednoho: *podíl* (co na člověka
připadá), *vloženo* (co reálně dal) a *kredit* (rozdíl). „Kolik platí máma" je otázka
na vložené peníze — odpovědět podílem je zavádějící.

**Enter odesílá**, Shift+Enter dělá nový řádek. Ctrl+Enter u každé otázky nedávalo smysl.

**Opraveno u toho:** `prvniJson` padalo na `telo.indexOf is not a function` — 70B model
nevrací `response` jako řetězec, ale rovnou objekt. Nová `prvniJson` bere `unknown`
a objekt propustí rovnou.

**Ověřeno proti běžícímu Workeru** (Llama 3.3 70B): „vykresli graf nákladů" →
nakreslený graf Energie 12 200 / Dům 1 124 / Služby 802 Kč, sedí na tabulku ·
„kolik padne na energie" → 12 200 Kč · „graf vývoje v čase" → správně řekne, že
není uzavřený žádný měsíc, a graf nekreslí.

## 2026-08-21 — detail na vyžádání, dotazy pro AI a klíč ke Claude v Nastavení

**Kredit mámy ověřen** nezávislým přepočtem proti ostré databázi (kontrola: dědových
7 205 Kč sedí na to, co ukazuje appka). Máma **není v kreditu** — za srpen jí chybí
**2 933 Kč**: podíl 8 343 Kč (její + Eliščin), vloženo 5 410 Kč (5 309 Kč ze svého
+ 101 Kč na účet). Appka počítá správně. Mimochodem: **všech 13 položek už má
`zdroj_uhrady = 'osoba'`** — uživatel je ráno jednu po druhé přepnul (audit 07:16–09:02),
není to chyba ukládání.

**Detail položky se otevírá až na vyžádání.** Panel dřív zabíral 366 px pořád, i když
o něj nikdo nestál. Nově je zavřený a tabulka má celou šířku; otevře ho **dvojklik na
řádek, Enter, tlačítko Upravit, Přidat položku nebo Duplikovat**. Jeden klik řádek jen
označí. Pozor na past: **když detail otevřený je, přepne ho i jeden klik** — jinak by
šlo uložit formulář jedné položky pod id druhé. Zavírá Zavřít nebo Esc, a Esc **uvnitř
formuláře nezavírá**, aby rozepsaná změna nezmizela.

**Fakturu platí a Zaplaceno z jsou sloupce**, ne jen pole v detailu. U třinácti položek
se dřív nedalo porovnat, kdo co platí, bez otevírání každé zvlášť. Oba sloupce se řadí
i filtrují.

**Tři chyby, které z toho vypadly:**
1. **`hlaska('')` nic neschovala.** `.hlaska` má `display: flex`, což přebije `[hidden]`
   z prohlížeče — hláška zůstala viset i s textem, který už neplatil. Že „Uloženo v…"
   po uložení vůbec bylo vidět, byl vedlejší účinek téhle chyby: `ukazPolozku` ji hned
   po nastavení mazal. Přidáno `.hlaska[hidden] { display: none }` a hláška po
   uložení/smazání se přesunula **na stránku** (`#stranka-hlaska`) — v panelu, který
   může být zavřený, by ji nikdo neviděl.
2. **Volba „bez kategorie" ve filtru nefiltrovala.** Prázdná hodnota šla do `<option>`
   jako `value=""`, což filtr vyhodnocuje jako „vše". Teď je hodnotou popisek.
3. **`zaskok` se ztrácel po cestě.** `odpovezNaDotaz` i `zhodnotVyvoj` skládaly nový
   výsledek a informaci o selhaném backendu zahodily.

**Okno „Zeptat se AI"** je ve **společném rámu** (`shell` v `src/ui.ts`), takže tlačítko
je v titulní liště **na každé stránce správy** — první pokus ho měl jen v liště Nákladů
domu a na Přehledu, kde ho člověk hledá jako první, nebyl. Osobní přehled `/v/{token}`
si HTML skládá sám, takže tam okno není. Pozor na dvě pasti: názvy ve skriptu rámu mají
předponu `dotaz`, protože `const` na nejvyšší úrovni je sdílený mezi všemi bloky
`<script>` na stránce, a stav dotazu má id `ai-stav-dotazu` — `ai-stav` už na Přehledu
patří tlačítku komentáře. Kontrola: kolize jmen a duplicitní `id` napříč bloky se dají
vytáhnout ze staženého HTML, viz zádrhel č. 3.
Implementace v `src/dotaz.ts`, endpoint `POST /api/dotaz`. Modální,
vlákno otázek a odpovědí, Ctrl+Enter odešle. Drží stejná pravidla jako komentář:
model **nepočítá** (součty i kategorie dostane hotové) a **věta s číslem, které
v podkladu není, se označí ⚠**. Ověřeno, že to není teorie — na dotaz „kolik padne na
Energie" free model napřed vymyslel 1 700 Kč a pojistka to chytila; po doplnění součtů
po kategoriích do podkladu vrátil 12 200 Kč a 9 624 Kč, což sedí na tabulku.
Na rozdíl od komentáře jdou modelu **i jména osob a jejich podíly** — bez nich se na
dotaz správce odpovědět nedá. Čísla účtů, VS, jednotlivé platby ani e-maily ne.
Odpověď se skládá přes `textContent`, ne `innerHTML` — text od modelu je cizí vstup.

**Klíč ke Claude jde vložit v Nastavení**, stejně jako token do Fio: uložený se nedá
přečíst, jen přepsat nebo smazat, do auditu jde jen fakt, že se měnil. Klíč z Nastavení
má přednost před `ANTHROPIC_API_KEY` z prostředí. **Bez AI aplikace nezůstane** —
ověřeno s neplatným klíčem: Claude vrátil 401, odpověď dopočítal free Workers AI
a u odpovědi je vidět „zaskočil free backend" i důvod.

**V grafu „Kdo kolik platí" přibyl třetí pruh — zaplaceno z vlastní kapsy** (měsíčně).
Bez něj vypadal děda, který kupuje uhlí za 42 000 Kč, jako by neplatil nic.
A **kredit se teď ukazuje u všech**, i u těch, od koho příspěvky nechodí na účet.
Dřív u nich svítilo „nesleduje se" a nešlo poznat, jestli jsou v plusu, nebo v mínusu.
Rozdíl zůstal ve čtení, ne v tom, jestli je číslo vidět: **mínus u nesledovaného je
tlumený a psané u něj „nevymáhá se"** — je to zůstatek, ne dluh k doplacení.

**Jak zkoušet AI lokálně:** Workers AI binding v `wrangler dev` hlásí „Binding AI needs
to be run remotely". Dočasně `"ai": { "binding": "AI", "experimental_remote": true }`
ve `wrangler.jsonc` a po zkoušce vrátit zpátky (nasazená konfigurace se tím nemění).

**Zpětný zásah do rámu:** backtick uvnitř komentáře ve skriptu ukončil template literal
a rozbil `ui.ts`. Ve skriptech skládaných do řetězce se v komentářích píšou uvozovky,
ne backticky.

**Bez migrace** — `claude_klic` je řádek v `settings`, žádná změna schématu.

## 2026-08-21 — proč máma neměla kredit

Dotaz od uživatele nad novým grafem: proč u mámy svítí „nesleduje se", když
děda má k dobru 7 205 Kč. Ověřeno proti ostré databázi — **máma platí ze svého
hodně** (drogerie, internet, Magenta, Netflix, odpady, pojištění, televize,
VaK; dohromady ~3 809 Kč měsíčně), ale její podíl je 8 343 Kč měsíčně.
Je tedy v mínusu, ne v plusu — a dluh se u toho, od koho příspěvky nechodí
na účet, záměrně nesleduje.

Chování je správné, **výstup byl špatný**: holé „nesleduje se" nedá poznat,
jestli ten člověk nedal nic, nebo dal hodně a přesto nedosáhl na svůj podíl.
Nově se u něj ukážou obě čísla — kolik vložil a kolik na něj připadlo — a text
říká, že dluh se nesleduje. Kredit (kladný rozdíl) se ukazuje jako dřív.

**Mimochodem:** ze stejného výpisu je vidět, že **stočné už `zdroj_uhrady = 'osoba'`
má** — uživatel to v aplikaci přepnul, takže dřívější otevřený bod padá.
Dědův kredit 7 205 Kč už ho zahrnuje.

## 2026-08-21 — AI vrstva, kdo má jaký kredit, a čitelné logy

**AI vrstva** (`src/ai.ts`) podle stejného vzoru jako JobWatch a FIO-import:
přepínač backendu v Nastavení — automaticky (zdarma Workers AI), jen zdarma,
placený Claude, nebo vypnuto. **Appka sama od sebe nikdy neutrácí**; placené
volání nastane jen při výslovné volbě, nebo kdyby free binding vůbec chyběl.

První funkce nad tím je **komentář k vývoji nákladů** na Přehledu. Spouští ho
člověk tlačítkem, ne každé načtení stránky, a modelu jdou **jen náklady domu** —
žádná jména, čísla účtů ani platby.

**Čísla nepočítá model.** Součty i procenta spočítá aplikace a předá je hotová.
Při zkoušce free model sečetl kategorii Energie s uhlím, které do té kategorie
patří, a vyrobil nesmyslné procento. Kromě předpočítaných čísel proto platí
tvrdá pojistka: **věta s číslem, které v podkladu není, se nepublikuje**
(`jenOverenaCisla`). Ověřeno — procenta v komentáři sedí na tabulku
(8 000 / 14 126 = 57 %, Energie 86 %, pojištění 54 % kategorie).

**Kdo kolik platí** — na Přehledu přibyl pruhový graf: co na koho měsíčně padá,
kolik na to posílá zálohou, a hlavně **kredit proti skutečnosti** (co dal minus
co na něj připadlo). Díky tomu je konečně vidět, že děda má k dobru 2 163 Kč za
uhlí ze svého. U toho, od koho příspěvky nechodí, se ukazuje jen kredit, ne dluh —
drží se dřívější rozhodnutí, že narůstající dluh by u nich nic neznamenal.

**Log synchronizace byl nečitelný** — cron jede každých 15 minut, takže „Staženo
3 pohyby, nových 0" se za den zopakuje 96×. Po sobě jdoucí stejné běhy se teď
slévají do jednoho řádku (`seskupBehy`), nahoře jsou filtry podle stavu s počty
a starší se dotahují tlačítkem. Ověřeno na 41 bězích: srazily se na 6 řádků,
filtr „chyba" najde 2.

**Historie změn dostala vlastní stránku** (`/admin/historie`) ve stejném gardu:
filtry podle entity, slévání, načítání starších — a hlavně **stará → nová
hodnota** u každého pole. Kvůli tomu `ulozNastaveni` napřed přečte současnou
hodnotu; dřív se do auditu zapisovala jen ta nová, takže z historie nešlo
vyčíst, z čeho se měnilo. Dlouhý generovaný text (komentář od AI) se do auditu
neukládá, jen fakt, že se přepočítal — jinak by ostatní změny zavalil.

## 2026-08-21 — detail položky: čím se dělí a kde je Uložit

Pokračování dotazu na stočné. Popisek **„Měsíčně z toho: 967 Kč"** byl v detailu
položky stejně zavádějící jako na osobním přehledu — u pololetní položky se čte
jako pololetní částka. Je teď **dynamický podle periody**:

| Perioda | Popisek | Částka |
|---|---|---|
| měsíčně | Měsíčně | 1 500 Kč |
| čtvrtletně | Měsíční podíl z 1 821 Kč ÷ 3 měsíce | 607 Kč |
| pololetně | Měsíční podíl z 5 800 Kč ÷ 6 měsíců | 967 Kč |
| ročně | Měsíční podíl z 2 400 Kč ÷ 12 měsíců | 200 Kč |

**Uložit bylo až pod historií změn.** U položky s dlouhou historií se k němu
muselo scrollovat a na běžné obrazovce nebylo vidět vůbec. Lišta s tlačítky je
teď přilepená ke spodku panelu (`position: sticky; bottom: 0`) a **historie se
posouvá pod ní** — přesně jak si uživatel přál.

**Nová položka má výchozí „zaplaceno z vlastní kapsy"** (dřív účet domácnosti).
Tak se většina nákupů platí a účet domácnosti je ta výjimka; volba je i první
v seznamu. Existující položky se nemění.

## 2026-08-21 — „967 Kč pololetně" nebylo pololetně

Uživatel se ptal, odkud se u stočného bere 967 Kč, když faktura je 5 800 Kč
pololetně. **Počítalo se správně** (5 800 ÷ 6 = 967, jeho 20 % = 193 Kč měsíčně,
tedy 1 160 Kč za pololetí) — chyba byla v tom, jak to stránka napsala: ve sloupci
měsíční částka a hned pod ní „pololetně". Vysvětlivka „Částky jsou měsíční" byla
až na konci seznamu, kde si ji s konkrétním řádkem nikdo nespojí.

Na osobním přehledu je teď u položky vidět, **odkud se měsíční částka vzala**:
`pololetně 5 800 Kč → měsíčně`, u rozpouštěného nákupu `nákup 42 000 Kč
rozpuštěný na 12 měsíců`. Částky mají jednotku `/měs` a nadpis sekce říká
„Z čeho se to skládá — měsíčně".

**Poučení:** přepočtená částka bez uvedení, z čeho vznikla, je horší než žádná —
čte se jako údaj z faktury a člověk pak hledá chybu ve výpočtu, který je v pořádku.

### Otevřené: stočné se platí ze svého

Při té příležitosti vyšlo najevo, že **stočné platí děda ze svého**, ale položka
má `zdroj_uhrady = 'ucet'`. Appka mu tedy 967 Kč měsíčně nikde nepřipisuje jako
vklad, i když jeho podíl je jen 387 Kč (40 %) — rozdíl **580 Kč měsíčně**,
za pololetí 3 480 Kč, mu ve vyúčtování chybí jako pohledávka.

Změna je na uživateli: Náklady domu → Stočné → *Zaplaceno z* → **vlastní kapsy**.
**Schválně to nedělám přes SQL** — obešlo by to auditní stopu a v historii položky
by změna chyběla, což je jediné pravidlo appky, které nechci porušit ani se
svolením zapisovat do ostré databáze.

Rozdělení 40 / 20 / 20 / 20 je záměr (stočné je za 5 osob, pátá není v evidenci
a nese ji děda) a je správně: 20 % = ⅕, dědových 40 % = ⅖. **Do poznámky u položky
se to psát nemá** — výslovné přání uživatele.

## 2026-08-21 — dokumentace srovnaná, česky i anglicky

Dokumentace narostla nesourodě, tak je celá přepsaná a **zdvojená do angličtiny**.
Rozdělení roli: HANDOFF je deník (proč se co rozhodlo, append-only), STAV je
snímek dneška (přepisuje se), ARCHITECTURE je jak je to poskládané, BUILD je
postup od nuly.

| Dokument | Česky | Anglicky |
|---|---|---|
| Aktuální stav | `docs/STAV.md` | `docs/STATUS.en.md` |
| Architektura | `docs/ARCHITECTURE.md` | `docs/ARCHITECTURE.en.md` |
| Myšlenková mapa + diagramy | `docs/MAPA.md` | `docs/MAP.en.md` |
| Prezentace toku informací | `docs/prezentace.html` | `docs/presentation.en.html` |
| Manažerské shrnutí A4 | `docs/manazerske-shrnuti.html` | `docs/management-summary.en.html` |
| Postup od nuly | `docs/BUILD.md` | `docs/BUILD.en.md` |
| Rozcestník | `README.md` | `README.en.md` |

- **Myšlenková mapa a vývojové diagramy** v mermaidu: z čeho se systém skládá,
  kudy tečou data, životní cyklus měsíce, rozhodovací strom párování plateb
  a vrstvy kódu.
- **HTML prezentace** má tok informací jako **vlastní inline SVG** — žádná
  závislost na CDN, otevře se i bez internetu.
- **Manažerské shrnutí** je stavěné na tisk: `@page A4 portrait`, jedna strana,
  problém → řešení → přínosy → rizika → stav → náklady.
- **Dokumentace v aplikaci je dvojjazyčná**: `/admin/dokumentace` a
  `/admin/documentation`, kapitoly mají **stejná id**, takže odkaz do konkrétní
  části přežije přepnutí jazyka.

Do dokumentace jsem vytáhl i pasti, které mě dnes stály čas: `--file` na ostré
D1, vlastní seznam sloupců v `osobaPodleTokenu`, duplicitní `const` shodí celý
skript stránky, a `HTTP 500` z Fio není chyba tokenu.

**Nepřeloženo zůstává samotné UI správy** — je to větší práce než dokumentace
a nikdo ji zatím nepotřebuje.

## 2026-08-20 — texty patří do Nastavení, ne do kódu

Uživatel to řekl natvrdo: **co se může měnit, si píše sám.** Aplikace skládala
věty v kódu, včetně odhadu rodu z toho, jestli jméno končí na „a" (u Nikoly
nebo Saši nesmysl).

- **`src/texty.ts`** — věty na osobním přehledu („přišlo míň, než mělo",
  „ještě není splatné", text pod QR…) mají v kódu jen **výchozí znění**;
  cokoli vyplněného v Nastavení má přednost, prázdné pole vrátí výchozí.
- **QR platba**: název příjemce (`RN`) a zpráva (`MSG`) se berou z Nastavení.
  Prázdné = do kódu se nedají vůbec a banka nabídne své předvyplnění. Ukládají
  se už **profiltrované** (`proQr`: bez diakritiky, max 35 znaků), takže
  v Nastavení je vidět přesně to, co banka uvidí — omezení je dané standardem.
- **Rod** je volitelný údaj u osoby; nevyplněný = appka mluví neutrálně.

Ověřeno lokálně: změna textu se hned projeví na `/v/…`; QR se s příjemcem
a zprávou liší od QR bez nich (délka cesty 13 760 × 9 270 × 11 380), takže
ty údaje do kódu opravdu jdou.

**Past, na kterou jsem dnes narazil dvakrát:** `osobaPodleTokenu` má vlastní
seznam sloupců. Když se do něj nový sloupec nedoplní, osobní přehled o něm
neví a tváří se, že je prázdný — přesně tak se ztratil `view_token` i `rod`.

## 2026-08-20 — bezobslužný provoz a kategorie v nákladech

**Uzávěrky a vyúčtování se dělají samy** (`src/automat.ts`, běží z cronu vedle
stahování z Fio). Dvě pravidla, na kterých to stojí:

1. **Nikdy nepřepsat, co je hotové.** Uzavřený měsíc se znovu nezavírá — kdyby
   ano, každý běh cronu by zamrazil dnešní čísla a uzávěrka by ztratila smysl.
2. **Zavírat až dnem splatnosti následujícího měsíce** (srpen → 20. září).
   Ten měsíc navíc je schválně: platba poslaná na poslední chvíli se připíše
   za pár dní a bez rezervy by uzávěrka zamrazila díru, která žádná není.

Vyúčtování se spustí, teprve když je uzavřených `vyuctovani_mesicu` (výchozí 12)
**v řadě**. Bez rozhodnutí platí to, co má formulář předvybrané: rozdíl do zálohy,
nedoplatek nad práh zvlášť k doplacení. Do auditu se podepisuje `automat (cron)`.

Obojí jde vypnout přepínačem na své stránce; **admin má poslední slovo** —
uzávěrku i vyúčtování jde zrušit a udělat znovu ručně. Tím se mění dřívější
rozhodnutí „zálohu stanoví admin" na „stanoví ji automat, admin ji může přepsat".

Stahování z Fio a uzávěrky jsou teď v cronu **nezávislé** — chybějící token ani
výpadek banky nesmí zastavit zavírání měsíců.

**Ověřeno lokálně** (dnes 2026-08-20, splatnost 20., období 3 měsíce, sledování
od 2026-01): 1. běh zavřel 2026-01 až 2026-07 (srpen správně **ne**, ten se
zavírá 20. 9.) a vyúčtoval 01–03; 2. běh nezavřel nic a vyúčtoval 04–06;
3. běh „nic k uzavření ani k vyúčtování". Vypnutí obou přepínačů to hlásí
srozumitelně, audit sedí.

**Náklady domu: sloupec Kategorie a souhrn po kategoriích pod tabulkou** — tentýž
pohled, jaký má člen na telefonu. Do souhrnu jdou jen pravidelné a rozpouštěné
náklady; dvanáctinásobek jednorázové položky by kategorie rozhodil.

**Migrace 0010 není povinná** — výchozí hodnoty automatiky drží kód, do `settings`
se zapíšou při prvním přepnutí.

## 2026-08-20 — osobní přehled: měsíc po měsíci na první straně, zbytek do panelu

Zpětná vazba od uživatele: na první straně má být **aktuální stav a jednotlivé
měsíce má dáti / dal**. Roční náklady domu ani QR nejsou tak důležité, aby
zabíraly první obrazovku — patří pod hamburger, ale musí na ně jít prokliknout.

**První strana** = velké číslo „zbývá doplatit" + tabulka **Měsíc po měsíci**
(`maDalPoMesicich`): co měl ten měsíc poslat (záloha platná v tom měsíci)
× co v něm doopravdy přišlo na účet, s barevným stavem (zaplaceno / chybí X /
zatím nepřišlo / ještě není splatné). Pod tím součty a rovnou i výsledek.

**Součty musí sedět na číslo nahoře**, jinak stránka vypadá rozbitě. Do celkově
zaplaceného se počítá i to, co člověk pořídil **ze svého** — ve výpisu z účtu
to není, takže se přiznává zvlášť řádkem „Zaplaceno mimo účet".

**Panel pod hamburgerem**: QR platba, Moje platby, Můj podíl po měsících,
Náklady domu na rok. Z první strany se do každé sekce dá prokliknout
(`data-otevri`), panel na ni rovnou odscrolluje. Zavírá se křížkem, klikem
mimo i Escapem; pozadí se pod ním nescrolluje.

Ověřeno lokálně na vzorku (březen–srpen, jeden měsíc částečně, jeden vynechaný):
36 700 − 21 200 = 15 500 sedí na velké číslo, na první straně nezůstal QR,
graf ani položky nákladů.

## 2026-08-20 — nasazení: chybějící migrace a neviditelný odkaz

Při nasazování vyplavaly dvě věci, obě starší než dnešek:

**`d1 execute --remote --file` neprojde** — Cloudflare vrací `Authentication error
[code: 10000]`, protože `--file` jde přes *import* endpoint a ten OAuth token
wranglera odmítá. **Funguje `--command`.** Kvůli tomu nikdy neproběhla ani
migrace **0008** (`members.view_token`), takže „Vytvořit odkaz" v ostré databázi
padalo od začátku. Doplněno po jednotlivých příkazech; schéma je teď kompletní
(0001–0009 ověřeno proti `sqlite_master` a `pragma_table_info`).

**`nactiOsoby` nevybíralo `view_token`**, takže Nastavení nepoznalo, že osoba
odkaz už má: klik odkaz vytvořil, stránka se načetla a vypadala stejně —
zvenčí to působilo, že tlačítko nereaguje. Opraveno; ověřeno lokálně, že se
vytvoření i zrušení hned projeví.

**Nastavení po sobě nechávalo stopu jen v datech, ne na obrazovce.** „Uložit
identifikaci" i práce s odkazem končily prostým `location.reload()`, takže se
stránka načetla stejná a vypadalo to, že se nic nestalo. Teď se stejně jako
u Nákladů domu přesměruje na `?stav=…` a nahoře je zelený pruh s tím, co se
stalo; tlačítka se během ukládání zamknou a hlásí „ukládám…".

**Osobní odkaz se ukazoval jen jako cesta** `/v/…`, takže bez ručního doplnění
domény nešel poslat. V poli je teď celá adresa (`url.origin` z requestu),
kopíruje se přesně to, co je vidět.

**Ikona do ouška prohlížeče** (`FAVICON` v `ui.ts`) — SVG přímo v adrese,
žádný další požadavek. Je na všech stránkách včetně `/v/` a přihlášení.

**Chybová hláška říká pravdu** (`popisChyby` v `index.ts`). Dnešní *„Uložení se
nepovedlo, zkus to prosím znovu"* u chybějícího sloupce lhala — opakování
nepomůže. Teď se chybějící schéma, porušená jedinečnost a výpadek databáze
rozliší a každá varianta řekne, co s tím; do správy se dostane jen přihlášený
admin, takže vidí i technický detail. Rozbitá **stránka** je stránka, ne JSON.

Osobní přehled `/v/…` má vlastní záchyt: člen domácnosti dostane srozumitelnou
větu bez vnitřku databáze, podrobnost jde do logu Workeru. Předtím byl mimo
`try` a spadl by do holé hlášky Workeru.

Ověřeno lokálně přejmenováním tabulky `vyuctovani`: stránka vrátí 500 s větou
o chybějícím schématu a `D1_ERROR: no such table: vyuctovani`, `/v/` vrátí
klidnou hlášku. Po vrácení tabulky všechno zase 200.

**Sonda do Fio hlásila `HTTP 500` — byl to výpadek na straně banky, ne chyba
u nás.** Při dalším běhu prošla: token má 64 znaků, `column25` vyplněný u všech
3 pohybů, párování podle VS i podle komentáře drží. Sonda teď navíc popíše
token, aniž by ho vypsala (délka a jestli se do něj nesvezla uvozovka nebo
mezera), a u chyby vypíše, co Fio poslalo v těle. `src/fio.ts` rozlišuje 500
zvlášť a v Logu synchronizace vysvětlí, že se nic neztratilo — stahuje se za
celé období, takže další běh výpadek dožene.

## 2026-08-20 — vyúčtování období (bod 4 z dohodnutého pořadí)

Kruh se uzavřel: záloha × skutečnost se teď dá **srovnat a rozdíl rozpustit
do nové zálohy**, aby trvalý příkaz mohl zůstat fixní.

**Nová stránka `/admin/vyuctovani`** (`src/settlement-page.ts`):
- Vyúčtovat jde jen **uzavřené a navazující** měsíce od počátku sledování —
  z otevřeného měsíce se počítá dnešními čísly a vyúčtování by se zpětně měnilo.
  Konec období si admin vybere ze seznamu.
- U každého: předepsané zálohy / skutečně zaplaceno / skutečný podíl → rozdíl.
- **Rozpustit do zálohy** (rozdíl / 12 k nové záloze) × **doplatit jednorázově**.
  Nedoplatek nad `prah_doplatku` appka sama rozpustit nenavrhne, radši se zeptá.
  Částku zálohy jde přepsat ručně — appka ji nikdy nestanoví sama.
- Uložení jde **jednou dávkou**: zamražené řádky + nové zálohy od dalšího měsíce
  + posun `vyuctovani_od` + audit. Čísla se počítají znovu na serveru, z prohlížeče
  se berou jen rozhodnutí.
- Zrušit jde **jen poslední** vyúčtování (starší by se nedalo vrátit, aniž by se
  novější počítalo dvakrát); sledování se vrátí na začátek období, zálohy zůstanou.

**Dvě věci, které by jinak tiše lhaly:**
1. **Platby se berou za období** (`zaplacenoOsobami` má okno). Bez toho by se peníze
   zúčtované v minulém období odečítaly od dluhu i v tom dalším — donekonečna.
2. **Vklad ze svého se počítá po měsících**, ne celou částkou (`vlozenoZeSveho`).
   Uhlí za 42 000 se rozpouští po 3 500, takže se dědovi po 3 500 i připisuje;
   jinak by v měsíci nákupu skočil do obřího přeplatku.

**Komu se co eviduje:** u toho, od koho příspěvky na účet nechodí, se **dluh
nesleduje** (drží se dřívější rozhodnutí — narůstající číslo by nic neznamenalo).
Peníze, které do domácnosti opravdu dal, se ale zapsat musí, takže se u něj
ukládá jen **záporný** zůstatek = pohledávka. Ve Vyrovnání i na osobním přehledu
je zůstatek z vyúčtování vidět zvlášť, mimo zálohu.

**Ověřeno lokálně** proti místní D1 s daty (`wrangler dev`, DEV_ADMIN):
uzavřeno 2026-01 – 2026-08, vyúčtováno oběma způsoby a zrušeno.
- Rozpuštění: Lucka předepsáno 48 700, zaplaceno 42 200, skutečnost 45 851 →
  nedoplatek 3 651; záloha 6 900 (ze samotných nákladů) → 7 200 s rozdílem. Sedí ručnímu propočtu.
- Jednorázově: zůstatek 3 651 se objevil ve Vyrovnání i na `/v/{token}` včetně QR.
- Pohledávka: nákup 30 000 dědou ze svého → −25 678 zapsáno, „má k dobru" ve Vyrovnání.
- Zrušení vrátilo `vyuctovani_od` zpátky. Všech 11 stránek adminu 200, typecheck OK.

**Opraveno při testu:** vyúčtování zakládalo nulovou zálohu i tomu, kdo žádnou
neplatí — v historii záloh by ta nula přebila starší platnou částku.

**Nasazení — dělá uživatel:**
```powershell
npx wrangler d1 execute fio-uhrady --remote --file schema/0009_vyuctovani.sql
npm run deploy
```

**Zbývá:** AI (6) — čtení účtenek a komentář k vývoji, dál e-maily přes Resend,
import CSV a Cloudflare Access místo PINu.

## 2026-08-20 — zálohy, rozpouštění, uzávěrky a osobní přehled

Zadání se upřesnilo do modelu **záloh a vyúčtování** (jako u energií):
fixní částka na trvalý příkaz, rozdíl proti skutečnosti se srovná při
vyúčtování a rozpustí do nové zálohy, aby příkaz mohl zůstat fixní.
Dohodnuté pořadí prací: rozpouštění → zálohy → uzávěrky → roční vyúčtování →
stránka pro člena → AI.

**Hotovo (1, 2, 3, 5):**
- **Rozpouštění** — nákup není spotřeba. U položky se zadá, přes kolik měsíců
  a od kterého se rozpouští (uhlí 42 000 / 12 = 3 500 měsíčně). Mimo své okno
  položka do nákladů nevstupuje a po doběhnutí zmizí sama.
- **Kdo zaplatil ze svého** (`zdroj_uhrady`) — komu se částka připíše jako vklad.
  Bez tohoto rozlišení by se náklad počítal dvakrát: jako výdaj i jako vklad.
- **Zálohy** (`zalohy`) — fixní měsíční částka, historie se nepřepisuje.
  Dluh = záloha × měsíce po splatnosti − zaplaceno. Návrh počítá appka
  (odhad na 12 měsíců + rezerva, výchozí 10 %, nahoru na stovky), **stanoví admin**.
- **Splatnost** — měsíc se do dluhu započítá až dnem splatnosti (výchozí 20.).
- **Uzávěrky** (`uzaverky`) — zamrazí náklady, podíly, zálohy i soupis položek.
  Uzavřený měsíc se z aktuálního nastavení nepřepočítává.
- **Osobní přehled** `/v/{token}` — mobilní, veřejný na neuhodnutelném odkazu,
  který se vytvoří v Nastavení u kterékoli osoby. Zbývá doplatit velkým písmem,
  **QR platba (SPAYD)**, graf podílu po měsících, vlastní platby, náklady domu
  na rok po kategoriích a **položky s vlastním podílem**. O ostatních nic.
- **Číslo účtu, IBAN a zůstatek** si appka bere z Fio API, neopisuje se ručně.

**Chyby nalezené a opravené při testování** (všechny by tiše zkreslovaly čísla):
1. Jednorázové položky se při součtu přes víc měsíců počítaly do každého měsíce.
2. Stránka Vyrovnání nedostávala uzávěrky, takže zamrazení nefungovalo.
3. Kategorie ročních nákladů nesouhlasily s celkem (jednorázové × 12).
4. Uložení beze změny zapisovalo nový záznam do historie.

**Zbývá:** roční vyúčtování (4) a rozpuštění rozdílu do nové zálohy, **AI** (6)
— čtení účtenek a komentář k vývoji, dál e-maily přes Resend, import CSV
a Cloudflare Access místo PINu.

## 2026-08-19 — banka napojená, přihlášení PINem, živý provoz

**https://fio-uhrady.bass443.workers.dev** — commit `fa1e32c`.

**Napojení na Fio ověřené proti reálnému účtu** (3 pohyby, běh syncu):
VS v příkazu → přiřazeno podle VS; VS chybí a je dopsaný v komentáři u pohybu →
přiřazeno z komentáře; ani jedno → zůstane nepřiřazené a čeká na ruční přiřazení.
Tím padla poslední nepotvrzená domněnka celého návrhu.

- `src/fio.ts` + `src/sync.ts` — `periods/` s překryvem, dedup podle ID pohybu,
  každý běh (i prázdný, i spadlý) v `sync_runs` se srozumitelným popisem.
  Ruční přiřazení (`matched_by = 'rucne'`) automatický běh nepřepíše.
- Stránka **Úhrady z Fio** — co přišlo, komu to patří a **čím** se to poznalo.
- **Přihlášení PINem** (`src/auth.ts`) jako záloha, když není Access. PIN se neukládá,
  jen otisk PBKDF2 (100k iterací) se solí; po 5 chybách zámek na 15 min, po 10 na hodinu;
  cookie podepsaná HMAC, platnost 12 h. Access má dál přednost — dává e-mail do auditu.
  PIN se mění `node scripts/set-pin.mjs <pin>` → SQL do D1.
- Kořen `/` je veřejný rozcestník, ne holá věta.

**Ověřeno na živé adrese:** `/admin` bez přihlášení 302 → `/admin/prihlaseni`,
špatný PIN 401, správný 303 + cookie, `/admin` s cookie 200.

**Ostrá databáze je prázdná** (schéma + PIN, žádná data). Výplň volitelně:
`npx wrangler d1 execute fio-uhrady --remote --file schema/seed_priklad.sql`.

**Další v pořadí (zadané, nepostavené):**
1. **Resend + e-maily** — u každé osoby e-mail a příznak *admin*; rozesílá se celkové
   vyúčtování za všechny, nebo jen za ty, které admin vybere.
2. **Stránka pro Lucku** — měsíční závazek, jeho vývoj v čase, historie a **QR platba**
   (SPAYD; potřebuje číslo účtu domácnosti v nastavení).
3. **MFA jako volba v Nastavení** (dvoufaktor k PINu).
4. Import CSV zpátky, předpisy a porovnání „kolik měla × kolik zaplatila".

## 2026-08-19 — ŽIVĚ na Cloudflare

**https://fio-uhrady.bass443.workers.dev** — nasazeno, commit `34f0fdd`.

- D1 `fio-uhrady` (region EEUR, id `7f116705-6320-4ea2-9f89-5722800d8efa`), schéma nahrané.
  **Databáze je prázdná** — ukázková data se nenasazují sama; kdo je chce, pustí
  `npx wrangler d1 execute fio-uhrady --remote --file schema/seed_priklad.sql`.
- Ověřeno naživo: `/api/version` vrací `34f0fdd` (sedí s gitem), `/api/health` hlásí `db: ok`,
  `/admin` vrací **403** — Cloudflare Access ještě není nastavený a aplikace je fail-closed.
- V hlavičce běží čas a je vidět nasazený commit.

**BLOKUJE:**
1. **Cloudflare Access** na `/admin` — bez něj se do správy nedostane nikdo (ani vlastník).
   Zero Trust → Access → Applications → aplikace na `fio-uhrady.bass443.workers.dev/admin`.
2. **Cron trigger nenasazen** — účet bass443 má vyčerpaný free limit **5 cron triggerů na účet**
   (Cloudflare error 10072). V `wrangler.jsonc` je proto zakomentovaný. Před zapnutím syncu z Fio
   je potřeba buď Workers Paid, nebo uvolnit cron u jiného Workeru; do té doby se bude
   stahování spouštět ručně z admina.

## 2026-08-19 — admin napojený na databázi, nastavení s VS, audit

Admin už nekreslí ukázková data — čte a zapisuje do D1.

**Hotové a ověřené lokálně (proti místní D1 se schématem i výplní):**
- `src/db.ts` — čtení přehledu, uložení/smazání položky, VS u osob, token do Fio.
  **Žádný zápis bez záznamu do `audit_log`**: změna i její záznam jdou jednou `db.batch()`,
  takže nemůže vzniknout změna, u které není vidět kdo a kdy.
- `src/ui.ts` — společný shell (menu, hamburger, tokeny), stránky dodávají jen obsah.
- `/admin/nastaveni` — VS u každé osoby (podle něj se poznají platby), vložení tokenu do Fio
  a posledních 20 změn z logu. Uložený token se z databáze do UI nikdy nevrací, jen náznak `••••1234`.
- `/admin/export.csv` — středníky, BOM a desetinná čárka, aby to Excel otevřel rovnou.
- Zápis přijímáme jen z vlastní stránky (kontrola `Origin`) — ověřeno, že bez ní přijde 403.
- Ověřeno naživo: `/api/health` hlásí 14 položek, souhrn z databáze sedí na dřívější ruční propočet
  (10 626 Kč/měs, saldo +9 632 Kč), úprava položky se zapsala a objevila se v auditu,
  kolize VS i nesmyslný VS vrací srozumitelnou hlášku, krátký token appka odmítne.
- Opraveno: rozdělení procent se dopočítává metodou největšího zbytku, takže „rovným dílem"
  u 299 Kč nenechá viset haléř a nesvítí „nerozděleno −0 Kč".

**Zbývá k tomuhle kroku:** import CSV zpátky (export hotový), stránka Osoby (zakládání osob),
Log synchronizace jako samostatná stránka.

**Nasazení — dělá uživatel** (AI nesahá na ostrá data ani nezakládá zdroje):
```powershell
npx wrangler d1 create fio-uhrady                                    # database_id → wrangler.jsonc
npx wrangler d1 execute fio-uhrady --remote --file schema/0001_init.sql
npx wrangler d1 execute fio-uhrady --remote --file schema/seed_priklad.sql   # volitelné
npm run deploy
```
Pak Cloudflare Access na `/admin` a token do Fio vložit v Nastavení.

## 2026-08-19 — admin v IT-ops shellu, podíly na osoby, jednorázové položky

**Vzhled:** převzatý ze [Interface-Par](https://github.com/Anamax443/Interface-Par) — hustý WinBox shell
(titulní lišta → boční menu → toolbar → grid → stavový řádek), tokeny `:root` odtamtud.
**Material UI se nepoužilo**, a to podle rozboru v tom samém repu: MUI se vyplatí až u resize
a přeuspořádání sloupců myší, inline editace buňky a virtualizovaného scrollu přes tisíce řádků.
Tady je 14 položek a CSS vrstva by zůstala stejná. Kdyby přišel požadavek na DataGrid, je to
přechod na Vite + React + `@mui/x-data-grid` a bundle ~380 kB gzip.

**Model — zásadní oprava:** podíly ukazují na **osoby**, ne na pevné platební jednotky.
Kombinace se u každé položky liší (Lucka s dědou, Eliška s dědou, máma s Luckou), takže pevné
skupiny nefungují. Kdo platí ze svého účtu za koho (a pod jakým VS) je samostatná vrstva
a řeší se až s napojením plateb z Fio.

**Druhy položek:** `pravidelny` (jde do měsíčního průměru) × `jednorazovy` / `nedoplatek` /
`preplatek` (nejdou do průměru, jdou rovnou do dlužné částky; přeplatek se znaménkem mínus).

**Hotové a ověřené:** typecheck OK, `wrangler dev` vrátil `/admin` 200; součty osob dají přesně
celek (10 626 Kč/měs = máma 2 622 + děda 462 + Lucka 5 426 + Eliška 2 116) a jednorázové saldo
+9 632 Kč sedí (nedoplatek 4 312 − přeplatek 1 180 + oprava 6 500). Mobil: hamburger, výsuvné
menu, detail pod seznamem, na úzkém displeji se sloupce osob skrývají a nese je detail.

**Zadání, které přišlo a ještě není postavené:**
1. **Přehledová stránka je hlavně pro Lucku** — kolik činí její měsíční závazek, že se v čase mění
   a jak vypadal historicky (graf + historie, ne jen aktuální číslo).
2. **Token do Fio se zadává v adminu** (Nastavení), ne jen `wrangler secret`. Pozor: token v D1 je
   citlivý — zapsat, číst jen pro sync, v UI nikdy nezobrazovat celý, jen poslední znaky + „přepsat".
3. **Export do CSV pro Excel a zpětný import** téhož.
4. **Každá změna se loguje s identifikací** — kdo (e-mail z Cloudflare Access), kdy, co se změnilo
   z čeho na co. Tabulka `audit_log`, zapisuje se ve stejné transakci jako změna.

## 2026-08-19 — frontend admina (náklady domu)

Zadání upřesněno: appka nemá jen párovat platby, ale nejdřív **evidovat náklady domu** —
ze stránky musí být vidět celkové náklady a kolik z nich padá na jednotlivé členy.
Postup podle uživatele: **nejdřív frontend admina, vazby (databáze) až potom.**

**Model:** osoby (máma, děda, Lucka, Eliška) × **platební jednotky**. Jednotka je jeden člověk
nebo kumulace („máma + Eliška"); dělí se na jednotky, protože od jednotky chodí platba s jedním VS.
Rozpad je **per položka**, ne globální procento — děda může mít jen stočné a uhlí.
Podíl se zadává procentem nebo pevnou částkou. Zbytek se ukazuje jako „nerozděleno".

**Hotové:**
- `src/money.ts` — haléře, periody → měsíční ekvivalent, rozpad na jednotky.
- `src/admin-page.ts` — přehled: souhrnné dlaždice, matice položka × jednotka, formulář položky.
- `src/index.ts` — `/admin` fail-closed za Cloudflare Access (`ctx.access`); `DEV_ADMIN`
  funguje jen na localhostu, takže ani omylem nasazená proměnná ochranu neobejde.
- Schéma 0001 přepsáno (nikde nenasazené, tak se nemigruje): `members`, `units`,
  `unit_members`, `cost_items`, `cost_shares`; `payers` → `units`.
- Ověřeno: typecheck OK, `wrangler dev` vrátil `/admin` 200 a souhrn sedí ručnímu propočtu
  (Lucka 5 839 + máma & Eliška 4 787 = 10 626 Kč měsíčně na vzorových datech).

**Rozpracované:** stránka se kreslí z `src/sample.ts`; ukládání je vypnuté a je to na stránce vidět.

**Další krok:** vazba na D1 — `nactiPrehled()` místo `vzorovyPrehled()`, POST handlery
položky a jednotek, CSRF/origin kontrola u zápisů.

**Otevřené k doptání:** v tabulce „Náklady bydlení" je Celkem 6 909 Kč, ale součet sloupce
„mé náklady" je 13 530 Kč a jeho měsíční ekvivalent 6 626 Kč — ani jedno nesedí; ujasnit,
jak se to počítalo, ať přehled navazuje na to, co uživatel zná.

## 2026-08-19 — kostra Workeru stojí a ověřená

Doména: stačí `fio-uhrady.bass443.workers.dev`, vlastní zatím ne.

**Hotové a ověřené lokálně:**
- `wrangler.jsonc` (D1 binding `DB`, cron `*/15`, observability, `GIT_COMMIT` var), `package.json`, `tsconfig.json`.
- `src/index.ts` — `/api/version`, `/api/health`; `/admin/*` a `/v/*` zatím poctivě vrací 503 „nepostaveno".
- `schema/0001_init.sql` — 7 tabulek, pustěno proti **lokální** D1, tabulky sedí.
- `npm run typecheck` prochází; `wrangler dev` odpověděl `{"commit":"dev"}` a `{"db":"ok"}`.
- `scripts/deploy.mjs` — otiskne krátký hash commitu do `/api/version`, odmítne špinavý strom.

**Nenasazeno.** Ostrá D1 nevytvořená (`database_id` ve wrangler.jsonc je placeholder), Access nenastavený.
Na Cloudflare zatím nevzniklo nic — žádný Worker, žádná databáze.

**Čeká na uživatele — bez toho se nedá dál:**
1. **Read-only token z Fio** → `.dev.vars` → `npm run probe`. Sonda musí potvrdit `column25`.
   Když v posledních 30 dnech není u žádné platby komentář, dopsat ho v internetbankingu k jedné
   a spustit znovu — jinak nepoznáme „pole neexistuje" od „nikdo ho nevyplnil".
2. **Ostrá D1:** `npx wrangler d1 create fio-uhrady` → `database_id` doplnit do `wrangler.jsonc`.
3. **Cloudflare Access** na `/admin` (Zero Trust → Access → Applications), až bude co chránit.

Zápisy do databáze i vytváření zdrojů na Cloudflare dělá uživatel; AI dodá hotové bloky k spuštění.

**Stav roadmapy** (číslování podle záznamu níž): 1 ⏳ čeká na token · 2 ✅ hotovo · 3–6 ⚪ nezačato ·
7 ✅ docs/BUILD.md napsán (doplní se po prvním ostrém nasazení).

**Stav gitu k tomuto záznamu:** `6b90450` na `origin/main`, pracovní strom čistý.

## 2026-08-19 — zadání a návrh

Cíl: přehled uhrazeno / dlužno proti reálným pohybům na účtu Fio banky. Dvě stránky — admin za 2FA a read-only přehled s grafem a exportem.

**Rozhodnuto:**
- Stack: Cloudflare Worker + D1 + Cron Trigger. Nasazení ručně (`npm run deploy`), žádné CI.
- Admin za **Cloudflare Access** (2FA řeší Cloudflare, v kódu žádná hesla).
- Přehled na **odkazu s neuhodnutelným tokenem** (`/v/{view_token}`), bez loginu, jen čtení + export.
- Předpisy = **paušál + jednorázové položky**.
- Jména plátců: default **pseudonymy / VS**, reálná jména **přepínatelná v nastavení**.
- Párování: VS → komentář vlastníka účtu (`column25`) → zpráva pro příjemce (`column16`) → uživatelská identifikace (`column7`) → ruční. Z textových polí se berou jen čísla, která odpovídají evidovanému VS. Každé párování nese stopu `matched_by`.
- Stahování přes `periods/` s překryvem a dedupem podle ID pohybu — **ne** `last/` (kurzor v bance se posune i při chybě a pohyby by tiše zmizely).

**Hotové:**
- Repo založené podle standardu, README + docs/ARCHITECTURE.md popisují návrh.
- `scripts/fio-probe.mjs` — sonda pro ověření jádra (jen čte).

**Rozpracované:** —

**Zbývá — v tomto pořadí:**
1. **Ověřit jádro:** read-only token z Fio → `.dev.vars` → `node scripts/fio-probe.mjs`. Potvrdit, že API vrací `column25` (komentář dopsaný vlastníkem účtu v internetbankingu). Dokud tohle nesedí, záložní párování z poznámky nestavět.
2. Kostra Workeru + D1 schéma (`payers`, `plans`, `charges`, `payments`, `allocations`, `settings`, `sync_runs`).
3. Cron sync z Fio + dedup.
4. Matcher + fronta nespárovaných.
5. Admin UI za Access.
6. Přehled: souhrn, graf, výpis, export CSV + tisk.
7. docs/BUILD.md — postup od nuly.
