import { beforeAll, describe, expect, it } from 'vitest';
import type { WorkspaceContext } from '../../../identity/types';
import {
  retentionDispatchHandler,
  systemRetentionDispatchDeps,
} from '../../jobs/retention-dispatch';
import { runRetention } from '../../jobs/retention-run';
import { asMigrator, testContext } from '../support/db';
import { ensureQueue } from '../support/phase-c';

/**
 * Denní retence od cronu až po smazaný řádek, nad DVĚMA projekty.
 *
 * Tenhle soubor je důkaz, ne ilustrace. Do téhle chvíle cron plánoval
 * `retention.run` s prázdným nákladem, obsluha ho odmítla výjimkou a osobní
 * údaje po lhůtě zůstávaly v databázi. Test proto jde celou cestou:
 * sken projektů pod rolí `mlain_maintenance` → zařazení úlohy na projekt →
 * skutečný běh nad nákladem z fronty → počty PŘED a PO.
 *
 * Cíl je `import_errors`, protože nese syrové řádky ze souboru, tedy osobní
 * údaje, maže ho aplikační role a nepotřebuje k tomu úložiště souborů.
 */

const TARGETS = [
  'import_files',
  'import_errors',
  'form_submissions',
  'inbound_deliveries',
  'unconfirmed_subscriptions',
  'inactive_contacts',
  'exports',
] as const;

/** Zapne jediný cíl, aby test měřil právě ten jeden. */
async function onlyImportErrors(ctx: WorkspaceContext, days: number): Promise<void> {
  for (const target of TARGETS) {
    await asMigrator().query(
      `INSERT INTO retention_policies (workspace_id, target, retain_days, action, enabled)
       VALUES ($1, $2, $3, 'delete', $4)
       ON CONFLICT (workspace_id, target) DO UPDATE SET
         retain_days = excluded.retain_days, enabled = excluded.enabled`,
      [ctx.workspaceId, target, days, target === 'import_errors'],
    );
  }
}

/** Import se starými a čerstvými chybovými řádky. Staré musí retence smazat, čerstvé ne. */
async function seedImportErrors(
  ctx: WorkspaceContext,
  input: { old: number; fresh: number },
): Promise<void> {
  const { rows } = await asMigrator().query<{ id: string }>(
    `INSERT INTO imports
       (workspace_id, filename, byte_size, content_sha256, idempotency_key, status,
        file_expires_at)
     VALUES ($1, 'retence.csv', 128, decode('00', 'hex'), $2, 'completed',
             now() + interval '30 days') RETURNING id`,
    [ctx.workspaceId, `imp-${ctx.workspaceId}-${Date.now()}`],
  );
  const importId = rows[0]!.id;
  for (let i = 0; i < input.old; i += 1) {
    await asMigrator().query(
      `INSERT INTO import_errors
         (workspace_id, import_id, row_number, severity, error_code, raw_line, created_at)
       VALUES ($1, $2, $3, 'error', 'invalid_email', $4, now() - interval '400 days')`,
      [ctx.workspaceId, importId, i + 1, `stary${i}@example.cz;Jana;Novakova`],
    );
  }
  for (let i = 0; i < input.fresh; i += 1) {
    await asMigrator().query(
      `INSERT INTO import_errors
         (workspace_id, import_id, row_number, severity, error_code, raw_line, created_at)
       VALUES ($1, $2, $3, 'error', 'invalid_email', $4, now())`,
      [ctx.workspaceId, importId, 1000 + i, `cerstvy${i}@example.cz;Petr;Novak`],
    );
  }
}

async function countImportErrors(ctx: WorkspaceContext): Promise<number> {
  const { rows } = await asMigrator().query<{ n: string }>(
    `SELECT count(*)::text AS n FROM import_errors WHERE workspace_id = $1`,
    [ctx.workspaceId],
  );
  return Number(rows[0]!.n);
}

type QueuedRun = { workspaceId: string; singletonKey: string | null; startAfterSeconds: number };

/** Úlohy, které dispečer skutečně zařadil do fronty. Čte se přímo z pg-boss. */
async function queuedRuns(workspaceIds: readonly string[]): Promise<QueuedRun[]> {
  const { rows } = await asMigrator().query<{
    data: { workspaceId?: string };
    singleton_key: string | null;
    delay_seconds: string;
  }>(
    `SELECT data, singleton_key,
            EXTRACT(EPOCH FROM (start_after - created_on))::bigint::text AS delay_seconds
       FROM pgboss.job
      WHERE name = 'retention.run'
        AND data ->> 'workspaceId' = ANY($1::text[])
      ORDER BY data ->> 'workspaceId'`,
    [[...workspaceIds]],
  );
  return rows.map((row) => ({
    workspaceId: row.data.workspaceId ?? '',
    singletonKey: row.singleton_key,
    startAfterSeconds: Number(row.delay_seconds),
  }));
}

