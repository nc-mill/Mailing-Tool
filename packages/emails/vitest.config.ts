import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    globals: false,
  },
  // Vitest 4 transformuje přes oxc, ne přes esbuild. Klíč `esbuild` z plánu by se
  // tiše ignoroval a .tsx emitteru by jel jen na výchozím chování transformátoru.
  oxc: { jsx: { runtime: 'automatic' } },
});
