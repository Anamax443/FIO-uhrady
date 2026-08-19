/**
 * Nasazení s otiskem commitu, ať se dá živá verze ověřit proti gitu:
 *   npm run deploy   →   GET /api/version vrátí { commit: "<hash>" }
 */
import { execFileSync } from 'node:child_process';

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf8' }).trim();

let commit = 'dev';
try {
  commit = run('git', ['rev-parse', '--short', 'HEAD']);
  const dirty = run('git', ['status', '--porcelain']);
  if (dirty) {
    console.error('Pracovní strom není čistý — nasazovalo by se něco, co není v gitu.');
    console.error(dirty);
    process.exit(1);
  }
} catch {
  console.error('Nepodařilo se zjistit commit z gitu.');
  process.exit(1);
}

console.log(`Nasazuji commit ${commit}`);
execFileSync('npx', ['wrangler', 'deploy', '--var', `GIT_COMMIT:${commit}`], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
console.log(`\nHotovo. Ověř: /api/version → commit ${commit}`);