beforeAll(async () => {
  await ensureQueue('retention.run');
});

describe('denní retence přes dispečer, dva projekty', () => {
  it('DŮKAZ: cronový tik smaže po lhůtě data v OBOU projektech', async () => {
    const a = await testContext();
    const b = await testContext();
    await onlyImportErrors(a, 90);
    await onlyImportErrors(b, 90);
    await seedImportErrors(a, { old: 3, fresh: 2 });
    await seedImportErrors(b, { old: 5, fresh: 1 });

    const before = { a: await countImportErrors(a), b: await countImportErrors(b) };
    expect(before).toEqual({ a: 5, b: 6 });

    // 1. Cronový tik: sken pod rolí mlain_maintenance a zařazení po projektech.
    const result = await retentionDispatchHandler(systemRetentionDispatchDeps());
    expect(result.failed).toBe(0);
    expect(result.dispatched).toBe(result.workspaces);

    const queued = await queuedRuns([a.workspaceId, b.workspaceId]);
    expect(queued).toHaveLength(2);
    expect(queued.map((job) => job.workspaceId).sort()).toEqual(
      [a.workspaceId, b.workspaceId].sort(),
    );
    // singletonKey podle registru fronty, tedy workspace_id.
    for (const job of queued) expect(job.singletonKey).toBe(job.workspaceId);
    // Rozprostření v čase: dva projekty nemají tutéž sekundu startu.
    expect(queued[0]!.startAfterSeconds).not.toBe(queued[1]!.startAfterSeconds);

    // 2. Skutečný běh nad nákladem, který dispečer zařadil. Nic se nedoplňuje
    //    rukou: kdyby náklad neměl workspaceId, `runRetention` by spadl.
    for (const job of queued) {
      const status = await runRetention({ workspaceId: job.workspaceId });
      expect(status.status).toBe('completed');
    }

    const after = { a: await countImportErrors(a), b: await countImportErrors(b) };
    // Staré řádky pryč v obou projektech, čerstvé zůstaly.
    expect(after).toEqual({ a: 2, b: 1 });
  });

  it('běh se zapíše do retention_runs s nenulovým počtem, ne s nulou', async () => {
    // Nula by znamenala „job doběhl a nic nesmazal", tedy přesně to, jak vypadá
    // retence bez kontextu projektu. Ta se pozná JEN podle čísla.
    const ctx = await testContext();
    await onlyImportErrors(ctx, 90);
    await seedImportErrors(ctx, { old: 4, fresh: 0 });

    await retentionDispatchHandler(systemRetentionDispatchDeps());
    const [job] = await queuedRuns([ctx.workspaceId]);
    expect(job).toBeDefined();
    await runRetention({ workspaceId: job!.workspaceId });

    // `affected` je bigint, takže ho ovladač vrací jako řetězec. Číslo se proto
    // dopočítává tady; `toMatchObject({ affected: 4 })` by neprošlo nikdy.
    const { rows } = await asMigrator().query<{ status: string; affected: string }>(
      `SELECT status, affected::text AS affected FROM retention_runs
        WHERE workspace_id = $1 AND target = 'import_errors'
        ORDER BY started_at DESC LIMIT 1`,
      [ctx.workspaceId],
    );
    expect(rows[0]?.status).toBe('completed');
    expect(Number(rows[0]?.affected)).toBe(4);
  });

  it('REGRESE: bez připojení pod rolí mlain_maintenance tik SELŽE, nepřeskočí se', async () => {
    // Kdyby dispečer výčet projektů neuměl, retence by dál nemazala nic a nikde
    // by to nebylo vidět. Chybějící role je hlasitá chyba, ne prázdný seznam.
    const original = process.env['DATABASE_URL_MAINTENANCE'];
    delete process.env['DATABASE_URL_MAINTENANCE'];
    const { closePools } = await import('../../../tx');
    await closePools();
    try {
      await expect(retentionDispatchHandler(systemRetentionDispatchDeps())).rejects.toThrow(
        /DATABASE_URL_MAINTENANCE/,
      );
    } finally {
      if (original !== undefined) process.env['DATABASE_URL_MAINTENANCE'] = original;
      await closePools();
    }
  });
});
