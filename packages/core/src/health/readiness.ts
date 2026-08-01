import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import type { Check, CheckResult, ReadinessResult } from './types';

/** Neexistující tabulka v PostgreSQL. */
const UNDEFINED_TABLE = '42P01';

export async function buildReadiness(checks: readonly Check[]): Promise<ReadinessResult> {
  const results = await Promise.all(
    checks.map(async (check): Promise<CheckResult> => {
      const started = Date.now();
      try {
        const result = await check();
        return { ...result, duration_ms: Date.now() - started };
      } catch (error) {
        return {
          name: 'unknown',
          status: 'fail',
          detail: (error as Error).message,
          duration_ms: Date.now() - started,
        };
      }
    }),
  );
  const failed = results.some((result) => result.status === 'fail');
  return {
    status: failed ? 'fail' : 'ok',
    httpStatus: failed ? 503 : 200,
    checks: results,
  };
}

export interface DatabaseCheckOptions {
  readonly connectionString: string;
  /** Část 1, kapitola 3.12: SELECT 1 s timeoutem 2 s. */
  readonly timeoutMs?: number;
}

/**
 * ROZHODNUTÍ D2: krátkodobé spojení, ne pool. Pool vlastní packages/db (P03)
 * a teplý pool by zamaskoval to, co probe má ověřit, tedy že jde navázat NOVÉ
 * spojení. Při intervalu 15 s to jsou čtyři spojení za minutu.
 */
export function databaseCheck(options: DatabaseCheckOptions): Check {
  const timeoutMs = options.timeoutMs ?? 2000;
  return async () => {
    const client = new Client({
      connectionString: options.connectionString,
      connectionTimeoutMillis: timeoutMs,
      statement_timeout: timeoutMs,
      application_name: 'mlain-healthcheck',
    });
    try {
      await client.connect();
      await client.query('SELECT 1');
      return { name: 'database', status: 'ok' };
    } catch (error) {
      return { name: 'database', status: 'fail', detail: (error as Error).message };
    } finally {
      await client.end().catch(() => {});
    }
  };
}

export interface SchemaCheckOptions {
  /** Vrátí system_settings.schema_version. */
  readonly query: () => Promise<number>;
  /** Nejvyšší číslo migrace zabudované v téhle image. 0 = build bez migrací. */
  readonly expectedVersion: number;
}

export function schemaCheck(options: SchemaCheckOptions): Check {
  return async () => {
    if (options.expectedVersion === 0) {
      return { name: 'schema', status: 'skip', detail: 'build bez migrací' };
    }
    try {
      const actual = await options.query();
      if (actual === options.expectedVersion) return { name: 'schema', status: 'ok' };
      if (actual > options.expectedVersion) {
        return {
          name: 'schema',
          status: 'fail',
          detail: `schema_version_ahead: databáze má ${actual}, image zná nejvýš ${options.expectedVersion}`,
        };
      }
      return {
        name: 'schema',
        status: 'fail',
        detail: `databáze má schema_version ${actual}, image očekává ${options.expectedVersion}`,
      };
    } catch (error) {
      // ROZHODNUTÍ D3: tabulku zakládá až P03. Do té doby je kontrola přeskočená,
      // ne selhaná, jinak by /api/health/ready nikdy nevrátil 200 a akceptační
      // kritérium 1 by nešlo splnit dřív než po P03.
      if ((error as { code?: string }).code === UNDEFINED_TABLE) {
        return { name: 'schema', status: 'skip', detail: 'system_settings zatím neexistuje' };
      }
      return { name: 'schema', status: 'fail', detail: (error as Error).message };
    }
  };
}

export function dataDirCheck(dataDir: string): Check {
  return async () => {
    const probe = path.join(dataDir, `.healthcheck-${process.pid}`);
    try {
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return { name: 'data_dir', status: 'ok' };
    } catch (error) {
      return {
        name: 'data_dir',
        status: 'fail',
        detail: `${dataDir}: ${(error as Error).message}`,
      };
    }
  };
}
