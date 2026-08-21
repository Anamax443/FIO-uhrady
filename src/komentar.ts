/**
 * Komentář k vývoji nákladů — první funkce postavená nad AI vrstvou.
 *
 * Model **nedostává jména osob ani čísla účtů**, jen náklady domu: kolik to
 * dělá měsíčně, jak se to vyvíjelo po uzavřených měsících a co jsou největší
 * položky. Není důvod posílat ven víc, než na co se ptáme.
 *
 * Výsledek se ukládá do nastavení i s časem a s tím, čím byl spočítaný —
 * jinak by nikdo nepoznal, jestli čte dnešní shrnutí z free modelu, nebo
 * půl roku starý text.
 */
import { spocitej } from './admin-page.js';
import type { Uzaverka } from './db.js';
import { formatKc, posunMesic } from './money.js';
import type { Prehled } from './model.js';
import { ChybaAi, zeptejSe, type AiKontext, type VysledekAi } from './ai.js';

export interface Komentar {
  /** jedna věta, která shrne celkový dojem */
  shrnuti: string;
  /** 2–4 konkrétní pozorování */
  body: string[];
}

const SYSTEM = [
  'Jsi pomocník, který komentuje náklady jedné domácnosti.',
  'Piš česky, věcně a bez marketingových frází. Žádné rady typu „zvažte úspory" bez opory v datech.',
  'PRAVIDLO: nepočítej. Žádné sčítání, odčítání, procenta ani průměry.',
  'Všechna čísla včetně podílů máš zadaná — používej je doslova tak, jak jsou napsaná.',
  'Položky jsou už započítané ve svých kategoriích, takže je nikdy nesčítej dohromady.',
  'Procento smíš uvést jedině doslova opsané ze zadání. Vlastní procenta nedopočítávej.',
  'Formát odpovědi: {"shrnuti": "jedna věta", "body": ["pozorování", "pozorování"]}',
  'Body ať jsou 2 až 4, každý nejvýš dvě věty a ať cituje konkrétní číslo ze zadání.',
].join(' ');

/**
 * Podklad pro model — čitelný text, ne JSON. Malé modely si s prózou poradí líp
 * a zároveň je pak v logu vidět přesně to, co se posílalo ven.
 */
export function podkladKomentare(
  prehled: Prehled,
  uzaverky: Map<string, Uzaverka>,
  ted = new Date(),
): string {
  const souhrn = spocitej(prehled, `${ted.getFullYear()}-${String(ted.getMonth() + 1).padStart(2, '0')}`);

  const kategorie = new Map<string, number>();
  for (const r of souhrn.radky) {
    if (r.castka === 0 || r.jednorazovy) continue;
    const klic = r.polozka.kategorie ?? 'Bez kategorie';
    kategorie.set(klic, (kategorie.get(klic) ?? 0) + r.castka);
  }

  // Podíl položky se dopočítá tady i vůči její kategorii — model si jinak
  // vymyslí procento, které nesedí ani na jedno.
  const nejvetsi = souhrn.radky
    .filter((r) => r.castka !== 0 && !r.jednorazovy)
    .sort((a, b) => b.castka - a.castka)
    .slice(0, 8)
    .map((r) => {
      const kat = r.polozka.kategorie ?? 'Bez kategorie';
      const vKategorii = kategorie.get(kat) ?? 0;
      const podilKat =
        vKategorii > 0 ? `, tedy ${Math.round((r.castka / vKategorii) * 100)} % kategorie ${kat}` : '';
      const podilCelku =
        souhrn.mesicneCelkem > 0
          ? ` a ${Math.round((r.castka / souhrn.mesicneCelkem) * 100)} % všech nákladů`
          : '';
      return `- ${r.polozka.nazev} (${kat}): ${formatKc(r.castka)} měsíčně${podilKat}${podilCelku}`;
    });

  // Vývoj z uzávěrek — zamražená čísla, takže se zpětně nemění.
  const mesice = [...uzaverky.keys()].sort();
  const vyvoj = mesice
    .slice(-12)
    .map((m) => `- ${m}: ${formatKc(uzaverky.get(m)?.naklady_celkem ?? 0)}`);

  // Podíly se počítají tady, ne v modelu. Malý model se u procent plete
  // a jednou už sečetl kategorii dohromady s položkou, která do ní patří.
  const celkem = souhrn.mesicneCelkem;
  const procent = (v: number): string =>
    celkem > 0 ? ` (${Math.round((v / celkem) * 100)} % celkových nákladů)` : '';

  const casti = [
    `Náklady domu celkem: ${formatKc(celkem)} měsíčně, ${formatKc(souhrn.rocneCelkem)} ročně.`,
    '',
    'Po kategoriích (měsíčně, podíly už spočítané):',
    ...[...kategorie.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([n, v]) => `- ${n}: ${formatKc(v)}${procent(v)}`),
    '',
    'Největší jednotlivé položky (měsíčně) — POZOR, každá už je započítaná',
    'v některé kategorii výše, takže je s kategoriemi nesčítej:',
    ...nejvetsi,
  ];

  if (vyvoj.length >= 2) {
    casti.push('', 'Uzavřené měsíce — celkové náklady domu:', ...vyvoj);
  } else {
    casti.push(
      '',
      'Uzavřených měsíců je zatím málo, vývoj v čase se z nich vyčíst nedá — o trendu nepiš.',
    );
  }

  const pristi = posunMesic(
    `${ted.getFullYear()}-${String(ted.getMonth() + 1).padStart(2, '0')}`,
    1,
  );
  casti.push('', `Následující měsíc je ${pristi}.`);
  return casti.join('\n');
}

