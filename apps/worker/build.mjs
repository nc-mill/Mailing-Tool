import { build } from 'esbuild';

// Bundle do jediného souboru, protože runtime vrstva Dockerfile kopíruje jen
// apps/worker/dist, ne node_modules workeru.
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
  // `@node-rs/argon2` (hashování hesel) přitáhne přes svůj `index.js` soubor
  // `.node`, pro který esbuild nemá loader, a build spadne na
  // „No loader is configured for .node files". Bundlovat nativní modul stejně
  // nejde: je to zkompilovaná knihovna pro konkrétní architekturu, ne JavaScript.
  //
  // Runtime vrstva Dockerfile proto musí mít tyhle balíčky k dispozici
  // v node_modules, na rozdíl od zbytku, který je uvnitř dist/main.js.
  external: ['@node-rs/argon2'],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
console.log('apps/worker/dist/main.js hotovo');
