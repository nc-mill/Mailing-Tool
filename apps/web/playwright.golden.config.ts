import { defineConfig, devices } from '@playwright/test';

/**
 * Druhá konfigurace vedle `playwright.config.ts`, kterou vlastní P05 pro testy
 * komponent. Tahle jede zlatou cestu proti skutečnému compose, takže má delší
 * timeouty, jednoho workera a nulové opakování: přeběhnutý test zlaté cesty
 * je horší než červený, protože skryje závadu, kterou má odhalit.
 */
export default defineConfig({
  testDir: './e2e/golden/specs',
  globalSetup: './e2e/golden/global-setup.ts',
  globalTeardown: './e2e/golden/global-teardown.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-golden', open: 'never' }]],
  use: {
    baseURL: process.env.MLAIN_E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'cs-CZ',
    timezoneId: 'Europe/Prague',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