/**
 * Čísla z textu, znormalizovaná (mezery a nedělitelné mezery pryč).
 * „8 000 Kč" i „8000 Kč" dají stejný token.
 */
function cislaV(text: string): string[] {
  // JS \s pokrývá i nedělitelnou a úzkou mezeru, kterými se sázejí tisíce.
  const bezMezer = text.replace(/\s/g, '');
  return bezMezer.match(/\d+/g) ?? [];
}

/**
 * Zahodí větu, ve které je číslo, co v podkladu není.
 *
 * Malý model si procenta vymýšlí i tehdy, když je dostane předpočítaná —
 * ověřeno na free Workers AI, kde tvrdil „57 % nákladů" u položky, která
 * tolik nedělá. Vymyšlené číslo v komentáři je horší než žádný komentář,
 * takže se takové věty prostě nepublikují.
 */
export function jenOverenaCisla(veta: string, podklad: string): boolean {
  const znameCislo = new Set(cislaV(podklad));
  // Rok a malá čísla (pořadí, „2 až 4") nechávám projít — nejsou to tvrzení o penězích.
  return cislaV(veta).every((c) => c.length <= 1 || znameCislo.has(c));
}

export async function zhodnotVyvoj(
  kontext: AiKontext,
  podklad: string,
): Promise<VysledekAi<Komentar>> {
  const vysledek = await zeptejSe<Komentar>(kontext, SYSTEM, podklad, 700);
  const data = vysledek.data;

  const shrnuti = String(data?.shrnuti ?? '').trim();
  const body = (Array.isArray(data?.body) ? data.body : [])
    .map((b) => String(b).trim())
    .filter(Boolean)
    .filter((b) => jenOverenaCisla(b, podklad))
    .slice(0, 4);

  // Když shrnutí obsahuje vymyšlené číslo, nastoupí první ověřená věta.
  // Radši kratší komentář než hezky znějící nesmysl.
  const shrnutiOk = shrnuti !== '' && jenOverenaCisla(shrnuti, podklad);
  if (!shrnutiOk && body.length === 0) {
    throw new ChybaAi(
      'Model vrátil jen tvrzení s čísly, která v datech nejsou. Zkus to znovu, ' +
        'nebo v Nastavení přepni backend — free model si u procent občas vymýšlí.',
    );
  }

  return {
    backend: vysledek.backend,
    data: {
      shrnuti: shrnutiOk ? shrnuti : (body.shift() as string),
      body,
    },
  };
}

export interface UlozenyKomentar {
  shrnuti: string;
  body: string[];
  /** ISO čas, kdy vznikl */
  kdy: string;
  /** čím byl spočítaný */
  backend: string;
}

export function precistKomentar(hodnota: string | null): UlozenyKomentar | null {
  if (!hodnota) return null;
  try {
    const o = JSON.parse(hodnota) as UlozenyKomentar;
    if (typeof o?.shrnuti !== 'string') return null;
    return { ...o, body: Array.isArray(o.body) ? o.body : [] };
  } catch {
    return null;
  }
}
