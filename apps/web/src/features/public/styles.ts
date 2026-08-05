/**
 * Minimální styl veřejných stránek. Žádný framework, žádné externí písmo, nic,
 * co by prodloužilo načtení. Rozpočet je sto kilobajtů na celou stránku.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ NEXT.JS. Plán měl `public.css` vedle `layout.tsx`
 * a importoval ho příkazem `import './public.css'`. Veřejné stránky jsou tady route
 * handlery (viz `render.tsx`, odstavec o kolizi `page.tsx` a `route.ts`), a do route
 * handleru se soubor CSS naimportovat nedá: bundler ho vloží do stránky, kterou
 * handler nevykresluje. Styl je proto řetězec, který se vypíše do jediné značky
 * `<style>`. Politika obsahu to dovoluje, `style-src` má `'unsafe-inline'`.
 *
 * Barvy a logo projektu se dosazují proměnnou, kterou vykreslí server, aby stránka
 * vypadala jako od odesílatele a nebudila podezření na podvod.
 */
export const PUBLIC_CSS = `
.ml-public {
  --ml-surface: #ffffff;
  --ml-text: #1a1a1a;
  --ml-muted: #5a5a5a;
  --ml-accent: var(--ml-brand-color, #1f6feb);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: #f5f5f5;
  color: var(--ml-text);
  /* Jména písem jsou BEZ uvozovek schválně: styl se vypisuje jako textový obsah
     značky <style> a React by uvozovky nahradil entitou, kterou prohlížeč uvnitř
     <style> nedekóduje. Nekvotované Segoe UI je podle gramatiky font-family platné. */
  font: 16px/1.6 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
.ml-public__card {
  background: var(--ml-surface);
  border-radius: 12px;
  padding: 2rem;
  max-width: 32rem;
  width: 100%;
  box-shadow: 0 1px 3px rgb(0 0 0 / 12%);
}
.ml-public h1 { font-size: 1.5rem; margin: 0 0 1rem; }
.ml-public h2 { font-size: 1.125rem; margin: 1.5rem 0 0.5rem; }
.ml-public p { margin: 0 0 1rem; }
.ml-public form { margin: 0 0 1rem; }
.ml-public fieldset { border: 0; padding: 0; margin: 0 0 1rem; }
.ml-public legend { font-weight: 600; padding: 0; }
.ml-public label { display: block; margin: 0.5rem 0; }
.ml-public input[type="text"],
.ml-public input[type="email"],
.ml-public select {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: 0.5rem 0.75rem;
  font-size: 1rem;
  border: 1px solid #b9b9b9;
  border-radius: 8px;
  background: var(--ml-surface);
  color: var(--ml-text);
}
.ml-public .ml-muted { color: var(--ml-muted); font-size: 0.9375rem; }
.ml-public .ml-sender { color: var(--ml-muted); font-size: 0.9375rem; margin-bottom: 1.5rem; }
/* Popis odběru pod zaškrtávátkem. Musí být na vlastním řádku, jinak splyne s názvem. */
.ml-public .ml-block { display: block; margin: 0.125rem 0 0 1.75rem; }
/* Cílová plocha nejméně 44 krát 44 bodů podle požadavků na přístupnost. */
.ml-public button,
.ml-public .ml-button {
  display: inline-block;
  min-height: 44px;
  padding: 0.75rem 1.5rem;
  font-size: 1rem;
  border-radius: 8px;
  border: 0;
  background: var(--ml-accent);
  color: #ffffff;
  cursor: pointer;
  text-decoration: none;
}
.ml-public .ml-button--secondary {
  background: transparent;
  color: var(--ml-accent);
  border: 1px solid currentColor;
}
.ml-public :focus-visible { outline: 3px solid var(--ml-accent); outline-offset: 2px; }
@media (prefers-color-scheme: dark) {
  .ml-public { background: #121212; --ml-surface: #1e1e1e; --ml-text: #f0f0f0; --ml-muted: #b0b0b0; }
  .ml-public input[type="text"],
  .ml-public input[type="email"],
  .ml-public select { border-color: #4a4a4a; }
}
`.trim();
