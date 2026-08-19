/**
 * Přihlášení do správy.
 *
 * Přednost má **Cloudflare Access** — ten dává skutečnou identitu (e-mail),
 * která se pak píše do auditu. Když není nastavený, dá se dovnitř PINem.
 *
 * PIN je krátký, takže sám o sobě je slabý. Drží ho tři věci:
 *  - neukládá se, jen jeho otisk (PBKDF2, 100 000 iterací, se solí),
 *  - po pěti chybách se adresa na 15 minut zamkne a doba se dál prodlužuje,
 *  - přihlášení nese podepsaná cookie s platností, ne jen příznak.
 *
 * Dvoufaktor jako volba v Nastavení je v plánu — viz HANDOFF.
 */

const COOKIE = 'fio_session';
const PLATNOST_HODIN = 12;
const POKUSU_DO_BLOKU = 5;

const enc = new TextEncoder();

const b64url = (data: ArrayBuffer | Uint8Array): string => {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const hex = (data: ArrayBuffer): string =>
  [...new Uint8Array(data)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Porovnání bez úniku času — délka odpovědi nesmí prozradit, kde se to liší. */
function stejne(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let rozdil = 0;
  for (let i = 0; i < a.length; i++) rozdil |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return rozdil === 0;
}

async function otisk(pin: string, sul: string): Promise<string> {
  const klic = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bity = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(sul), iterations: 100_000, hash: 'SHA-256' },
    klic,
    256,
  );
  return hex(bity);
}

async function hodnota(db: D1Database, klic: string): Promise<string | null> {
  const row = await db
    .prepare('select hodnota from settings where klic = ?')
    .bind(klic)
    .first<{ hodnota: string }>();
  return row?.hodnota ?? null;
}

async function uloz(db: D1Database, klic: string, val: string): Promise<void> {
  await db
    .prepare(
      `insert into settings (klic, hodnota, changed_at) values (?, ?, datetime('now'))
       on conflict(klic) do update set hodnota = excluded.hodnota, changed_at = excluded.changed_at`,
    )
    .bind(klic, val)
    .run();
}

/** Klíč na podepisování cookie. Vznikne při prvním použití a zůstane. */
async function podpisovyKlic(db: D1Database): Promise<CryptoKey> {
  let tajemstvi = await hodnota(db, 'session_secret');
  if (tajemstvi === null) {
    const nahodne = crypto.getRandomValues(new Uint8Array(32));
    tajemstvi = b64url(nahodne);
    await uloz(db, 'session_secret', tajemstvi);
  }
  return crypto.subtle.importKey('raw', enc.encode(tajemstvi), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/** Nastaví nový PIN (ukládá se jen otisk). */
export async function nastavPin(db: D1Database, pin: string): Promise<void> {
  const sul = b64url(crypto.getRandomValues(new Uint8Array(16)));
  await uloz(db, 'admin_pin_salt', sul);
  await uloz(db, 'admin_pin_hash', await otisk(pin, sul));
}

export const maPin = async (db: D1Database): Promise<boolean> =>
  (await hodnota(db, 'admin_pin_hash')) !== null;

export async function overPin(db: D1Database, pin: string): Promise<boolean> {
  const sul = await hodnota(db, 'admin_pin_salt');
  const ulozeny = await hodnota(db, 'admin_pin_hash');
  if (sul === null || ulozeny === null) return false;
  return stejne(await otisk(pin, sul), ulozeny);
}

/* ---------- zpomalení hádání ---------- */

export interface Blok {
  blokovano: boolean;
  zbyvaSekund: number;
}

export async function stavBloku(db: D1Database, ip: string): Promise<Blok> {
  const row = await db
    .prepare("select blok_do, (julianday(blok_do) - julianday('now')) * 86400 as zbyva from login_attempts where ip = ?")
    .bind(ip)
    .first<{ blok_do: string | null; zbyva: number | null }>();
  const zbyva = row?.zbyva ?? 0;
  return { blokovano: row?.blok_do !== null && zbyva > 0, zbyvaSekund: Math.ceil(Math.max(0, zbyva)) };
}

/** Po pěti chybách 15 minut, po deseti hodina — hádání se přestane vyplácet. */
export async function zapisNeuspech(db: D1Database, ip: string): Promise<void> {
  const row = await db
    .prepare('select pokusy from login_attempts where ip = ?')
    .bind(ip)
    .first<{ pokusy: number }>();
  const pokusy = (row?.pokusy ?? 0) + 1;
  const minut = pokusy >= 10 ? 60 : pokusy >= POKUSU_DO_BLOKU ? 15 : 0;

  await db
    .prepare(
      `insert into login_attempts (ip, pokusy, posledni, blok_do)
       values (?, ?, datetime('now'), case when ?3 > 0 then datetime('now', '+' || ?3 || ' minutes') else null end)
       on conflict(ip) do update set pokusy = ?2, posledni = datetime('now'),
            blok_do = case when ?3 > 0 then datetime('now', '+' || ?3 || ' minutes') else login_attempts.blok_do end`,
    )
    .bind(ip, pokusy, minut)
    .run();
}

export async function vymazNeuspechy(db: D1Database, ip: string): Promise<void> {
  await db.prepare('delete from login_attempts where ip = ?').bind(ip).run();
}

/* ---------- cookie ---------- */

export async function vytvorCookie(db: D1Database, kdo: string): Promise<string> {
  const klic = await podpisovyKlic(db);
  const platiDo = Date.now() + PLATNOST_HODIN * 3600_000;
  const zaklad = `${platiDo}.${b64url(enc.encode(kdo))}`;
  const podpis = b64url(await crypto.subtle.sign('HMAC', klic, enc.encode(zaklad)));
  const token = `${zaklad}.${podpis}`;
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${PLATNOST_HODIN * 3600}`;
}

export const zrusCookie = (): string =>
  `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

/** Vrátí, kdo je přihlášený, nebo null. Neplatný i prošlý podpis = null. */
export async function kdoZeCookie(db: D1Database, hlavicka: string | null): Promise<string | null> {
  if (hlavicka === null) return null;
  const cast = hlavicka.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  if (cast === undefined) return null;

  const token = cast.slice(COOKIE.length + 1);
  const [platiDo, kdoB64, podpis] = token.split('.');
  if (!platiDo || !kdoB64 || !podpis) return null;
  if (Number(platiDo) < Date.now()) return null;

  const klic = await podpisovyKlic(db);
  const ocekavany = b64url(await crypto.subtle.sign('HMAC', klic, enc.encode(`${platiDo}.${kdoB64}`)));
  if (!stejne(podpis, ocekavany)) return null;

  try {
    return atob(kdoB64.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return null;
  }
}
