/**
 * Přepínatelný AI backend — stejný princip jako u JobWatche a FIO-importu.
 *
 *   - `workers-ai` — Cloudflare Workers AI, Llama 3.1 8B. **Zdarma** (free tarif
 *     dá 10 000 neuronů denně), nativní binding, data neopustí Cloudflare. Výchozí.
 *   - `anthropic`  — Claude (placený, přesnější). Volitelný, jen když je klíč.
 *
 * Přepínač je v Nastavení (`settings.ai_provider`), server má jen výchozí hodnotu:
 *
 *   ''/auto      → zdarma primárně, placený jen když free binding chybí
 *   'workers-ai' → jen zdarma, nikdy placené volání
 *   'anthropic'  → placený primárně, zdarma jako záchrana
 *   'off'        → AI vypnutá úplně
 *
 * **Appka sama nikdy neutrácí.** Bez výslovné volby `anthropic` se placený backend
 * použije jedině tehdy, když free binding vůbec není k dispozici.
 */

export type AiBackend = 'workers-ai' | 'anthropic';

/** Povolené hodnoty přepínače. '' = podle serveru (auto). */
export const AI_VOLBY = ['', 'workers-ai', 'anthropic', 'off'] as const;

/**
 * Malý instruct model. JSON se vynucuje promptem — free backend nemá structured
 * outputs. 8B je levné na neurony, takže se komentář vejde do free tarifu.
 */
export const MODEL_ZDARMA = '@cf/meta/llama-3.1-8b-instruct-fp8';

/** Model pro placený backend. Haiku stačí a je nejlevnější. */
export const MODEL_CLAUDE = 'claude-haiku-4-5-20251001';

export interface AiKontext {
  /** '' | 'workers-ai' | 'anthropic' | 'off' */
  volba: string;
  /** Workers AI binding — free backend */
  ai?: Ai;
  /** ANTHROPIC_API_KEY — placený backend */
  klic?: string;
}

/**
 * Pořadí backendů. Prázdný seznam znamená „AI je vypnutá nebo není čím počítat" —
 * volající to musí umět a říct to člověku, ne spadnout.
 */
export function poradiBackendu(k: AiKontext): AiBackend[] {
  const volba = (k.volba ?? '').trim().toLowerCase();
  const maKlic = Boolean(k.klic);
  const maFree = Boolean(k.ai);

  if (volba === 'off') return [];
  if (volba === 'workers-ai') return maFree ? ['workers-ai'] : [];
  // Placený primárně, ale se záchranou na free — kdyby Claude spadl, ať to projde.
  if (volba === 'anthropic') {
    return [...(maKlic ? (['anthropic'] as const) : []), ...(maFree ? (['workers-ai'] as const) : [])];
  }
  // Auto: zdarma a nikdy sám neutrácej. Placený jedině, když free binding chybí.
  return maFree ? ['workers-ai'] : maKlic ? ['anthropic'] : [];
}

/**
 * Kontext z prostředí a nastavení. Jedno místo, ať health i výpočet
 * rozhodují stejně.
 */
export function ctxAi(
  env: { AI?: Ai; ANTHROPIC_API_KEY?: string },
  volba: string,
  /** klíč vložený v Nastavení; má přednost před secretem z prostředí */
  klicZNastaveni: string | null = null,
): AiKontext {
  return { volba: volba ?? '', ai: env.AI, klic: klicZNastaveni ?? env.ANTHROPIC_API_KEY };
}

/** Lidský štítek do hlavičky a do logu — ať je poznat, čím se to počítalo. */
export function popisBackendu(b: AiBackend | null): string {
  if (b === 'workers-ai') return 'Cloudflare Workers AI (zdarma)';
  if (b === 'anthropic') return 'Claude (placené)';
  return 'AI vypnutá';
}

/** Co se ukáže v Nastavení u přepínače. */
export function popisVolby(volba: string, maFree: boolean, maKlic: boolean): string {
  const v = (volba ?? '').trim().toLowerCase();
  if (v === 'off') return 'AI je vypnutá — nic se nikam neposílá.';
  if (v === 'workers-ai') {
    return maFree
      ? 'Jen zdarma přes Cloudflare Workers AI. Placené volání nikdy nenastane.'
      : 'Zvoleno zdarma, ale binding na Workers AI chybí — AI zůstane nečinná.';
  }
  if (v === 'anthropic') {
    return maKlic
      ? 'Placený Claude; když selže, zkusí se ještě free backend.'
      : 'Zvolen Claude, ale klíč není uložený — poběží jen free backend.';
  }
  return maFree
    ? 'Automaticky: zdarma přes Workers AI. Placený backend se použije, jen kdyby free chyběl.'
    : maKlic
      ? 'Free backend není k dispozici, poběží placený Claude.'
      : 'Není čím počítat — chybí binding na Workers AI i klíč ke Claude.';
}

