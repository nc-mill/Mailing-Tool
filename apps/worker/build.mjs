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
  // `sharp` (zmenšování obrázků, miniatury, rasterizace SVG) je tentýž případ
  // a přišel s doménou assetů. Bez něj v `external` ho esbuild sice zabundluje,
  // ale za běhu se pokusí načíst nativní variantu z cesty, kterou rozvržení
  // pnpm bez symlinku nevyřeší:
  //
  //   Error: Could not load the "sharp" module using the linuxmusl-arm64 runtime
  //
  // Padá na tom WORKER, a protože `MODE=all` drží tři procesy pohromadě, sundá
  // to celý kontejner do restartové smyčky. Web přitom stihne naběhnout, takže
  // to chvíli vypadá zdravě.
  //
  // Runtime vrstva Dockerfile proto musí mít tyhle balíčky k dispozici
  // v node_modules, na rozdíl od zbytku, který je uvnitř dist/main.js.
  // SAMOTNÉ `external` NESTAČÍ: bez kopie do runtime se chyba jen přesune
  // z „nelze načíst modul" na „modul nenalezen".
  external: ['@node-rs/argon2', 'sharp'],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
console.log('apps/worker/dist/main.js hotovo');
