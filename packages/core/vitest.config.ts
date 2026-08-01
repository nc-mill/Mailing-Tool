import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Vitest jinak přepíše MODE na "test" a loadConfig() spadne. Zdůvodnění
    // je v packages/config/vitest/node.ts, kde je tentýž řádek.
    env: { MODE: process.env['MODE'] ?? 'web' },
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: { branches: 80 },
    },
  },
});
