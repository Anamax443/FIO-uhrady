-- Přihlášení PINem jako záloha, když není Cloudflare Access. Spouští uživatel:
--   npx wrangler d1 execute fio-uhrady --remote --file schema/0003_prihlaseni.sql
--
-- PIN se neukládá — v `settings` je jen jeho otisk (`admin_pin_hash`) se solí
-- (`admin_pin_salt`). Z otisku se PIN zpět nedopočítá.
--
-- Krátký PIN se dá uhodnout hrubou silou, proto se počítají neúspěšné pokusy
-- a po pár chybách se adresa na chvíli zamkne. Bez toho by čtyřmístný PIN
-- padl během vteřin.
create table if not exists login_attempts (
  ip          text primary key,
  pokusy      integer not null default 0,
  posledni    text    not null default (datetime('now')),
  blok_do     text
);
