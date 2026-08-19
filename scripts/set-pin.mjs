/**
 * Vygeneruje SQL, které nastaví PIN do správy. PIN se do databáze neukládá —
 * jen jeho otisk (PBKDF2-SHA256, 100 000 iterací) a náhodná sůl. Stejné
 * parametry počítá i Worker v src/auth.ts.
 *
 *   node scripts/set-pin.mjs 1258 > pin.sql
 *   npx wrangler d1 execute fio-uhrady --remote --file pin.sql
 *   Remove-Item pin.sql
 *
 * Soubor s SQL po použití smaž — je v něm otisk, ne PIN, ale nemá co povalovat.
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
