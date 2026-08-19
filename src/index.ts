/**
 * FIO-uhrady — Worker.
 *
 * Hotové: frontend admina (přehled nákladů domu a rozpad na jednotky).
 * Zatím bez vazby na databázi — stránka se kreslí z ukázkových dat.
 *
 * Rozvržení cest viz README.md, pravidla párování viz docs/ARCHITECTURE.md.
 */
import { renderAdmin } from './admin-page.js';
import { vzorovyPrehled } from './sample.js';

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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/version') {
      return json({ app: 'fio-uhrady', commit: env.GIT_COMMIT ?? 'dev', cas: new Date().toISOString() });
    }

    // Ověření, že binding na D1 opravdu žije (ne jen že je v konfiguraci).
    if (path === '/api/health') {
      try {
        const row = await env.DB.prepare('select 1 as ok').first<{ ok: number }>();
        return json({ db: row?.ok === 1 ? 'ok' : 'neznámý stav' });
      } catch (err) {
        return json({ db: 'chyba', detail: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    if (path === '/admin' || path.startsWith('/admin/')) {
      const kdo = await adminIdentita(request, env, ctx);
      if (kdo === null) return denied();

      if (path === '/admin') {
        const datum = new Date().toLocaleDateString('cs-CZ');
        return html(renderAdmin(vzorovyPrehled(), datum));
      }
      // Formulář položky, správa osob a jednotek — přijdou s vazbou na databázi.
      return notBuilt('admin: ' + path);
    }

    // Přehled na neuhodnutelném odkazu — jen čtení + export.
    if (path.startsWith('/v/')) return notBuilt('přehled');

    if (path === '/') {
      return new Response(
        'FIO-uhrady — běží. Správa je na /admin, přehled bude na /v/{token}.',
        { headers: { 'content-type': 'text/plain; charset=utf-8' } },
      );
    }

    return json({ chyba: 'Neznámá cesta', cesta: path }, 404);
  },

  async scheduled(_event: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // Sem přijde stahování z Fio (periods/ + dedup podle ID pohybu) a matcher.
    // Nestavím to dřív, než sonda potvrdí, na kterých polích se dá stavět.
    console.log(JSON.stringify({ udalost: 'cron', stav: 'sync zatím nepostaven' }));
  },
} satisfies ExportedHandler<Env>;
