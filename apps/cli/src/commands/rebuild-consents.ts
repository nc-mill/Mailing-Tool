import { parseArgs } from 'node:util';
import { rebuildConsents } from '@mlain/core/ops';
import { EXIT_CONFIG, EXIT_OK, EXIT_USAGE } from '../exit-codes';
import { loadCliConfig } from './load-cli-config';
import type { CliStreams } from '../dispatch';

/**
 * `mlain rebuild-consents`
 *
 * Přepočítá `contact_consent_state` z append-only logu `consents`. Potřeba je to po
 * obnově ze zálohy a po migraci, kdy se odvozený stav mohl s logem rozejít.
 *
 * PROČ PŘÍKAZ VZNIKL. Frontu `consents.rebuild_state` registr popisuje jako něco,
 * co „se zařazuje jedině ručně po obnově ze zálohy nebo po migraci", jenže žádný
 * ruční způsob neexistoval: obsluha byla hotová a nevedla k ní ani cesta API, ani
 * příkaz. Jediná cesta do fronty byl ruční INSERT do tabulky úloh pg-bossu, a to
 * ve chvíli, kdy operátor zachraňuje instalaci.
 */
export async function runRebuildConsentsCommand(
  streams: CliStreams,
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: { workspace: { type: 'string' } },
    allowPositionals: false,
  });
  if (!values.workspace) {
    streams.stderr('Použití: mlain rebuild-consents --workspace <id>');
    return EXIT_USAGE;
  }

  const loaded = loadCliConfig(streams, env);
  if (loaded.config === null) return loaded.code;
  const config = loaded.config;

  // `consents` i `contact_consent_state` mají ws_isolation. Pod aplikační rolí bez
  // kontextu by přepočet prošel, zpracoval nula řádků a ohlásil „hotovo", což je
  // po obnově ze zálohy ta nejdražší možná odpověď. Týž důvod má rebuild-engagement.
  if (!config.DATABASE_URL_MIGRATOR) {
    streams.stderr(
      'Přepočet vyžaduje DATABASE_URL_MIGRATOR. Pod aplikační rolí by kvůli row level ' +
        'security zpracoval nula řádků a skončil hlášením „hotovo".',
    );
    return EXIT_CONFIG;
  }

  const report = await rebuildConsents({
    adminUrl: config.DATABASE_URL_MIGRATOR,
    workspaceId: values.workspace,
  });
  streams.stdout(`Hotovo. Přepočteno ${report.rebuilt} řádků stavu souhlasů.`);
  return EXIT_OK;
}
