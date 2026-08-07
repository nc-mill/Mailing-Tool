import { Client } from 'pg';
import {
  aiKeyLeakCheck,
  buildReadiness,
  dataDirCheck,
  databaseCheck,
  schemaCheck,
} from '@mlain/core/health';
import { isolationCheck } from '@mlain/core/tx/isolation-guard';
import { EXPECTED_SCHEMA_VERSION, getConfig } from '@/lib/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readSchemaVersion(connectionString: string, timeoutMs: number): Promise<number> {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: timeoutMs,
    statement_timeout: timeoutMs,
    application_name: 'mlain-healthcheck',
  });
  try {
    await client.connect();
    const result = await client.query<{ schema_version: number }>(
      'SELECT schema_version FROM system_settings LIMIT 1',
    );
    return result.rows[0]?.schema_version ?? 0;
  } finally {
    await client.end().catch(() => {});
  }
}

export async function GET(): Promise<Response> {
  const config = getConfig();
  const timeoutMs = 2000;

  const result = await buildReadiness([
    databaseCheck({ connectionString: config.DATABASE_URL, timeoutMs }),
    schemaCheck({
      query: () => readSchemaVersion(config.DATABASE_URL, timeoutMs),
      expectedVersion: EXPECTED_SCHEMA_VERSION,
    }),
    dataDirCheck(config.DATA_DIR),
    aiKeyLeakCheck(),
    // Izolace projektů. `warn` readiness nesráží, ale zůstane v odpovědi vidět,
    // takže se chybějící izolace dá najít i bez čtení logu ze startu.
    isolationCheck(),
  ]);

  return Response.json(
    { status: result.status, checks: result.checks },
    { status: result.httpStatus, headers: { 'Cache-Control': 'no-store' } },
  );
}
