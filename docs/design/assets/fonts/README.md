# Self-hosting fontů

Web zatím načítá IBM Plex Sans a IBM Plex Mono z Google Fonts CDN (dočasný fallback). Pro produkci:

1. Stáhni `woff2` (subsety **latin + latin-ext**), např. přes https://gwfh.mranftl.com/fonts:
   - `ibm-plex-sans-400.woff2`
   - `ibm-plex-sans-600.woff2`
   - `ibm-plex-mono-400.woff2`
2. Ulož je sem do `assets/fonts/` pod přesně těmito názvy.
3. Ve `style.css` odkomentuj blok `@font-face` na začátku souboru.
4. Ze všech HTML souborů odstraň `<link>` na `fonts.googleapis.com`.
