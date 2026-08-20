/**
 * Vypíše hlavičku výpisu z Fio — číslo účtu, IBAN, měnu a zůstatek.
 *
 * Jen ČTE. Citlivé hodnoty se maskují, aby se daly ukázat i v logu.
 * Aplikace si tyhle údaje bere sama při každém stahování, tenhle skript
 * je jen na ověření, co API vrací.
 *
 *   node scripts/fio-info.mjs
 */
import { readFileSync } from 'node:fs';

const shoda = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(
  /^\s*FIO_TOKEN\s*=\s*"?([^"\r\n]+)"?/m,
);
if (!shoda) {
  console.error('Chybí FIO_TOKEN v .dev.vars.');
  process.exit(1);
}

const iso = (d) => d.toISOString().slice(0, 10);
const ted = new Date();
const od = new Date(ted.getTime() - 7 * 86400_000);

const odpoved = await fetch(
  `https://fioapi.fio.cz/v1/rest/periods/${shoda[1].trim()}/${iso(od)}/${iso(ted)}/transactions.json`,
);
if (!odpoved.ok) {
  console.error(
    `Fio API vrátilo ${odpoved.status}` +
      (odpoved.status === 409 ? ' — limit je jeden dotaz za 30 s.' : ''),
  );
  process.exit(1);
}

const info = (await odpoved.json())?.accountStatement?.info ?? {};
const citlive = ['accountId', 'iban', 'bic'];
for (const [klic, hodnota] of Object.entries(info)) {
  const skryt = citlive.includes(klic) && hodnota;
  console.log(klic.padEnd(18), skryt ? String(hodnota).replace(/.(?=.{4})/g, '•') : hodnota);
}
