import base from './packages/config/eslint/index.js';
import noRawFetchInBrand from './packages/core/eslint-rules/no-raw-fetch-in-brand.cjs';

/**
 * Kritérium 56 plánu P15: v `packages/core/src/brand` a `packages/core/src/templates`
 * se ven chodí výhradně přes `safeFetch`.
 *
 * Pravidlo se připojuje tady, v kořenovém souboru, a ne v `packages/config`.
 * Důvod je hranice balíčků: `@mlain/config` má v `PACKAGE_GRAPH` prázdný seznam
 * závislostí, takže by import z `packages/core` shodil `import/no-restricted-paths`
 * na tomtéž běhu lintu. Kořenový soubor uvnitř žádného balíčku neleží, takže
 * se ho zóny netýkají.
 */
export default [
  ...base,
  {
    /**
     * Skripty v `public/` a v ukázkové stránce návrhu běží v PROHLÍŽEČI,
     * ne v Node.
     *
     * Bez tohohle je `document` i `window` neznámý identifikátor a lint hlásí
     * `no-undef` na kódu, který je správně. Svádí to k tomu skript přepsat nebo
     * pravidlo vypnout globálně; obojí by bylo horší než říct pravdu o tom,
     * kde ten soubor běží.
     *
     * Statické skripty jsou tu schválně, ne jako vložený kód ve stránce: nese
     * je cache prohlížeče, projdou přísnou politikou obsahu a nikdy do nich
     * nemůže vstoupit hodnota z požadavku.
     *
     * `docs/design/**` je statická ukázka návrhového systému, kterou si otevře
     * člověk v prohlížeči. Zvažoval jsem ji z lintu vyřadit úplně a zahodil
     * jsem to: je to pořád javascript, který se spouští, takže nepoužitá
     * proměnná nebo překlep v ní je stejná vada jako kdekoli jinde. Chyběla
     * jí jen pravda o prostředí, a to je jeden řádek, ne výjimka z kontroly.
     */
    name: 'mlain/browser-scripts',
    files: ['apps/web/public/**/*.js', 'docs/design/**/*.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
        location: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
      },
    },
  },
  {
    name: 'mlain/brand-no-raw-fetch',
    files: ['packages/core/src/brand/**/*.ts', 'packages/core/src/templates/**/*.ts'],
    plugins: { mlain: { rules: { 'no-raw-fetch-in-brand': noRawFetchInBrand } } },
    rules: { 'mlain/no-raw-fetch-in-brand': 'error' },
  },
];
