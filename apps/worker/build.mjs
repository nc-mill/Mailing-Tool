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
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
console.log('apps/worker/dist/main.js hotovo');
