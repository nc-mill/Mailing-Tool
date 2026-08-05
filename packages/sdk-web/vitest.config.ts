import { defineConfig } from 'vitest/config';

export default defineConfig({
  // ODCHYLKA OD PLÁNU: __SDK_VERSION__ dosazuje v produkci esbuild v build.mjs.
  // Pod vitestem build neběží, takže bez téhle náhrady by kód v queue.ts spadl
  // na ReferenceError. Hodnota je záměrně jiná než v buildu, ať je v testech vidět,
  // odkud pochází.
  define: { __SDK_VERSION__: '"0.0.0-test"' },
  test: {
    environment: 'happy-dom',
    // ODCHYLKA OD PLÁNU: testy volají history.replaceState na https://shop.cz.
    // Výchozí adresa happy-dom je http://localhost:3000, což je jiný původ
    // a replaceState by selhal. Zároveň jen pod https projde cookie se Secure.
    environmentOptions: { happyDOM: { url: 'https://shop.cz/' } },
    include: ['test/**/*.test.ts'],
  },
});
