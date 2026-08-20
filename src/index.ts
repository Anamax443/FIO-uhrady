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
  ulozNastaveni,
  ulozOsobu,
  nactiBehy,
  nactiUzaverky,
  nactiVyuctovani,
  nactiZalohy,
  osobaPodleTokenu,
  platbyOsoby,
  vytvorOdkaz,
  zrusOdkaz,
  ulozUzaverku,
  ulozVyuctovani,
  ulozZalohu,
  zrusUzaverku,
  zrusVyuctovani,
  zaplacenoOsobami,
  zustatkyZVyuctovani,
  type ZpusobVyrovnani,
} from './db.js';
import { podkladUzaverky, renderUzaverky } from './closings-page.js';
import {
  podkladVyuctovani,
  radkyKUlozeni,
  renderVyuctovani,
  vyuctovatelneMesice,
} from './settlement-page.js';
import { renderDokumentace } from './docs-page.js';
import { renderClen } from './member-page.js';
import {
  dalsiSplatnost,
  renderLog,
  renderOApp,
  renderOsoby,
  renderPrehled,
  renderVyrovnani,
  vyrovnani,
  vyvojPodilu,
} from './more-pages.js';
import { mesicNyni, popisDruhu, popisPeriody } from './money.js';
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

/**
 * Načte všechno, z čeho se počítá vyrovnání i vyúčtování.
 *
 * Platby se berou **za běžící období** — od počátku sledování, který se po
 * každém vyúčtování posune. Bez toho by se jednou zúčtované peníze odečítaly
 * od dluhu i v dalším období.
 */
