import { defineConfig, type ViteUserConfig } from 'vitest/config';

/**
 * Sdílený preset pro testy bez databáze. Balíček ho použije takto:
 *   import { nodePreset } from '@mlain/config/vitest/node';
 *   export default nodePreset();
 */
export function nodePreset(overrides: ViteUserConfig = {}): ViteUserConfig {
  return defineConfig({
    ...overrides,
    test: {
      environment: 'node',
      // Vitest si do process.env.MODE zapisuje svůj vlastní režim ("test"),
      // protože MODE je zároveň jméno režimu ve Vite. Naše konfigurační schéma
      // ale MODE používá jako přepínač procesu s výčtem web, worker, sender, all,
      // takže loadConfig() spadne v KAŽDÉM testu, který se konfigurace dotkne,
      // a to i když se MODE do prostředí výslovně předá. Naměřeno spuštěním:
      // `MODE=web vitest run` vidí uvnitř testu MODE === "test".
      // Tenhle řádek vrací hodnotu z prostředí zpátky.
      env: { MODE: process.env['MODE'] ?? 'web', ...overrides.test?.env },
      // src/ je ve vzoru schválně: testy vedle zdroje jsou běžný tvar a soubor
      // mimo vzor se v CI nespustí ani v jednom jobu, aniž by cokoliv zčervenalo.
      // src/ je ve vzoru schválně: testy vedle zdroje jsou běžný tvar a soubor
      // mimo vzor se v CI nespustí ani v jednom jobu, aniž by cokoliv zčervenalo.
      include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
      exclude: ['**/*.db.test.ts'],
      reporters: ['default'],
      ...overrides.test,
    },
  });
}
