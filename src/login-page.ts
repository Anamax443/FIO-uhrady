/**
 * Přihlašovací stránka. Veřejná, takže tu nesmí být žádná data ani nápověda,
 * co je uvnitř — jen pole na PIN a poctivá hláška, když se nepovede.
 */
import { CSS, FAVICON, SYMBOLY, esc } from './ui.js';

export function prihlasovaciStranka(commit: string, hlaska: string | null, blokSekund: number): string {
  const zablokovano = blokSekund > 0;
  const minut = Math.ceil(blokSekund / 60);

  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Přihlášení — FIO-uhrady</title>
${FAVICON}
<style>${CSS}
body { display: grid; place-items: center; padding: 24px; }
.karta { width: min(360px, 100%); background: var(--pane); border: 1px solid var(--border); border-radius: 2px; }
.telo { padding: 16px 18px 18px; display: flex; flex-direction: column; gap: 11px; }
.telo h1 { margin: 0; font-size: 15px; }
label { display: flex; flex-direction: column; gap: 4px; color: var(--text-dim); }
input[type="password"] { width: 100%; height: 30px; font-family: var(--mono); font-size: 17px; letter-spacing: .28em; text-align: center; }
.chyba { color: var(--crit); }
.paticka { display: flex; gap: 10px; padding: 7px 18px; border-top: 1px solid var(--border); background: var(--chrome-hi); color: var(--text-faint); font-size: 11.5px; }
</style>
</head>
<body>
${SYMBOLY}
<div class="karta">
  <div class="panehead"><span class="brand"><span class="mark"></span>FIO-uhrady</span></div>
  <form class="telo" method="post" action="/api/prihlaseni">
    <h1>Přihlášení do správy</h1>
    ${hlaska ? `<span class="chyba">${esc(hlaska)}</span>` : ''}
    <label for="pin">PIN
      <input type="password" id="pin" name="pin" inputmode="numeric" autocomplete="current-password"
             autofocus ${zablokovano ? 'disabled' : ''} />
    </label>
    <button class="btn primary" type="submit" ${zablokovano ? 'disabled' : ''}>
      ${zablokovano ? `Zamčeno na ${minut} min` : 'Vstoupit'}
    </button>
    <span class="note">Po několika chybných pokusech se přihlášení na chvíli zamkne.</span>
  </form>
  <div class="paticka"><span>verze <b class="mono">${esc(commit)}</b></span></div>
</div>
</body>
</html>`;
}
