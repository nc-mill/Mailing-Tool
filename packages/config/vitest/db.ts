import { defineConfig, type ViteUserConfig } from 'vitest/config';

/**
 * Sdílený preset pro testy proti databázi. Vzor `*.db.test.ts` je závazný:
 * podle něj se testy dělí mezi joby test-unit a test-db a soubor mimo vzor
 * by se v CI nespustil ani v jednom z nich, aniž by cokoliv zčervenalo.
 */
export function dbPreset(overrides: ViteUserConfig = {}): ViteUserConfig {
  return defineConfig({
    ...overrides,
    test: {
      environment: 'node',
      include: ['src/**/*.db.test.ts', 'test/**/*.db.test.ts'],
      testTimeout: 60_000,
      hookTimeout: 120_000,
      fileParallelism: false,
      reporters: ['default'],
      ...overrides.test,
    },
  });
}
