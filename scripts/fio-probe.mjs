/**
 * Ověření jádra: umí Fio REST API vrátit pole, na kterých stojí párování?
 *
 * Jen ČTE. Nic nikam nezapisuje, nic nemění — ani na Fio, ani lokálně.
 * Endpoint `periods/` je bezstavový (na rozdíl od `last/`, který posouvá kurzor v bance).
 *
 * Spuštění:
 *   $env:FIO_TOKEN = "<read-only token>"; node scripts/fio-probe.mjs
 *   node scripts/fio-probe.mjs 60        # jiný počet dní zpět (default 30)
 *
 * Token se dá vzít i z .dev.vars (řádek FIO_TOKEN=...), aby nemusel být v historii shellu.
 */
import { readFileSync } from 'node:fs';

const DAYS = Number(process.argv[2] ?? 30);

function token() {
  if (process.env.FIO_TOKEN) return process.env.FIO_TOKEN.trim();
  try {
    const m = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
      .match(/^\s*FIO_TOKEN\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) return m[1].trim();
  } catch { /* .dev.vars nemusí existovat */ }
  console.error('Chybí FIO_TOKEN (proměnná prostředí nebo řádek v .dev.vars).');
  process.exit(1);
}

const iso = (d) => d.toISOString().slice(0, 10);
const to = new Date();
const from = new Date(to.getTime() - DAYS * 86400_000);

// Pole, na kterých stojí párování — viz docs/ARCHITECTURE.md
const FIELDS = {
  column22: 'ID pohybu (PK)',
  column0: 'datum',
  column1: 'částka',
  column14: 'měna',
  column5: 'VS',
  column25: 'komentář (dopisuje vlastník účtu)',
  column16: 'zpráva pro příjemce',
  column7: 'uživatelská identifikace',
  column10: 'název protiúčtu',
};

const tk = token();
const url = `https://fioapi.fio.cz/v1/rest/periods/${tk}/${iso(from)}/${iso(to)}/transactions.json`;
console.log(`GET periods/****/${iso(from)}/${iso(to)}/transactions.json`);

const res = await fetch(url);
if (!res.ok) {
  console.error(`HTTP ${res.status} ${res.statusText}` +
    (res.status === 409 ? ' — limit Fio API: 1 dotaz za 30 s, zkus to za chvíli.' : '') +
    (res.status === 404 ? ' — neplatný token.' : ''));
  process.exit(1);
}

const data = await res.json();
const tx = data?.accountStatement?.transactionList?.transaction ?? [];
console.log(`Pohybů v období: ${tx.length}\n`);

const val = (t, k) => (t?.[k]?.value ?? null);
const stats = Object.fromEntries(Object.keys(FIELDS).map((k) => [k, 0]));

for (const t of tx) {
  for (const k of Object.keys(FIELDS)) if (val(t, k) !== null && val(t, k) !== '') stats[k]++;
}

console.log('Obsazenost polí napříč pohyby:');
for (const [k, label] of Object.entries(FIELDS)) {
  console.log(`  ${String(stats[k]).padStart(4)} / ${tx.length}  ${k.padEnd(9)} ${label}`);
}

// Ukázka: příchozí platby, jen relevantní pole, protiúčet maskovaný.
const incoming = tx.filter((t) => Number(val(t, 'column1')) > 0).slice(0, 5);
console.log(`\nUkázka příchozích plateb (max 5):`);
for (const t of incoming) {
  const mask = (s) => (s ? String(s).replace(/\d(?=\d{4})/g, '•') : null);
  console.log('  ---');
  console.log(`  id=${val(t, 'column22')}  ${val(t, 'column0')?.slice(0, 10)}  ${val(t, 'column1')} ${val(t, 'column14')}`);
  console.log(`  VS(5)=${val(t, 'column5') ?? '—'}  komentář(25)=${val(t, 'column25') ?? '—'}`);
  console.log(`  zpráva(16)=${val(t, 'column16') ?? '—'}  ident(7)=${val(t, 'column7') ?? '—'}`);
  console.log(`  protiúčet=${mask(val(t, 'column2'))}  ${val(t, 'column10') ?? ''}`);
}

// Klíčová otázka: objeví se v API poznámka dopsaná dodatečně vlastníkem účtu?
const withComment = tx.filter((t) => val(t, 'column25'));
console.log(`\nZÁVĚR — pohybů s vyplněným komentářem (column25): ${withComment.length}`);
console.log(withComment.length
  ? 'Pole se v API objevuje → záložní párování z poznámky je proveditelné.'
  : 'Žádný komentář v tomto období. Dopiš v internetbankingu Fio komentář k jedné platbě a spusť znovu.');
