/**
 * FIO-uhrady — Worker.
 *
 * Hotové: správa nákladů domu nad D1 (položky, rozdělení mezi osoby, audit),
 * nastavení s identifikací plateb podle VS a uložením tokenu do Fio,
 * export do CSV.
 *
 * Rozvržení cest viz README.md, pravidla párování viz docs/ARCHITECTURE.md.
 */
import { renderNaklady } from './admin-page.js';
import {
  ChybaVstupu,
  nactiAudit,
  nactiNastaveni,
  nactiOsoby,
  nactiPrehled,
  overPolozku,
  smazPolozku,
  ulozFioToken,
  ulozPolozku,
  ulozIdentifikaci,
} from './db.js';
import { popisDruhu, popisPeriody } from './money.js';
import { renderNastaveni } from './settings-page.js';

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Bez no-store by se verze cachovala a po nasazení hlásila starý commit.
      'cache-control': 'no-store',
    },
  });

const html = (body: string, status = 200): Response =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });

const notBuilt = (co: string): Response =>
  json({ stav: 'nepostaveno', cast: co, detail: 'Tato část se teprve staví — viz HANDOFF.md.' }, 503);

/**
 * Admin smí jen ten, koho pustil Cloudflare Access. Fail-closed: když Access
 * není nastavený, `ctx.access` chybí a nepustí se nikdo.
 *
 * DEV_ADMIN je únik jen pro lokální vývoj a platí pouze na localhostu — i kdyby
 * se ta proměnná omylem dostala do produkce, ochranu neobejde.
 */
async function adminIdentita(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<string | null> {
  const identita = await ctx.access?.getIdentity();
  if (identita) return identita.email ?? identita.name ?? 'přihlášen přes Access';

  const host = new URL(request.url).hostname;
  // Přes `String()`, protože typ z wrangler.jsonc je literál "0" a porovnání by neprošlo.
  const devAdmin: string = String(env.DEV_ADMIN ?? '0');
  if (devAdmin === '1' && (host === 'localhost' || host === '127.0.0.1')) {
    return 'lokální vývoj';
  }
  return null;
}

const denied = (): Response =>
  html(
    `<!doctype html><html lang="cs"><head><meta charset="utf-8" />
<title>Nepřihlášeno</title></head><body style="font:15px/1.6 system-ui;max-width:34rem;margin:12vh auto;padding:0 1.25rem">
<h1 style="font-size:1.35rem">Sem se nedostaneš</h1>
<p>Správa nákladů je chráněná přihlášením přes Cloudflare Access. Tenhle požadavek přišel bez ověřené identity, takže ho aplikace odmítla.</p>
<p style="color:#666;font-size:.9rem">Pokud Access na této adrese ještě není nastavený, nastav ho v Zero Trust → Access → Applications na cestu <code>/admin</code>.</p>
</body></html>`,
    403,
  );

/**
 * Zápis přijímáme jen z vlastní stránky. Bez téhle kontroly by stačilo, aby
 * přihlášený admin otevřel cizí web, a ten by mu mohl poslat příkaz jeho jménem.
 */
function cizihoPuvodu(request: Request, url: URL): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  try {
    return new URL(origin).host !== url.host;
  } catch {
    return true;
  }
}

