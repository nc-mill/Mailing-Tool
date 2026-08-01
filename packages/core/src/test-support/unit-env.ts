/**
 * Minimální prostředí pro JEDNOTKOVÉ testy, které se dotknou `loadConfig()`.
 * NENÍ součástí produkční cesty.
 *
 * Proč to existuje: `loadConfig()` je záměrně přísný a bez `APP_URL`,
 * `SECRET_KEY`, `DATA_DIR` a `DATABASE_URL` hodí `ConfigError` se seznamem
 * všech chybějících proměnných. Moduly jako `net/ssrf.ts` nebo
 * `platform/webhooks/backoff.ts` konfiguraci čtou LÍNĚ, takže samotný import
 * projde, ale první volání by v čistém jednotkovém běhu spadlo.
 *
 * Databázová URL je tady jen tvarová: žádné spojení se neotvírá, jednotkové
 * testy na databázi nesahají. Kdo potřebuje skutečný Postgres, bere
 * `startPgHarness()`, ne tenhle soubor.
 *
 * `MODE` se přepisuje NATVRDO ze stejného důvodu jako v `pg-harness.ts`:
 * vitest si do `process.env.MODE` dosadí vlastní režim Vite.
 */
export function applyUnitEnv(): void {
  process.env['APP_URL'] ??= 'https://mlain.test';
  process.env['SECRET_KEY'] ??= `1:${Buffer.alloc(32, 7).toString('base64url')}`;
  process.env['DATA_DIR'] ??= '/tmp';
  process.env['DATABASE_URL'] ??= 'postgres://mlain_app:mlain_app@127.0.0.1:1/mlain';
  // Křížová kontrola P01 vyžaduje migrační URL vždy, když je MIGRATE_ON_START
  // zapnuté. Jednotkové testy nemigrují, takže se vypíná celá podmínka.
  process.env['MIGRATE_ON_START'] ??= 'false';
  process.env['MODE'] = 'web';
  Object.assign(process.env, { NODE_ENV: 'test' });
}