/** Vytáhne první úplný JSON objekt z textu (model ho rád obalí prózou nebo ```). */
export function prvniJson<T>(text: string): T | null {
  const vBlok = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const telo = vBlok?.[1] ?? text;
  const zacatek = telo.indexOf('{');
  const konec = telo.lastIndexOf('}');
  if (zacatek === -1 || konec === -1 || konec < zacatek) return null;
  try {
    return JSON.parse(telo.slice(zacatek, konec + 1)) as T;
  } catch {
    return null;
  }
}

export class ChybaAi extends Error {}

/** Zavolá free backend a vrátí naparsovaný JSON. */
async function zdarma<T>(ai: Ai, system: string, user: string, maxTokens: number): Promise<T> {
  const sys = `${system}\n\nOdpověz VÝHRADNĚ jedním JSON objektem podle popisu — bez markdownu, bez úvodní věty, bez komentáře.`;
  const odpoved = (await ai.run(MODEL_ZDARMA, {
    temperature: 0,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
  })) as { response?: string };
  const objekt = prvniJson<T>(odpoved.response ?? '');
  if (objekt === null) throw new ChybaAi('Workers AI nevrátila JSON.');
  return objekt;
}

/** Zavolá placený backend a vrátí naparsovaný JSON. */
async function placene<T>(klic: string, system: string, user: string, maxTokens: number): Promise<T> {
  const odpoved = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': klic,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL_CLAUDE,
      max_tokens: maxTokens,
      temperature: 0,
      system: `${system}\n\nOdpověz výhradně jedním JSON objektem podle popisu.`,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!odpoved.ok) {
    const telo = (await odpoved.text().catch(() => '')).slice(0, 300);
    throw new ChybaAi(`Claude odpověděl ${odpoved.status}. ${telo}`);
  }
  const data = (await odpoved.json()) as { content?: { type: string; text?: string }[] };
  const text = (data.content ?? []).map((c) => c.text ?? '').join('');
  const objekt = prvniJson<T>(text);
  if (objekt === null) throw new ChybaAi('Claude nevrátil JSON.');
  return objekt;
}

export interface VysledekAi<T> {
  data: T;
  backend: AiBackend;
  /**
   * Proč nevyšel backend, který měl odpovědět jako první. Prázdné, když se
   * povedlo napoprvé.
   *
   * Bez tohohle by vypršelý klíč ke Claude nikdo nepoznal: odpověď by tiše
   * dorazila z free backendu a vypadala úplně stejně jako placená.
   */
  zaskok?: string;
}

/**
 * Zeptá se prvního dostupného backendu; když selže, zkusí další v pořadí.
 *
 * Vrací i to, **čím** se to spočítalo — bez toho by nikdo nepoznal, jestli se
 * dívá na výstup z free modelu, nebo z placeného.
 */
export async function zeptejSe<T>(
  k: AiKontext,
  system: string,
  user: string,
  maxTokens = 600,
): Promise<VysledekAi<T>> {
  const poradi = poradiBackendu(k);
  if (poradi.length === 0) {
    throw new ChybaAi(
      'AI je vypnutá, nebo není čím počítat. Zapni ji v Nastavení — výchozí backend je zdarma.',
    );
  }

  const potize: string[] = [];
  for (const backend of poradi) {
    try {
      const data =
        backend === 'workers-ai'
          ? await zdarma<T>(k.ai as Ai, system, user, maxTokens)
          : await placene<T>(k.klic as string, system, user, maxTokens);
      // Když se to povedlo až napodruhé, musí to být vidět — jinak vypadá
      // odpověď ze záskoku stejně jako ta, o kterou si člověk řekl.
      return potize.length > 0 ? { data, backend, zaskok: potize.join(' · ') } : { data, backend };
    } catch (err) {
      potize.push(`${popisBackendu(backend)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new ChybaAi(potize.join(' · '));
}
