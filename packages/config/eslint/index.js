import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';
import { PACKAGE_DIRECTORIES, PACKAGE_GRAPH } from '../src/package-graph.ts';
import { boundariesConfig } from './boundaries.js';

/**
 * Zóny pro import/no-restricted-paths. Tohle je JEDINÁ vrstva, která hlídá
 * přechod hranice relativní cestou, protože jako jediná specifikátor rozřeší
 * na skutečnou cestu k souboru. `no-restricted-imports` v boundaries.js zná
 * jen řetězec a hloubku importujícího souboru odvodit neumí.
 *
 * Exportuje se kvůli testu, který na zónách ověřuje pokrytí zakázaných dvojic.
 */
export function restrictedPathZones() {
  const zones = [];
  for (const [name, allowed] of Object.entries(PACKAGE_GRAPH)) {
    const allowedDirs = new Set(allowed.map((dep) => PACKAGE_DIRECTORIES[dep]));
    for (const [other, otherDir] of Object.entries(PACKAGE_DIRECTORIES)) {
      if (other === name || allowedDirs.has(otherDir)) continue;
      zones.push({
        target: `./${PACKAGE_DIRECTORIES[name]}`,
        from: `./${otherDir}`,
        message: `${name} nesmí sahat do ${other}.`,
      });
    }
  }
  return zones;
}

export default [
  {
    /*
     * Výstupy nástrojů, ne zdrojový kód. Reporty Playwrightu sem přibyly proto,
     * že v nich leží zabalený prohlížeč trasování, tedy stovky kilobajtů cizího
     * minifikovaného javascriptu. Lint na nich hlásil 3939 chyb, což je 99,9 %
     * všech chyb celého repozitáře, a skutečné nálezy v našem kódu se v tom
     * ztratily. Adresáře jsou zároveň v `.gitignore`, takže se lintovaly jen
     * na stroji, kde zrovna běžely testy prohlížečem.
     */
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/playwright-report*/**',
      '**/test-results/**',
      '**/.playwright-mcp/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    name: 'mlain/base',
    plugins: { import: importPlugin },
    rules: {
      'import/no-restricted-paths': ['error', { zones: restrictedPathZones() }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['error'] }],
    },
  },
  ...boundariesConfig(),
  {
    // .mjs a .cjs skripty (CI nástroje v tools/**, ESLint pravidla v
    // packages/ui/eslint-rules) běží v Node mimo TypeScript, takže jim chybí
    // ambientní globály z @types/node, které typescript-eslint dodává .ts
    // souborům automaticky přes scope manager napojený na TS type checker.
    // Bez tohohle bloku by 'process', 'console', 'module' a 'require'
    // hlásily no-undef.
    name: 'mlain/node-scripts',
    files: ['tools/**/*.mjs', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        module: 'readonly',
        exports: 'writable',
        require: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
  },
  {
    // .cjs soubory jsou v tomhle repu jen ESLint pravidla a jejich testy
    // (packages/ui/eslint-rules). Jsou legitimně CommonJS a jejich
    // console.log je nástrojový výstup do terminálu, ne prohřešek
    // v produkčním kódu.
    name: 'mlain/cjs-scripts',
    files: ['**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
    },
  },
  {
    // CLI, CI skripty a build skripty jsou nástroje pro člověka u terminálu,
    // tam je stdout výstup, ne prohřešek.
    //
    // Bez `**/build.mjs`, `**/codegen.mjs` a `packages/core/scripts/**` by
    // pravidlo `no-console` shodilo čtyři soubory, které tenhle plán sám píše:
    // apps/worker/build.mjs, apps/cli/build.mjs, apps/worker/codegen.mjs
    // a packages/core/scripts/write-manifest.ts. Všechny čtyři končí řádkem
    // `console.log`, kterým hlásí, co vyrobily, a job `lint` by byl červený
    // od úkolu 10 dál. Ověřeno spuštěním ESLintu nad těmi cestami.
    //
    // `packages/contracts/scripts/**` je stejný případ: CLI skripty
    // (check-parity, sync-config-manifest, validate-fixtures) hlásí výsledek
    // přes console.log/console.warn, ne jen console.error.
    // `packages/db/src/migrate.ts` má vlastní volitelný `logger`, jehož
    // výchozí implementace píše přes console.info na terminál pro člověka,
    // který migraci spouští.
    name: 'mlain/tooling-console',
    files: [
      'apps/cli/**/*.ts',
      'tools/**/*.mjs',
      'tools/**/*.ts',
      '**/build.mjs',
      '**/codegen.mjs',
      'packages/core/scripts/**/*.ts',
      'packages/contracts/scripts/**/*.ts',
      // `packages/emails/scripts/**` generuje fixtures kompilované šablony
      // a hlásí u toho počet vyrobených souborů. Je to nástroj s výstupem
      // pro člověka u terminálu, ne produkční cesta.
      'packages/emails/scripts/**/*.ts',
      'packages/db/src/migrate.ts',
      // `docker/collect-runtime-deps.mjs` je stavební skript image: na konci
      // vypíše, kolik balíčků posbíral a které to jsou. Je to jediný doklad
      // o tom, co se do runtime vrstvy dostalo, takže se čte při stavbě
      // i z logu buildu. Přepsat ho na `console.error` by výsledek přesunul
      // mezi chyby, kam nepatří, a mlčky ho zavřít by znamenalo, že chybějící
      // balíček se pozná až pádem workeru za běhu.
      'docker/**/*.mjs',
    ],
    rules: { 'no-console': 'off' },
  },
];
