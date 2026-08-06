import type { CliStreams } from '../dispatch';

/**
 * JEDINÉ místo, které překládá selhanou migraci na exit kód a na hlášku.
 *
 * Historie: exit kódy 3 (selhaná migrace), 4 (přeskočená major verze),
 * 5 (schema_version_ahead) a 75 (timeout zámku) uměl vrátit jen
 * `mlain migrate`. `mlain restore` a `mlain upgrade` volají týž runner, ale
 * `MigrationError` pouštěly ven: `dispatch` ji nechytá, `main.ts` taky ne,
 * takže proces skončil kódem 1 a stackem. Provozovatel po havárii viděl
 * `at runMigrations (file:///app/apps/cli/dist/main.js:…)` místo věty, co se
 * stalo, a entrypoint neměl podle čeho rozhodnout, jestli má restartovat.
 *
 * Rozpoznává se PODLE TVARU, ne přes `instanceof`. Runner se do procesu
 * dostává dynamickým importem z `packages/core` i z `apps/cli` a v zabundlované
 * aplikaci může vzniknout druhá kopie modulu, tedy druhá třída `MigrationError`.
 * `instanceof` by pak tiše vrátil `false` a chyba by zase propadla jako pád se
 * stackem, což je přesně ta vada, kterou tenhle soubor uzavírá.
 */
export interface MigrationFailure {
  message: string;
  exitCode: number;
  code: string;
}

export function asMigrationFailure(error: unknown): MigrationFailure | null {
  if (!(error instanceof Error) || error.name !== 'MigrationError') return null;
  const candidate = error as Error & { exitCode?: unknown; code?: unknown };
  if (!Number.isInteger(candidate.exitCode)) return null;
  return {
    message: error.message,
    exitCode: candidate.exitCode as number,
    code: typeof candidate.code === 'string' ? candidate.code : 'migration_failed',
  };
}

/**
 * Vypíše selhanou migraci a vrátí její exit kód, nebo `null`, když o migrační
 * chybu nejde a volající ji má pustit dál.
 *
 * `consequences` jsou řádky, které řeknou, v jakém stavu instalace zůstala.
 * U obnovy ze zálohy je to podstatnější než sama chyba: za migrací stojí
 * `mlain_apply_grants()` a při pádu se NEPROVEDE, takže databáze existuje,
 * data v ní jsou, a aplikace přesto odpoví `permission denied for table
 * contacts`.
 */
export function reportMigrationFailure(
  streams: CliStreams,
  error: unknown,
  consequences: readonly string[] = [],
): number | null {
  const failure = asMigrationFailure(error);
  if (failure === null) return null;
  streams.stderr(`Migrace selhala: ${failure.message}`);
  for (const line of consequences) streams.stderr(line);
  return failure.exitCode;
}
