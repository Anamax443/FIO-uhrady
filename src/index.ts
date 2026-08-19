/**
 * FIO-uhrady — Worker.
 *
 * Zatím kostra: žije, umí se ohlásit a sáhnout si na D1. Admin ani přehled
 * ještě nejsou postavené a vrací 503 — radši poctivé „nepostaveno" než
 * polovičatá stránka, která vypadá funkčně.
 *
 * Rozvržení cest viz README.md, pravidla párování viz docs/ARCHITECTURE.md.
 */

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Bez no-store by se verze cachovala a po nasazení hlásila starý commit.
      'cache-control': 'no-store',
    },
  });

const notBuilt = (co: string): Response =>
  json({ stav: 'nepostaveno', cast: co, detail: 'Tato část se teprve staví — viz HANDOFF.md.' }, 503);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/version') {
      return json({
        app: 'fio-uhrady',
        commit: env.GIT_COMMIT ?? 'dev',
        cas: new Date().toISOString(),
      });
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

    // Admin — smí až za Cloudflare Access. Než bude Access nastavený a ověřený,
    // tady nesmí vzniknout nic, co něco mění.
    if (path === '/admin' || path.startsWith('/admin/')) return notBuilt('admin');

    // Přehled na neuhodnutelném odkazu — jen čtení + export.
    if (path.startsWith('/v/')) return notBuilt('přehled');

    if (path === '/') {
      return new Response(
        'FIO-uhrady — běží. Přehled je na /v/{token}, správa na /admin (obojí se teprve staví).',
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
