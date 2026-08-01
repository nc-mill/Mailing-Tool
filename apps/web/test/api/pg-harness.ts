/**
 * Postgres 18 pro databázové testy `apps/web`.
 *
 * Bootstrap žije v `@mlain/core/test-support/pg-harness`, aby existoval
 * v repozitáři jednou. Tenhle soubor je jen reexport, protože testy pod
 * `apps/web/test/api/**` a `apps/web/src/lib/api/**` na něj odkazují relativně.
 *
 * POZOR: soubory, které harness používají, musí mít na prvním řádku
 * `// @vitest-environment node`. Výchozí prostředí `apps/web` je jsdom a v něm
 * je `import.meta.url` adresa http, takže `fileURLToPath` uvnitř
 * `packages/db/src/migrate.ts` skončí na "The URL must be of scheme file".
 * A `migrate.ts` se natáhne při každém importu `@mlain/db`, tedy i skrz
 * `@mlain/core/tx`.
 */
export {
  startPgHarness,
  applyHarnessEnv,
  HARNESS_ROLES,
  type PgHarness,
  type PgHarnessOptions,
} from '@mlain/core/test-support/pg-harness';
