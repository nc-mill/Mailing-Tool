import type { createApiApp } from '../../../src/lib/api/app';

export type TestApp = ReturnType<typeof createApiApp>;

/**
 * Postaví aplikaci Hono pro integrační test a zaregistruje do ní zadané cesty.
 *
 * ODCHYLKA OD PLÁNU, a je nutná. Plán stavěl aplikaci na úrovni modulu
 * (`const app = createApiApp()`), jenže `apps/web/src/lib/api/app.ts` táhne
 * `rate-limit.ts`, který čte konfiguraci UŽ PŘI IMPORTU (tabulka pravidel je
 * `const` a bere z ní výchozí body). V okamžiku importu testovacího souboru
 * ale prostředí ještě neexistuje: nastavuje ho `startPgHarness()` v `beforeAll`.
 * Import se proto odkládá dovnitř, ať je pořadí "nejdřív harness, pak
 * aplikace" vynucené a ne jen doufané.
 */
export async function createTestApp(...register: Array<(app: TestApp) => void>): Promise<TestApp> {
  const { createApiApp } = await import('../../../src/lib/api/app');
  const app = createApiApp();
  for (const fn of register) fn(app);
  return app;
}
