import { redressAllWorkspacesToBrand } from '@mlain/core/ops';
import { EXIT_CONFIG, EXIT_OK } from '../exit-codes';
import { loadCliConfig } from './load-cli-config';
import type { CliStreams } from '../dispatch';

/**
 * `mlain redress-brand`
 *
 * Převleče uložené e-maily do barev značky projektu. Potřebují to instalace,
 * které značku nastavené mají a od upgradu ji znovu neuloží: převlékání jinak
 * spouští až uložení značky, takže by jim zůstaly staré barvy napořád.
 *
 * Druhé spuštění nic nezmění, převlečení je idempotentní.
 */
export async function runRedressBrandCommand(
  streams: CliStreams,
  _argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const loaded = loadCliConfig(streams, env);
  if (loaded.config === null) return loaded.code;
  const config = loaded.config;

  /*
   * Výpis projektů jde napříč projekty, a tam politiky RLS překážejí: pod
   * aplikační rolí bez kontextu by dotaz vrátil nula řádků a příkaz by ohlásil
   * „hotovo", aniž by cokoli udělal. Týž důvod má `rebuild-engagement`.
   * Samotné převlékání pak běží pod aplikační rolí s kontextem projektu.
   */
  if (!config.DATABASE_URL_MIGRATOR) {
    streams.stderr(
      'Převlečení vyžaduje DATABASE_URL_MIGRATOR. Pod aplikační rolí by kvůli row level ' +
        'security našlo nula projektů a skončilo hlášením „hotovo".',
    );
    return EXIT_CONFIG;
  }

  const report = await redressAllWorkspacesToBrand({
    adminUrl: config.DATABASE_URL_MIGRATOR,
    onProgress: (line) => streams.stdout(line),
  });

  streams.stdout(
    `Hotovo. Projektů se značkou ${report.workspaces}, prošlo ${report.scanned} e-mailů, ` +
      `převlečeno ${report.changed}.`,
  );
  return EXIT_OK;
}
