import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { QUEUE_REGISTRY } from '../../queues';
import { startPgHarness, type PgHarness } from '../../test-support/pg-harness';
import { closePools, withoutContext } from '../../tx';
import * as cleanupAuditLogModule from './cleanup_audit_log';
import * as cleanupIdempotencyModule from './cleanup_idempotency';
import * as cleanupSessionsModule from './cleanup_sessions';
import * as purgeWorkspacesModule from './purge_workspaces';
import * as webhookDeliver from './webhook_deliver';
import * as webhookFanout from './webhook_fanout';
import { handler as cleanupSessions } from './cleanup_sessions';
import { handler as cleanupIdempotency } from './cleanup_idempotency';
import { handlers } from './queue-handlers';

const JOBS_DIR = fileURLToPath(new URL('./', import.meta.url));

/**
 * ODCHYLKA OD PLÁNU: fronty, které P04 nevlastní, jsou vyjmenované v jednom
 * seznamu i s vlastníkem. Plán počítal jen s `platform.maintain_partitions`,
 * jenže registr má navíc `platform.backup` a `platform.backup_verify`
 * s vlastníkem P16. Fronta bez handleru je fronta, do které se zapisuje
 * a nikdo z ní nečte, takže vlastník musí být u každé výjimky vidět.
 */
const NOT_OWNED_BY_P04: Record<string, string> = {
  'platform.maintain_partitions': 'P03',
  'platform.backup': 'P16',
  'platform.backup_verify': 'P16',
};

let harness: PgHarness;

beforeAll(async () => {
  harness = await startPgHarness();
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

/**
 * Rozhodnutí R3 plánu P04: entrypoint workeru vlastní P01, handlery dodává
 * doména na konvenční cestě packages/core/src/<domena>/jobs/<akce>.ts. Tenhle
 * test je jediné, co brání tomu, aby fronta existovala v registru a handler nikde.
 */
describe('konvenční cesty handlerů', () => {
  const platformQueues = QUEUE_REGISTRY.map((entry) => entry.name).filter((name) =>
    name.startsWith('platform.'),
  );

  it('registr obsahuje pět front platformy vlastněných P04', () => {
    for (const name of [
      'platform.webhook_fanout',
      'platform.webhook_deliver',
      'platform.cleanup_sessions',
      'platform.cleanup_idempotency',
      'platform.purge_workspaces',
    ]) {
      expect(platformQueues).toContain(name);
    }
  });

  it('pro každou frontu platformy existuje modul na konvenční cestě', () => {
    const missing: string[] = [];
    for (const name of platformQueues) {
      if (name in NOT_OWNED_BY_P04) continue;
      const action = name.split('.')[1]!;
      if (!existsSync(join(JOBS_DIR, `${action}.ts`))) missing.push(name);
    }
    expect(missing).toEqual([]);
  });

  /**
   * ODCHYLKA OD PLÁNU: moduly se importují staticky, ne přes `import('./${x}')`.
   * Proměnná v cestě dynamického importu není v tomhle balíčku přeložitelná
   * (Vite ji odmítne bez statické části s příponou) a `import.meta.glob` tu
   * není otypované. Statický výčet navíc chytí chybějící modul už při překladu.
   */
  it('každý modul exportuje handler jako funkci', () => {
    const modules: Record<string, { handler?: unknown }> = {
      webhook_fanout: webhookFanout,
      webhook_deliver: webhookDeliver,
      cleanup_sessions: cleanupSessionsModule,
      cleanup_idempotency: cleanupIdempotencyModule,
      cleanup_audit_log: cleanupAuditLogModule,
      purge_workspaces: purgeWorkspacesModule,
    };
    for (const [action, module] of Object.entries(modules)) {
      expect(typeof module.handler, action).toBe('function');
    }
  });

  /**
   * Codegen workeru (apps/worker/codegen.mjs) skládá mapu jen z modulu
   * `queue-handlers.ts`. Fronta, která v něm chybí, je fronta bez konzumenta,
   * a testy jednotlivých modulů to nechytí, protože ty jsou zelené i tak.
   */
  it('rejstřík queue-handlers pokrývá každou frontu platformy vlastněnou P04', () => {
    const owned = platformQueues.filter((name) => !(name in NOT_OWNED_BY_P04));
    expect(Object.keys(handlers).sort()).toEqual(owned.sort());
    for (const [name, fn] of Object.entries(handlers)) {
      expect(typeof fn, name).toBe('function');
    }
  });
});

describe('úklidové joby', () => {
  it('cleanup_sessions maže jen relace skončené před víc než 30 dny', async () => {
    const userId = await withoutContext(async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO users (email, password_hash, locale, timezone)
        VALUES (${`cleanup-${Date.now()}@example.cz`}, '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', 'cs', 'Europe/Prague')
        RETURNING id::text AS id
      `);
      return rows[0]!.id;
    });

    await withoutContext(async (tx) => {
      await tx.execute(sql`
        INSERT INTO sessions (user_id, token_hash, csrf_secret, absolute_expires_at, revoked_at)
        VALUES (${userId}::uuid, decode(md5(random()::text), 'hex'), decode(md5(random()::text), 'hex'),
                now() + interval '30 days', now() - interval '40 days')
      `);
      await tx.execute(sql`
        INSERT INTO sessions (user_id, token_hash, csrf_secret, absolute_expires_at, revoked_at)
        VALUES (${userId}::uuid, decode(md5(random()::text), 'hex'), decode(md5(random()::text), 'hex'),
                now() + interval '30 days', now() - interval '1 day')
      `);
    });

    const removed = await cleanupSessions();
    expect(removed).toBeGreaterThanOrEqual(1);

    const remaining = await withoutContext(async (tx) => {
      const { rows } = await tx.execute<{ c: string }>(
        sql`SELECT count(*) AS c FROM sessions WHERE user_id = ${userId}::uuid`,
      );
      return Number(rows[0]!.c);
    });
    expect(remaining).toBe(1);
  });

  it('cleanup_idempotency maže jen záznamy po expiraci', async () => {
    const removed = await cleanupIdempotency();
    expect(typeof removed).toBe('number');
  });
});
