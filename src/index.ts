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
  kdoZeCookie,
  maPin,
  overPin,
  stavBloku,
  vymazNeuspechy,
  vytvorCookie,
  zapisNeuspech,
  zrusCookie,
} from './auth.js';
import { prihlasovaciStranka } from './login-page.js';
import {
  ChybaVstupu,
  historiePolozky,
  nactiAudit,
  nactiFioToken,
  nactiPlatby,
  nactiNastaveni,
  nactiOsoby,
  nactiPrehled,
  overPolozku,
  smazPolozku,
  ulozFioToken,
  posledniBeh,
  priradPlatbu,
  ulozPolozku,
  ulozIdentifikaci,
} from './db.js';
import { popisDruhu, popisPeriody } from './money.js';
import { renderUhrady } from './payments-page.js';
import { renderNastaveni } from './settings-page.js';
import { synchronizuj } from './sync.js';
import { uvodniStranka } from './ui.js';

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
  // Access dává skutečnou identitu (e-mail) — ta je v auditu k něčemu.
  const identita = await ctx.access?.getIdentity();
  if (identita) return identita.email ?? identita.name ?? 'přihlášen přes Access';

  // Záloha: přihlášení PINem, drží ho podepsaná cookie s platností.
  const zCookie = await kdoZeCookie(env.DB, request.headers.get('cookie'));
  if (zCookie !== null) return zCookie;

  const host = new URL(request.url).hostname;
  // Přes `String()`, protože typ z wrangler.jsonc je literál "0" a porovnání by neprošlo.
  const devAdmin: string = String(env.DEV_ADMIN ?? '0');
  if (devAdmin === '1' && (host === 'localhost' || host === '127.0.0.1')) {
    return 'lokální vývoj';
  }
  return null;
}

const adresa = (request: Request): string =>
  request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip') ?? 'neznámá';

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

    // Přihlášení je veřejné — musí jít otevřít i bez platné cookie.
    if (path === '/admin/prihlaseni' && request.method === 'GET') {
      const blok = await stavBloku(env.DB, adresa(request));
      return html(
        prihlasovaciStranka(
          env.GIT_COMMIT ?? 'dev',
          blok.blokovano ? 'Příliš mnoho pokusů. Zkus to za chvíli.' : null,
          blok.blokovano ? blok.zbyvaSekund : 0,
        ),
      );
    }

    if (path === '/api/prihlaseni' && request.method === 'POST') {
      const ip = adresa(request);
      const blok = await stavBloku(env.DB, ip);
      if (blok.blokovano) {
        return html(
          prihlasovaciStranka(
            env.GIT_COMMIT ?? 'dev',
            `Přihlášení je zamčené ještě ${Math.ceil(blok.zbyvaSekund / 60)} min.`,
            blok.zbyvaSekund,
          ),
          429,
        );
      }

      const formular = await request.formData();
      const pin = String(formular.get('pin') ?? '');
      if (await overPin(env.DB, pin)) {
        await vymazNeuspechy(env.DB, ip);
        return new Response(null, {
          status: 303,
          headers: { location: '/admin', 'set-cookie': await vytvorCookie(env.DB, `PIN (${ip})`) },
        });
      }

      await zapisNeuspech(env.DB, ip);
      const poChybe = await stavBloku(env.DB, ip);
      return html(
        prihlasovaciStranka(
          env.GIT_COMMIT ?? 'dev',
          poChybe.blokovano
            ? `Špatný PIN. Další pokus až za ${Math.ceil(poChybe.zbyvaSekund / 60)} min.`
            : 'Špatný PIN.',
          poChybe.blokovano ? poChybe.zbyvaSekund : 0,
        ),
        401,
      );
    }

    if (path === '/api/odhlaseni' && request.method === 'POST') {
      return new Response(null, { status: 303, headers: { location: '/', 'set-cookie': zrusCookie() } });
    }

    const jeAdmin = path === '/admin' || path.startsWith('/admin/');
    const jeApi = path.startsWith('/api/');

    if (jeAdmin || jeApi) {
      const kdo = await adminIdentita(request, env, ctx);
      if (kdo === null) {
        if (jeApi) return json({ chyba: 'Nepřihlášeno.' }, 403);
        // Když je nastavený PIN, pošli člověka na přihlášení; jinak vysvětli Access.
        return (await maPin(env.DB))
          ? new Response(null, { status: 302, headers: { location: '/admin/prihlaseni' } })
          : denied();
      }

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

        if (request.method === 'GET' && path === '/admin/uhrady') {
          const [platby, osoby, beh, nastaveni] = await Promise.all([
            nactiPlatby(env.DB),
            nactiOsoby(env.DB),
            posledniBeh(env.DB),
            nactiNastaveni(env.DB),
          ]);
          return html(
            renderUhrady(
              platby,
              osoby,
              beh,
              kdo,
              env.GIT_COMMIT ?? 'dev',
              nastaveni.nazev_domu,
              nastaveni.fio_token_naznak !== null,
            ),
          );
        }

        if (request.method === 'GET' && path === '/admin/export.csv') {
          return exportCsv(await nactiPrehled(env.DB));
        }

        if (request.method === 'POST' && path === '/api/sync') {
          const token = await nactiFioToken(env.DB);
          if (token === null) {
            throw new ChybaVstupu('Není uložený token do Fio — vlož ho v Nastavení.');
          }
          const nastaveni = await nactiNastaveni(env.DB);
          const vysledek = await synchronizuj(env.DB, token, nastaveni.sync_window_days);
          return json({ ok: true, ...vysledek });
        }

        if (request.method === 'POST' && path === '/api/platba/prirad') {
          const data = (await telo(request)) as { fio_id?: string; member_id?: number | null };
          await priradPlatbu(
            env.DB,
            String(data.fio_id ?? ''),
            data.member_id === null || data.member_id === undefined ? null : Number(data.member_id),
            kdo,
          );
          return json({ ok: true });
        }

        const historie = path.match(/^\/api\/polozka\/(\d+)\/historie$/);
        if (request.method === 'GET' && historie?.[1]) {
          return json({ zmeny: await historiePolozky(env.DB, Number(historie[1])) });
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
      // Stav databáze se ověří dotazem, ne odhadem — návštěvník má vidět pravdu.
      let bezi = true;
      try {
        await env.DB.prepare('select 1').first();
      } catch {
        bezi = false;
      }
      return html(uvodniStranka(env.GIT_COMMIT ?? 'dev', bezi));
    }

    return json({ chyba: 'Neznámá cesta', cesta: path }, 404);
  },

  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const token = await nactiFioToken(env.DB);
    if (token === null) {
      // Není to selhání — appka jen čeká, až někdo vloží token v Nastavení.
      console.log(JSON.stringify({ udalost: 'cron', stav: 'čeká na token do Fio' }));
      return;
    }
    try {
      const nastaveni = await nactiNastaveni(env.DB);
      const vysledek = await synchronizuj(env.DB, token, nastaveni.sync_window_days);
      console.log(JSON.stringify({ udalost: 'cron', stav: 'ok', ...vysledek }));
    } catch (err) {
      // Podrobnost je i v sync_runs, tohle je jen stopa v logu Workeru.
      console.error(JSON.stringify({ udalost: 'cron', stav: 'chyba', detail: String(err) }));
    }
  },
} satisfies ExportedHandler<Env>;
