import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  // Balíčky s NATIVNÍ binárkou se nebalí, načtou se za běhu.
  //
  // CLI hashuje hesla kvůli `mlain reset-password`, takže sahá na
  // `@node-rs/argon2` stejně jako worker. Ten přitáhne přes svůj `index.js`
  // soubor `.node`, pro který esbuild nemá loader, a build spadne na
  // „No loader is configured for .node files". Bundlovat nativní modul nejde
  // z principu: je to zkompilovaná knihovna pro konkrétní architekturu.
  //
  // Runtime vrstva Dockerfile proto musí mít tenhle balíček v node_modules.
  external: ['@node-rs/argon2'],
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
console.log('apps/cli/dist/main.js hotovo');
