/**
 * Vygeneruje SQL, které nastaví PIN do správy. PIN se do databáze neukládá —
 * jen jeho otisk (PBKDF2-SHA256, 100 000 iterací) a náhodná sůl. Stejné
 * parametry počítá i Worker v src/auth.ts.
 *
 *   node scripts/set-pin.mjs 1258
 *
 * Skript vypíše dva hotové příkazy, které stačí zkopírovat a spustit.
 * **`--file` na ostré databázi nepoužívej** — Cloudflare ho odmítá
 * (`Authentication error [code: 10000]`, jde přes import endpoint).
 * Zapomenutý PIN se řeší právě tudy; poslat se nedá, uložený je jen otisk.
 *
 * Do souboru se to dá pořád přesměrovat (`> pin.sql`) — příkazy jdou na
 * chybový výstup, aby SQL zůstalo čisté. Soubor pak smaž, nemá co povalovat.
 */
import { pbkdf2Sync, randomBytes } from 'node:crypto';

const pin = process.argv[2];
if (!pin || !/^\d{4,10}$/.test(pin)) {
  console.error('Použití: node scripts/set-pin.mjs <PIN o 4 až 10 číslicích>');
  process.exit(1);
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const sul = b64url(randomBytes(16));
const otisk = pbkdf2Sync(pin, Buffer.from(sul, 'utf8'), 100_000, 32, 'sha256').toString('hex');

const uloz = (klic, hodnota) =>
  `insert into settings (klic, hodnota, changed_at) values ('${klic}', '${hodnota}', datetime('now'))\n` +
  `  on conflict(klic) do update set hodnota = excluded.hodnota, changed_at = excluded.changed_at;`;

console.log('-- Nastavení PINu do správy. Vygenerováno scripts/set-pin.mjs.');
console.log(uloz('admin_pin_salt', sul));
console.log(uloz('admin_pin_hash', otisk));

// Hotové příkazy jdou na chybový výstup, aby `> pin.sql` zůstalo čisté SQL.
const prikaz = (klic, hodnota) =>
  `npx wrangler d1 execute fio-uhrady --remote --command "insert into settings (klic, hodnota, changed_at) ` +
  `values ('${klic}', '${hodnota}', datetime('now')) on conflict(klic) do update set hodnota = excluded.hodnota, ` +
  `changed_at = excluded.changed_at"`;

console.error('\nSpusť tyhle dva příkazy (oba, sůl i otisk patří k sobě):\n');
console.error(prikaz('admin_pin_salt', sul));
console.error('');
console.error(prikaz('admin_pin_hash', otisk));
console.error('\nPak se ve správě přihlas novým PINem. Staré přihlášení platí do vypršení cookie (12 h).');
