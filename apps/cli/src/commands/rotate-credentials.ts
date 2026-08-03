import { enqueueRefingerprint, keyringEnvFromConfig, rotateCredentials } from '@mlain/core/ops';
import { EXIT_CONFIG, EXIT_OK } from '../exit-codes';
import { loadCliConfig } from './load-cli-config';
import type { CliStreams } from '../dispatch';

export async function runRotateCredentialsCommand(
  streams: CliStreams,
  _argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const loaded = loadCliConfig(streams, env);
  if (loaded.config === null) return loaded.code;
  const config = loaded.config;
  if (!config.DATABASE_URL_MIGRATOR) {
    streams.stderr(
      'Rotace vyžaduje DATABASE_URL_MIGRATOR. Sloupce s obálkami leží v tabulkách ' +
        's row level security, takže by aplikační role nenašla ani jeden řádek ' +
        'a rotace by skončila hlášením „přešifrováno 0".',
    );
    return EXIT_CONFIG;
  }
  const keys = keyringEnvFromConfig(config);
  const report = await rotateCredentials({
    adminUrl: config.DATABASE_URL_MIGRATOR,
    secretKey: keys.secretKey,
    secretKeyPrevious: keys.secretKeyPrevious,
  });
  streams.stdout(`Přešifrováno ${report.rotated}, už na aktuálním klíči ${report.alreadyCurrent}.`);
  if (report.failed.length > 0) {
    streams.stderr(`Nepodařilo se přešifrovat ${report.failed.length} hodnot:`);
    for (const f of report.failed) streams.stderr(`  - ${f}`);
  }

  // Přešifrovat jde jen to, co je uložené jako obálka. Otisky adres v
  // `contacts.email_fingerprints` se nešifrují, ale POČÍTAJÍ z klíče, takže po
  // rotaci chybí kontaktům otisk pod novým pokolením. Bez tohohle kroku by
  // rotace skončila úspěchem a kontrola suppression by se na nové pokolení
  // spoléhala u kontaktů, které ho nemají. Doplnění běží ve frontě, protože
  // jde o průchod všemi kontakty instalace.
  const rotationFailed = report.failed.length > 0;
  let enqueueFailed = false;
  try {
    await enqueueRefingerprint(keys);
    streams.stdout(
      'Zařazena úloha contacts.refingerprint: doplní kontaktům otisk adresy pod novým pokolením.',
    );
  } catch (error) {
    enqueueFailed = true;
    streams.stderr(
      'Přešifrování proběhlo, ale úlohu contacts.refingerprint se nepodařilo zařadit: ' +
        `${error instanceof Error ? error.message : String(error)}. ` +
        'Kontaktům tedy chybí otisk adresy pod novým pokolením klíče. Spusťte příkaz znovu, ' +
        'až poběží worker; přešifrování je idempotentní a nic nepokazí.',
    );
  }

  streams.stdout(report.notice);
  return rotationFailed || enqueueFailed ? 1 : EXIT_OK;
}
