import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { applyFileSecrets } from './file-secrets';
import { ConfigSchema, configVariableNames, type MlainConfig } from './schema';
import { crossChecks } from './cross-checks';

export interface ConfigIssue {
  readonly variable: string;
  readonly message: string;
}

/** EX_CONFIG podle sysexits.h. Předepisuje ho část 1, kapitola 4.9. */
export const EXIT_CONFIG = 78;

export class ConfigError extends Error {
  readonly exitCode = EXIT_CONFIG;

  constructor(readonly issues: readonly ConfigIssue[]) {
    super(`Konfigurace není platná, ${issues.length} problémů.`);
    this.name = 'ConfigError';
  }

  /**
   * Vypíše VŠECHNY problémy naráz, ne jen první. Akceptační kritérium 3.
   * Nikdy netiskne hodnotu proměnné, jen její název, protože mezi nimi
   * jsou tajemství.
   */
  format(): string {
    const lines = [`Konfigurace není platná. Nalezeno ${this.issues.length} problémů:`];
    for (const issue of this.issues) {
      lines.push(`  ${issue.variable}: ${issue.message}`);
    }
    lines.push('');
    lines.push('Popis všech proměnných je v docs, kapitola "Konfigurační proměnné".');
    return lines.join('\n');
  }
}

function isWritableDirectory(target: string): boolean {
  try {
    fs.accessSync(target, fs.constants.W_OK | fs.constants.X_OK);
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Načte a ověří konfiguraci. Při jakékoliv chybě vyhodí ConfigError se
 * seznamem VŠECH problémů. Volající (entrypoint, CLI, worker) chybu vytiskne
 * na stderr a skončí s exit code 78.
 */
export function loadConfig(rawEnv: Record<string, string | undefined> = process.env): MlainConfig {
  const { env, issues: fileIssues } = applyFileSecrets(rawEnv, configVariableNames());
  const issues: ConfigIssue[] = fileIssues.map((issue) => ({
    variable: issue.variable,
    message: issue.message,
  }));

  // Prázdný řetězec znamená "nenastaveno", jinak by ${VAR:-default} v compose
  // souboru vyrobil hodnotu, kterou zod odmítne s nesrozumitelnou hláškou.
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== '') cleaned[key] = value;
  }

  const parsed = ConfigSchema.safeParse(cleaned);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const variable = String(issue.path[0] ?? '(kořen)');
      const message =
        issue.code === 'invalid_type' && issue.input === undefined
          ? 'je povinná (required) a chybí'
          : issue.message;
      issues.push({ variable, message });
    }
    throw new ConfigError(issues);
  }

  const config = parsed.data as MlainConfig;

  // Odvozené hodnoty. Musí být až po parsování, protože závisí na jiných polích.
  const dataDir = path.resolve(config.DATA_DIR);
  const derived: MlainConfig = {
    ...config,
    DATA_DIR: dataDir,
    UPLOADS_DIR: path.resolve(config.UPLOADS_DIR ?? path.join(dataDir, 'uploads')),
    BACKUP_DIR: path.resolve(config.BACKUP_DIR ?? path.join(dataDir, 'backups')),
    DATABASE_URL_SENDER: config.DATABASE_URL_SENDER ?? deriveSenderUrl(config.DATABASE_URL),
    TRACKING_DOMAIN: config.TRACKING_DOMAIN ?? new URL(config.APP_URL).host,
    ASSET_BASE_URL: config.ASSET_BASE_URL ?? config.APP_URL,
  };

  if (!isWritableDirectory(derived.DATA_DIR)) {
    issues.push({
      variable: 'DATA_DIR',
      message: `adresář ${derived.DATA_DIR} musí existovat a být zapisovatelný`,
    });
  }

  issues.push(...crossChecks(derived));

  if (issues.length > 0) throw new ConfigError(issues);
  return derived;
}

/** Při MODE=all se připojení senderu dopočítá výměnou uživatele za mlain_sender. */
function deriveSenderUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.username = 'mlain_sender';
  return url.toString();
}

export type { MlainConfig };
export { z };
