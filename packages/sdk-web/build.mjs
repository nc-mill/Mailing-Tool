import { gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const HARD_LIMIT_BYTES = 5120;
const TARGET_BYTES = 4200;

// ODCHYLKA OD PLÁNU: build.mjs si sám přepne pracovní adresář na kořen balíčku.
// Plán počítá s relativními cestami, takže by build fungoval jen při spuštění
// z packages/sdk-web. Takhle projde i z kořene monorepa.
process.chdir(import.meta.dirname);

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = process.env.npm_package_version ?? pkg.version ?? '0.0.0';

mkdirSync('dist', { recursive: true });

// IIFE pro <script src>, ES2019 bez polyfillů.
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/ml.js',
  bundle: true,
  format: 'iife',
  target: ['es2019'],
  minify: true,
  legalComments: 'none',
  define: { __SDK_VERSION__: JSON.stringify(version) },
});

// ESM pro projekty s vlastním bundlerem.
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  format: 'esm',
  target: ['es2019'],
  minify: false,
  define: { __SDK_VERSION__: JSON.stringify(version) },
});

const raw = readFileSync('dist/ml.js');
const gzipped = gzipSync(raw).length;
writeFileSync(
  'dist/size.json',
  `${JSON.stringify({ bytes: raw.length, gzip_bytes: gzipped }, null, 2)}\n`,
);

if (gzipped > HARD_LIMIT_BYTES) {
  console.error(`SDK má ${gzipped} B gzip, tvrdý limit je ${HARD_LIMIT_BYTES} B`);
  process.exit(1);
}
if (gzipped > TARGET_BYTES) {
  console.warn(`SDK má ${raw.length} B, ${gzipped} B gzip, cíl je ${TARGET_BYTES} B`);
} else {
  console.log(`SDK má ${raw.length} B, ${gzipped} B gzip, cíl ${TARGET_BYTES} B splněn`);
}
