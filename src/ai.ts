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
 * Modely nabízené v Nastavení. Cloudflare katalog průběžně mění a vyřazuje,
 * takže seznam je vidět tady a dá se opravit jedním commitem; co účet zrovna
 * umí, vypíše `npx wrangler ai models`.
 *
 * **Model se volí, nededí se.** Na dotazy nad tabulkou je 8B model prokazatelně
 * slabý — na „kolik platí máma" si vymyslel rozpad 2 000 + 350 + 205 Kč,
 * který v datech není. Proto je výchozí 70B.
 */
export interface AiModel {
  id: string;
  backend: AiBackend;
  popis: string;
  /** „přemýšlí nahlas" — vnitřní úvaha se počítá do max_tokens, potřebuje strop navíc */
  uvazuje?: boolean;
}

export const AI_MODELY: AiModel[] = [
  {
    id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    backend: 'workers-ai',
    popis: 'Llama 3.3 70B — výchozí: nejlepší poměr přesnosti a rychlosti, zdarma',
  },
  {
    id: '@cf/meta/llama-3.1-8b-instruct-fp8',
    backend: 'workers-ai',
    popis: 'Llama 3.1 8B — nejlevnější na neurony, ale u dotazů nad tabulkou si vymýšlí čísla',
  },
  {
    id: '@cf/openai/gpt-oss-120b',
    backend: 'workers-ai',
    popis: 'gpt-oss 120B — nejsilnější zdarma, uvažuje nahlas (pomalejší, žere strop tokenů)',
    uvazuje: true,
  },
  { id: 'claude-opus-5', backend: 'anthropic', popis: 'Claude Opus 5 — nejlepší, placený' },
  { id: 'claude-sonnet-5', backend: 'anthropic', popis: 'Claude Sonnet 5 — levnější než Opus, placený' },
  {
    id: 'claude-haiku-4-5-20251001',
    backend: 'anthropic',
    popis: 'Claude Haiku 4.5 — nejlevnější Claude, na tyhle dotazy bohatě stačí',
  },
];

/** Výchozí model backendu — první v seznamu, který k němu patří. */
export const vychoziModel = (b: AiBackend): string =>
  AI_MODELY.find((m) => m.backend === b)?.id ?? (AI_MODELY[0] as AiModel).id;

/**
 * Model pro daný backend. Když uložená volba patří jinému backendu (typicky
 * po přepnutí Workers AI ↔ Claude), vezme se výchozí — jinak by volání spadlo
 * na neznámém ID.
 */
export function modelProBackend(zvoleny: string | undefined, b: AiBackend): string {
  const model = AI_MODELY.find((m) => m.id === zvoleny);
  return model?.backend === b ? model.id : vychoziModel(b);
}

export interface AiKontext {
  /** '' | 'workers-ai' | 'anthropic' | 'off' */
  volba: string;
  /** id modelu z `AI_MODELY`; prázdné = výchozí pro zvolený backend */
  model?: string;
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
  model = '',
): AiKontext {
  return { volba: volba ?? '', model, ai: env.AI, klic: klicZNastaveni ?? env.ANTHROPIC_API_KEY };
}

/** Lidský štítek do hlavičky a do logu — ať je poznat, čím se to počítalo. */
export function popisBackendu(b: AiBackend | null, model?: string): string {
  const jmeno = model ? ' · ' + model : '';
  if (b === 'workers-ai') return 'Cloudflare Workers AI (zdarma)' + jmeno;
  if (b === 'anthropic') return 'Claude (placené)' + jmeno;
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
export function prvniJson<T>(vstup: unknown): T | null {
  // Některé modely nevrací `response` jako řetězec, ale rovnou objekt.
  // Bez tohohle spadne `.indexOf` a chyba vypadá jako rozbitý backend.
  if (vstup !== null && typeof vstup === 'object') return vstup as T;
  const text = String(vstup ?? '');
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
async function zdarma<T>(
  ai: Ai,
  model: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<T> {
  const sys = `${system}\n\nOdpověz VÝHRADNĚ jedním JSON objektem podle popisu — bez markdownu, bez úvodní věty, bez komentáře.`;
  // Uvažující model spotřebuje strop vnitřní úvahou a na odpověď mu nezbude;
  // vrátí prázdno a vypadá to jako chyba backendu.
  const strop = AI_MODELY.find((m) => m.id === model)?.uvazuje === true ? maxTokens * 4 : maxTokens;
  const odpoved = (await ai.run(model as Parameters<Ai['run']>[0], {
    temperature: 0,
    max_tokens: strop,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
  } as never)) as { response?: unknown };
  const objekt = prvniJson<T>(odpoved.response ?? '');
  if (objekt === null) throw new ChybaAi('Model ' + model + ' nevrátil JSON.');
  return objekt;
}

/** Zavolá placený backend a vrátí naparsovaný JSON. */
async function placene<T>(
  klic: string,
  model: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<T> {
  const odpoved = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': klic,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0,
      system: `${system}\n\nOdpověz výhradně jedním JSON objektem podle popisu.`,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!odpoved.ok) {
    const telo = (await odpoved.text().catch(() => '')).slice(0, 300);
    throw new ChybaAi(`Claude (${model}) odpověděl ${odpoved.status}. ${telo}`);
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
  /** id modelu, který odpověděl — bez něj nejde poznat, čím se to počítalo */
  model?: string;
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
  let pouzityModel = '';
  for (const backend of poradi) {
    try {
      const model = modelProBackend(k.model, backend);
      const data =
        backend === 'workers-ai'
          ? await zdarma<T>(k.ai as Ai, model, system, user, maxTokens)
          : await placene<T>(k.klic as string, model, system, user, maxTokens);
      // Když se to povedlo až napodruhé, musí to být vidět — jinak vypadá
      // odpověď ze záskoku stejně jako ta, o kterou si člověk řekl.
      pouzityModel = model;
      return potize.length > 0
        ? { data, backend, model: pouzityModel, zaskok: potize.join(' · ') }
        : { data, backend, model: pouzityModel };
    } catch (err) {
      potize.push(`${popisBackendu(backend)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new ChybaAi(potize.join(' · '));
}
