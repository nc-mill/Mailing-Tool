import path from 'node:path';
import { withMlainIntl } from '@mlain/i18n/next-plugin';
import type { NextConfig } from 'next';

// Produkční build se nesmí spustit s jiným NODE_ENV než `production`.
//
// `next build` si NODE_ENV doplní jen tehdy, když není nastavené. Když do
// prostředí prosákne `NODE_ENV=development` (nejčastěji přes
// `set -a && . apps/web/.env.local && set +a` před buildem, protože ten soubor
// tu proměnnou obsahuje, a `turbo.json` má NODE_ENV v `globalEnv`, takže ji
// propustí dál), Next build nezastaví ani nevaruje. Postaví ale aplikaci, která
// má v jednom procesu dvě různé instance Reactu:
//
//   - Chunky se zkompilují natvrdo proti `app-page-turbo.runtime.prod.js`.
//     Rozhodne se to v čase kompilace, `next/dist/server/route-modules/
//     app-page/module.compiled.js` se v bundlu smrskne na jedinou větev.
//   - Renderer si Next za běhu vybere podle NODE_ENV, tedy
//     `app-page-turbo.runtime.dev.js`.
//
// Hooky pak sahají do jiné instance Reactu, než která zrovna rendruje. Její
// dispatcher (`ReactSharedInternals.H`) je null a prerender spadne na
//
//   TypeError: Cannot read properties of null (reading 'useContext')
//       at OuterLayoutRouter (.next/server/chunks/ssr/…)
//
// To hlášení neukazuje na příčinu ani vzdáleně: v zásobníku je vidět jen
// vnitřek Nextu, chunk je zminifikovaný a padá to na stránkách, které si Next
// generuje sám (`/_global-error`, `/_not-found`). Navíc nedeterministicky,
// podle toho, jak se routy rozdělí mezi prerender workery. Hlídač je tady
// proto, aby se z toho stala srozumitelná chyba hned na začátku.
//
// Skript `build` v package.json NODE_ENV rovnou nastavuje, tohle chytá případ,
// kdy někdo spustí `next build` ručně mimo něj.
if (process.argv[2] === 'build' && process.env.NODE_ENV !== 'production') {
  throw new Error(
    `Produkční build vyžaduje NODE_ENV=production, ale dostal '${process.env.NODE_ENV}'. ` +
      'Nejčastější příčina je načtení apps/web/.env.local do shellu před buildem. ' +
      'Spusť build přes `pnpm --filter @mlain/web run build`, nebo NODE_ENV nastav ručně.',
  );
}

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  // Kořen workspace se v monorepu MUSÍ nastavit výslovně. Bez toho si ho
  // Turbopack odvozuje a při prvním přibylém adresáři pod src/app si odvodí
  // `apps/web/src/app`, odkud `next/package.json` nedohledá. Neprojeví se to
  // chybou v kódu, ale panikou celého Turbopacku a pádem dev serveru.
  turbopack: {
    root: path.join(import.meta.dirname, '../..'),
  },
  reactStrictMode: true,
  poweredByHeader: false,
  // Vývojové zdroje pod `_next` obsluhuje Next jen pro povolené originy. Bez
  // `127.0.0.1` v seznamu dostane prohlížeč místo websocket handshaku obyčejnou
  // HTTP odpověď (`ERR_INVALID_HTTP_RESPONSE`) a klientský runtime se vůbec
  // nerozjede: stránka se vykreslí ze serveru, ale React se nenamountuje, takže
  // nereaguje na kliknutí ani na klávesy a nespustí se žádný `useEffect`.
  // Vypadá to jako vada komponent, přitom komponenty nedostaly šanci se spustit.
  // `localhost` a `127.0.0.1` tady nejsou synonyma, ačkoli vedou na tentýž
  // proces. V produkci se neuplatní, týká se výhradně vývojového režimu.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  // Balíčky @mlain/* jsou zdrojové, bez vlastního buildu.
  transpilePackages: ['@mlain/ui', '@mlain/i18n'],
  experimental: {
    // Ikony se importují jmenovitě, aby se nikdy nezabalil celý balík (14.3).
    optimizePackageImports: ['lucide-react'],
  },
  // Graceful shutdown registruje src/instrumentation.ts. Žádný přepínač
  // nepotřebuje: instrumentation.ts je od Next 15 stabilní a načítá se sám.
};

// Typová anotace je nutná: `withMlainIntl` vrací typ odvozený z vnořené
// instalace `next` v `next-intl/plugin`, kterou TypeScript nedokáže
// pojmenovat napříč pnpm store (TS2742). Konfigurace samotná se tím nemění.
const finalConfig: NextConfig = withMlainIntl(config);

export default finalConfig;