async function stavVyrovnani(db: D1Database) {
  const [prehled, nastaveni, zalohy, uzaverky, hotovaVyuctovani] = await Promise.all([
    nactiPrehled(db),
    nactiNastaveni(db),
    nactiZalohy(db),
    nactiUzaverky(db),
    nactiVyuctovani(db),
  ]);
  const zaplaceno = await zaplacenoOsobami(db, prehled, nastaveni.vyuctovani_od);
  return {
    prehled,
    nastaveni,
    zalohy,
    uzaverky,
    hotovaVyuctovani,
    zaplaceno,
    zustatky: zustatkyZVyuctovani(hotovaVyuctovani),
  };
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
          const vybrano = Number(url.searchParams.get('vybrano') ?? '');
          return html(
            renderNaklady(
              prehled,
              new Date().toLocaleDateString('cs-CZ'),
              kdo,
              env.GIT_COMMIT ?? 'dev',
              Number.isInteger(vybrano) && vybrano > 0 ? vybrano : null,
              url.searchParams.get('stav'),
            ),
          );
        }

        if (request.method === 'GET' && path === '/admin/nastaveni') {
          const [osoby, nastaveni, audit] = await Promise.all([
            nactiOsoby(env.DB),
            nactiNastaveni(env.DB),
            nactiAudit(env.DB, 20),
          ]);
          return html(
            renderNastaveni(
              osoby,
              nastaveni,
              audit,
              kdo,
              env.GIT_COMMIT ?? 'dev',
              url.origin,
              url.searchParams.get('stav'),
            ),
          );
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

        if (request.method === 'GET' && path === '/admin/prehled') {
          const stav = await stavVyrovnani(env.DB);
          const [beh, platby] = await Promise.all([posledniBeh(env.DB), nactiPlatby(env.DB, 500)]);
          return html(
            renderPrehled(
              stav.prehled,
              stav.zaplaceno,
              stav.zalohy,
              stav.nastaveni,
              stav.uzaverky,
              stav.zustatky,
              beh,
              platby.filter((p) => p.member_id === null).length,
              kdo,
              env.GIT_COMMIT ?? 'dev',
            ),
          );
        }

        if (request.method === 'GET' && path === '/admin/osoby') {
          const [osoby, nastaveni] = await Promise.all([
            nactiOsoby(env.DB, true),
            nactiNastaveni(env.DB),
          ]);
          return html(renderOsoby(osoby, nastaveni.nazev_domu, kdo, env.GIT_COMMIT ?? 'dev'));
        }

        if (request.method === 'GET' && path === '/admin/vyrovnani') {
          const s = await stavVyrovnani(env.DB);
          return html(
            renderVyrovnani(
              s.prehled,
              s.zaplaceno,
              s.zalohy,
              s.nastaveni,
              s.uzaverky,
              s.zustatky,
              kdo,
              env.GIT_COMMIT ?? 'dev',
            ),
          );
        }

        if (request.method === 'GET' && path === '/admin/dokumentace') {
          const nastaveni = await nactiNastaveni(env.DB);
          return html(renderDokumentace(nastaveni.nazev_domu, kdo, env.GIT_COMMIT ?? 'dev'));
        }

        if (request.method === 'GET' && path === '/admin/uzaverky') {
          const s = await stavVyrovnani(env.DB);
          const { mesicu } = vyrovnani(
            s.prehled,
            s.zaplaceno,
            s.zalohy,
            s.nastaveni,
            s.uzaverky,
            s.zustatky,
          );
          return html(
            renderUzaverky(s.prehled, s.zalohy, s.uzaverky, s.nastaveni, mesicu, kdo, env.GIT_COMMIT ?? 'dev'),
          );
        }

        if (request.method === 'GET' && path === '/admin/vyuctovani') {
          const s = await stavVyrovnani(env.DB);
          const mozna = vyuctovatelneMesice(s.nastaveni, s.uzaverky);
          const zadano = url.searchParams.get('do');
          // Vybrat jde jen měsíc, který opravdu jde vyúčtovat; jinak poslední z nich.
          const konec =
            zadano !== null && mozna.includes(zadano)
              ? zadano
              : (mozna[mozna.length - 1] ?? s.nastaveni.vyuctovani_od);
          // Platby za vyúčtovávané období, ne za celé sledování — jinak by se do
          // vyúčtování dostaly i peníze, které přišly až po jeho konci.
          const zaplacenoVObdobi = await zaplacenoOsobami(
            env.DB,
            s.prehled,
            s.nastaveni.vyuctovani_od,
            konec,
          );
          return html(
            renderVyuctovani(
              podkladVyuctovani(s.prehled, s.zalohy, s.uzaverky, s.nastaveni, zaplacenoVObdobi, konec),
              s.hotovaVyuctovani,
              s.nastaveni,
              s.prehled.nazev_domu,
              kdo,
              env.GIT_COMMIT ?? 'dev',
            ),
          );
        }

        if (request.method === 'POST' && path === '/api/vyuctovani') {
          const d = (await telo(request)) as {
            do?: string;
            rozhodnuti?: { member_id: number; zpusob: string; nova_zaloha: string }[];
          };
          const konec = String(d.do ?? '').trim();
          const s = await stavVyrovnani(env.DB);
          if (!vyuctovatelneMesice(s.nastaveni, s.uzaverky).includes(konec)) {
            throw new ChybaVstupu(
              `Měsíc ${konec} vyúčtovat nejde — musí být uzavřený a navazovat na ${s.nastaveni.vyuctovani_od}.`,
            );
          }

          // Z prohlížeče se berou jen rozhodnutí, čísla se počítají znovu tady.
          const rozhodnuti = new Map<number, { zpusob: ZpusobVyrovnani; nova_zaloha: number }>();
          for (const r of d.rozhodnuti ?? []) {
            const korun = Number(String(r.nova_zaloha ?? '').replace(/\s/g, '').replace(',', '.'));
            if (!Number.isFinite(korun) || korun < 0) {
              throw new ChybaVstupu('Nová záloha musí být nezáporné číslo.');
            }
            rozhodnuti.set(Number(r.member_id), {
              zpusob: r.zpusob === 'jednorazove' ? 'jednorazove' : 'do_zalohy',
              nova_zaloha: Math.round(korun * 100),
            });
          }

          const zaplacenoVObdobi = await zaplacenoOsobami(
            env.DB,
            s.prehled,
            s.nastaveni.vyuctovani_od,
            konec,
          );
          const podklad = podkladVyuctovani(
            s.prehled,
            s.zalohy,
            s.uzaverky,
            s.nastaveni,
            zaplacenoVObdobi,
            konec,
          );
          await ulozVyuctovani(
            env.DB,
            { obdobi_od: podklad.od, obdobi_do: podklad.do, ...radkyKUlozeni(podklad, rozhodnuti) },
            kdo,
          );
          return json({ ok: true, od: podklad.od, do: podklad.do, dalsi: podklad.dalsi });
        }

        if (request.method === 'POST' && path === '/api/vyuctovani/zrusit') {
          const d = (await telo(request)) as { do?: string };
          await zrusVyuctovani(env.DB, String(d.do ?? '').trim(), kdo);
          return json({ ok: true });
        }

        if (request.method === 'POST' && path === '/api/uzaverka') {
          const d = (await telo(request)) as { obdobi?: string };
          const obdobi = String(d.obdobi ?? '').trim();
          // Budoucnost uzavírat nejde — nebylo by co zamrazit.
          if (obdobi > mesicNyni()) throw new ChybaVstupu('Budoucí měsíc uzavřít nejde.');
          const [prehled, zalohy] = await Promise.all([nactiPrehled(env.DB), nactiZalohy(env.DB)]);
          await ulozUzaverku(env.DB, podkladUzaverky(prehled, zalohy, obdobi), kdo);
          return json({ ok: true });
        }

        if (request.method === 'POST' && path === '/api/uzaverka/zrusit') {
          const d = (await telo(request)) as { obdobi?: string };
          await zrusUzaverku(env.DB, String(d.obdobi ?? '').trim(), kdo);
          return json({ ok: true });
        }

        if (request.method === 'GET' && path === '/admin/log') {
          const [behy, nastaveni] = await Promise.all([nactiBehy(env.DB), nactiNastaveni(env.DB)]);
          return html(renderLog(behy, nastaveni.nazev_domu, kdo, env.GIT_COMMIT ?? 'dev'));
        }

        if (request.method === 'GET' && path === '/admin/o-aplikaci') {
          const [nastaveni, pocty] = await Promise.all([
            nactiNastaveni(env.DB),
            env.DB.prepare(
              `select (select count(*) from members) osob, (select count(*) from cost_items) polozek,
                      (select count(*) from payments) plateb, (select count(*) from audit_log) zmen`,
            ).first<{ osob: number; polozek: number; plateb: number; zmen: number }>(),
          ]);
          return html(
            renderOApp(
              nastaveni.nazev_domu,
              pocty ?? { osob: 0, polozek: 0, plateb: 0, zmen: 0 },
              nastaveni.fio_token_naznak !== null,
              kdo,
              env.GIT_COMMIT ?? 'dev',
            ),
          );
        }

        if (request.method === 'POST' && path === '/api/osoba') {
          const d = (await telo(request)) as {
            id?: number | null;
            jmeno?: string;
            email?: string | null;
            je_admin?: boolean;
            aktivni?: boolean;
          };
          const id = await ulozOsobu(
            env.DB,
            {
              id: d.id === null || d.id === undefined ? null : Number(d.id),
              jmeno: String(d.jmeno ?? ''),
              email: d.email === undefined || d.email === null ? null : String(d.email),
              je_admin: Boolean(d.je_admin),
              aktivni: d.aktivni !== false,
            },
            kdo,
          );
          return json({ ok: true, id });
        }

        if (request.method === 'POST' && path === '/api/odkaz') {
          const d = (await telo(request)) as { member_id?: number };
          const token = await vytvorOdkaz(env.DB, Number(d.member_id), kdo);
          return json({ ok: true, odkaz: `/v/${token}` });
        }

        if (request.method === 'POST' && path === '/api/odkaz/zrusit') {
          const d = (await telo(request)) as { member_id?: number };
          await zrusOdkaz(env.DB, Number(d.member_id), kdo);
          return json({ ok: true });
        }

        if (request.method === 'POST' && path === '/api/zaloha') {
          const d = (await telo(request)) as { member_id?: number; castka?: string; plati_od?: string };
          const korun = Number(String(d.castka ?? '').replace(/\s/g, '').replace(',', '.'));
          if (!Number.isFinite(korun) || korun < 0) throw new ChybaVstupu('Záloha musí být číslo.');
          await ulozZalohu(
            env.DB,
            {
              member_id: Number(d.member_id),
              castka: Math.round(korun * 100),
              plati_od: String(d.plati_od ?? '').trim(),
              poznamka: null,
            },
            kdo,
          );
          return json({ ok: true });
        }

        if (request.method === 'POST' && path === '/api/sledovani') {
          const d = (await telo(request)) as { od?: string; den?: string };
          const od = String(d.od ?? '').trim();
          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(od)) {
            throw new ChybaVstupu('Počátek sledování čekám ve tvaru RRRR-MM, například 2026-01.');
          }
          const den = Number(String(d.den ?? '').trim());
          // 28 je strop schválně: 29.–31. v únoru neexistuje a splatnost
          // by se každý rok posouvala.
          if (!Number.isInteger(den) || den < 1 || den > 28) {
            throw new ChybaVstupu('Den splatnosti musí být číslo od 1 do 28 (aby vyšel i v únoru).');
          }
          await ulozNastaveni(env.DB, 'vyuctovani_od', od, kdo, `Příspěvky se sledují od ${od}`);
          await ulozNastaveni(env.DB, 'den_splatnosti', String(den), kdo, `Splatnost nastavena na ${den}. den v měsíci`);
          return json({ ok: true });
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
          const vysledek = await ulozPolozku(env.DB, overPolozku(await telo(request)), kdo);
          return json({ ok: true, ...vysledek });
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

    // Osobní přehled na neuhodnutelném odkazu — veřejný, jen ke čtení.
    // Kdo odkaz nemá, sem nemá jak trefit; kdo ho má, vidí jen svoje čísla.
    if (path.startsWith('/v/')) {
      const osoba = await osobaPodleTokenu(env.DB, path.slice(3));
      if (osoba === null) {
        return html(
          `<!doctype html><html lang="cs"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" /><title>Odkaz neplatí</title></head>
<body style="font:16px/1.6 system-ui;max-width:30rem;margin:14vh auto;padding:0 1.25rem">
<h1 style="font-size:1.3rem">Tenhle odkaz už neplatí</h1>
<p>Buď byl zrušený, nebo je špatně opsaný. Požádej o nový toho, kdo ti ho poslal.</p>
</body></html>`,
          404,
        );
      }

      const s = await stavVyrovnani(env.DB);
      const { prehled, nastaveni, uzaverky } = s;
      const platby = await platbyOsoby(env.DB, osoba.id);

      const { radky } = vyrovnani(
        prehled,
        s.zaplaceno,
        s.zalohy,
        nastaveni,
        uzaverky,
        s.zustatky,
      );
      // Nezletilé dítě nemá vlastní řádek — ukáže se ten, kdo za něj závazek nese.
      const muj =
        radky.find((r) => r.osoba.id === osoba.id) ??
        radky.find((r) => r.zastupuje.includes(osoba.jmeno));
      if (muj === undefined) return notBuilt('přehled: osoba nemá spočítaný podíl');

      const iban = await env.DB.prepare("select hodnota from settings where klic = 'iban_domu'")
        .first<{ hodnota: string }>();

      return html(
        renderClen(
          osoba,
          muj,
          vyvojPodilu(prehled, uzaverky, nastaveni, muj.osoba.id),
          platby,
          prehled,
          nastaveni,
          iban?.hodnota ?? null,
          dalsiSplatnost(nastaveni.den_splatnosti),
          env.GIT_COMMIT ?? 'dev',
        ),
      );
    }

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