/** CSV pro Excel: středníky, BOM, desetinná čárka. */
function exportCsv(polozky: Awaited<ReturnType<typeof nactiPrehled>>): Response {
  const bunka = (v: string | number | null): string => {
    const s = v === null ? '' : String(v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const jmena = new Map(polozky.osoby.map((o) => [o.id, o.jmeno]));

  const hlavicka = ['nazev', 'kategorie', 'druh', 'perioda', 'datum', 'castka_kc', 'poznamka']
    .concat(polozky.osoby.map((o) => 'podil_' + o.jmeno))
    .join(';');

  const radky = polozky.polozky.map((p) => {
    const zaklad = [
      bunka(p.nazev),
      bunka(p.kategorie),
      bunka(popisDruhu(p.druh)),
      bunka(popisPeriody(p.perioda)),
      bunka(p.datum),
      bunka(String(p.castka_celkem / 100).replace('.', ',')),
      bunka(p.poznamka),
    ];
    const podily = polozky.osoby.map((o) => {
      const podil = p.podily.find((x) => x.member_id === o.id);
      if (!podil) return '';
      return podil.rezim === 'procento'
        ? bunka(String(podil.hodnota / 100).replace('.', ',') + ' %')
        : bunka(String(podil.hodnota / 100).replace('.', ',') + ' Kč');
    });
    return zaklad.concat(podily).join(';');
  });

  // Poslední sloupec ještě jednou v hlavičce jako připomínka, komu podíl patří.
  void jmena;

  return new Response('﻿' + [hlavicka, ...radky].join('\r\n') + '\r\n', {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="naklady-domu.csv"',
      'cache-control': 'no-store',
    },
  });
}

async function telo(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ChybaVstupu('Nečitelná data požadavku.');
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/version') {
      return json({ app: 'fio-uhrady', commit: env.GIT_COMMIT ?? 'dev', cas: new Date().toISOString() });
    }

    if (path === '/api/health') {
      try {
        const row = await env.DB.prepare('select count(*) as pocet from cost_items').first<{ pocet: number }>();
        return json({ db: 'ok', polozek: row?.pocet ?? 0 });
      } catch (err) {
        return json({ db: 'chyba', detail: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    const jeAdmin = path === '/admin' || path.startsWith('/admin/');
    const jeApi = path.startsWith('/api/');

    if (jeAdmin || jeApi) {
      const kdo = await adminIdentita(request, env, ctx);
      if (kdo === null) return jeApi ? json({ chyba: 'Nepřihlášeno.' }, 403) : denied();

      if (request.method === 'POST' && cizihoPuvodu(request, url)) {
        return json({ chyba: 'Požadavek nepřišel z této aplikace.' }, 403);
      }

      try {
        if (request.method === 'GET' && path === '/admin') {
          const prehled = await nactiPrehled(env.DB);
          return html(renderNaklady(prehled, new Date().toLocaleDateString('cs-CZ'), kdo, env.GIT_COMMIT ?? 'dev'));
        }

        if (request.method === 'GET' && path === '/admin/nastaveni') {
          const [osoby, nastaveni, audit] = await Promise.all([
            nactiOsoby(env.DB),
            nactiNastaveni(env.DB),
            nactiAudit(env.DB, 20),
          ]);
          return html(renderNastaveni(osoby, nastaveni, audit, kdo, env.GIT_COMMIT ?? 'dev'));
        }

        if (request.method === 'GET' && path === '/admin/export.csv') {
          return exportCsv(await nactiPrehled(env.DB));
        }

        if (request.method === 'POST' && path === '/api/polozka') {
          const id = await ulozPolozku(env.DB, overPolozku(await telo(request)), kdo);
          return json({ ok: true, id });
        }

        const smazat = path.match(/^\/api\/polozka\/(\d+)\/smazat$/);
        if (request.method === 'POST' && smazat?.[1]) {
          await smazPolozku(env.DB, Number(smazat[1]), kdo);
          return json({ ok: true });
        }

        if (request.method === 'POST' && path === '/api/identifikace') {
          const data = (await telo(request)) as {
            zmeny?: {
              member_id: number;
              je_platce: boolean;
              vs: string | null;
              ucet: string | null;
              pod_member_id: number | null;
            }[];
          };
          for (const z of data.zmeny ?? []) {
            await ulozIdentifikaci(
              env.DB,
              Number(z.member_id),
              {
                je_platce: Boolean(z.je_platce),
                vs: z.vs === null ? null : String(z.vs).trim(),
                ucet: z.ucet === null ? null : String(z.ucet).trim(),
                pod_member_id:
                  z.pod_member_id === null || z.pod_member_id === undefined
                    ? null
                    : Number(z.pod_member_id),
              },
              kdo,
            );
          }
          return json({ ok: true });
        }

        if (request.method === 'POST' && path === '/api/fio-token') {
          const data = (await telo(request)) as { token?: string };
          await ulozFioToken(env.DB, String(data.token ?? ''), kdo);
          return json({ ok: true });
        }
      } catch (err) {
        if (err instanceof ChybaVstupu) return json({ chyba: err.message }, 400);
        console.error(JSON.stringify({ udalost: 'chyba', cesta: path, detail: String(err) }));
        return json({ chyba: 'Uložení se nepovedlo, zkus to prosím znovu.' }, 500);
      }

      return notBuilt(path);
    }

    // Přehled na neuhodnutelném odkazu — jen čtení + export.
    if (path.startsWith('/v/')) return notBuilt('přehled');

    if (path === '/') {
      return new Response('FIO-uhrady — běží. Správa je na /admin, přehled bude na /v/{token}.', {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    return json({ chyba: 'Neznámá cesta', cesta: path }, 404);
  },

  async scheduled(_event: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // Sem přijde stahování z Fio (periods/ + dedup podle ID pohybu) a matcher.
    // Nestavím to dřív, než sonda potvrdí, na kterých polích se dá stavět.
    console.log(JSON.stringify({ udalost: 'cron', stav: 'sync zatím nepostaven' }));
  },
} satisfies ExportedHandler<Env>;
