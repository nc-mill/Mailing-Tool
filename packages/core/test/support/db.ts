import { Client, Pool } from 'pg';
import { withWorkspace, type Tx } from '@mlain/db';
import { unsafeWorkspaceContext } from '@mlain/db/unsafe-context';
import { HARNESS_ROLES, startPgHarness, type PgHarness } from '../../src/test-support/pg-harness';

export type RoleName = (typeof HARNESS_ROLES)[number];

/**
 * Testovací opora domén P16 nad harnessem P03.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. Plán importoval
 * `startHarness` z podcesty `@mlain/db/test-support` (rozhraní I→P03.5).
 * Ta podcesta v `packages/db/package.json` **není** a `packages/db` vlastní P03,
 * takže do jeho `exports` tenhle plán sáhnout nesmí. Opora proto stojí na
 * `startPgHarness()` z `packages/core/src/test-support/pg-harness.ts`, což je
 * týž kontejner, tytéž role a tytéž migrace; jen se pooly rolí skládají tady.
 *
 * Fixtures se zakládají pod `mlain_migrator`, protože na něj RLS nedopadá,
 * ale **ověřuje se pod tou rolí, které se test týká**. Databázový test běžící
 * celý pod migrátorem by chybějící kontext projektu zamaskoval.
 */
export type TestPostgres = {
  /** URL migrátora. Provozní příkazy ho dostávají jako DATABASE_URL_MIGRATOR. */
  ownerUrl: string;
  /** URL libovolné z šesti rolí, pro testy, které ověřují oprávnění. */
  urlForRole(role: RoleName): string;
  /** Pool role, pro dotazy pod tou rolí. */
  as(role: RoleName): Pool;
  /** Dotaz pod migrátorem. Vrací POLE řádků, ne obálku. */
  sql<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  seedMinimalInstallation(input: {
    contacts: number;
    ownerEmail?: string;
  }): Promise<{ workspaceId: string; userId: string }>;
  seedSentCampaign(input: { workspaceId: string }): Promise<{ campaignId: string }>;
  truncateWorkspaceData(workspaceId: string): Promise<void>;
  /**
   * Spustí funkci v transakci **pod aplikační rolí a s nastaveným kontextem
   * projektu**, tedy přesně tak, jak to za běhu dělá `withWorkspace`
   * z `@mlain/core/tx`.
   *
   * Testy domén, které pracují uvnitř jednoho projektu (onboarding, ukázková
   * data), musí jet tudy. Kdyby jely pod migrátorem, prošly by i tehdy, když
   * produkční kód zapomene kontext nastavit, protože na vlastníka schématu
   * se RLS neuplatní.
   */
  inWorkspace<T>(workspaceId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  stop(): Promise<void>;
};

/** Rozebere URL harnessu na části, ze kterých jde složit URL kterékoli role. */
function partsOf(url: string): { host: string; port: number; database: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port),
    database: parsed.pathname.replace(/^\//, ''),
  };
}

export async function startTestPostgres(): Promise<TestPostgres> {
  const h: PgHarness = await startPgHarness();
  const { host, port, database } = partsOf(h.migratorUrl);

  const urlFor = (role: RoleName) => `postgres://${role}:${role}@${host}:${port}/${database}`;

  const pools = new Map<RoleName, Pool>();
  for (const role of HARNESS_ROLES) {
    pools.set(
      role,
      new Pool({
        host,
        port,
        database,
        user: role,
        password: role,
        options: '-c timezone=UTC',
        max: 4,
      }),
    );
  }

  const migrator = pools.get('mlain_migrator')!;

  const query = async <T>(text: string, params?: unknown[]): Promise<T[]> => {
    const { rows } = await migrator.query(text, params);
    return rows as T[];
  };

  return {
    ownerUrl: h.migratorUrl,
    urlForRole: (role) => urlFor(role),
    as: (role) => pools.get(role)!,
    sql: query,

    async seedMinimalInstallation({ contacts, ownerEmail = 'owner@example.test' }) {
      const [user] = await query<{ id: string }>(
        `INSERT INTO users (email, password_hash, locale, timezone)
         VALUES ($1, 'argon2id$dummy', 'cs', 'Europe/Prague') RETURNING id`,
        [ownerEmail],
      );
      const [ws] = await query<{ id: string }>(
        `INSERT INTO workspaces (name, slug, locale, timezone, created_by)
         VALUES ('Testovací projekt', $2, 'cs', 'Europe/Prague', $1)
         RETURNING id`,
        [user!.id, `test-projekt-${Math.random().toString(36).slice(2, 10)}`],
      );
      await query(
        `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [ws!.id, user!.id],
      );
      for (let i = 0; i < contacts; i += 1) {
        await query(
          `INSERT INTO contacts (workspace_id, email, status, source, locale, timezone)
           VALUES ($1, $2, 'active', 'manual', 'cs', 'Europe/Prague')`,
          [ws!.id, `kontakt-${i}@example.test`],
        );
      }
      return { workspaceId: ws!.id, userId: user!.id };
    },

    async seedSentCampaign({ workspaceId }) {
      // design i design_hash jsou NOT NULL, viz schéma P03.
      const [tpl] = await query<{ id: string }>(
        `INSERT INTO templates (workspace_id, name, design, design_hash)
         VALUES ($1, $2, '{"blocks":[]}'::jsonb, sha256('x'))
         RETURNING id`,
        [workspaceId, `Testovací šablona ${Math.random().toString(36).slice(2, 8)}`],
      );
      const [campaign] = await query<{ id: string }>(
        `INSERT INTO campaigns (workspace_id, name, subject, template_id, status, finished_at)
         VALUES ($1, $2, 'Předmět', $3, 'sent', now()) RETURNING id`,
        [workspaceId, `Testovací kampaň ${Math.random().toString(36).slice(2, 8)}`, tpl!.id],
      );
      await query(
        `INSERT INTO campaign_stats (workspace_id, campaign_id, sent, delivered)
         VALUES ($1, $2, 10, 9)`,
        [workspaceId, campaign!.id],
      );
      return { campaignId: campaign!.id };
    },

    async truncateWorkspaceData(workspaceId) {
      // Pořadí je dané cizími klíči. Běží pod migrátorem, takže RLS nefiltruje.
      for (const table of [
        'message_events',
        'messages',
        'campaign_stats',
        'campaigns',
        'templates',
        'contact_tags',
        'list_subscriptions',
        'segments',
        'contacts',
        'lists',
        'tags',
        'audit_log',
      ]) {
        await query(`DELETE FROM ${table} WHERE workspace_id = $1`, [workspaceId]);
      }
    },

    inWorkspace(workspaceId, fn) {
      // Kontext se skládá stejně jako v produkci. `unsafeWorkspaceContext`
      // je jediná továrna branded typu a P03 ji pro testy a údržbové joby
      // výslovně povoluje.
      const ctx = unsafeWorkspaceContext(workspaceId, {
        type: 'system',
        job: 'test',
      });
      return withWorkspace(pools.get('mlain_app')!, ctx, fn);
    },

    async stop() {
      for (const pool of pools.values()) await pool.end();
      await h.stop();
    },
  };
}

/** Spojení s daným `application_name`, pro testy, které čtou pg_stat_activity. */
export async function openConnectionAs(
  pg: TestPostgres,
  applicationName: string,
): Promise<{ close(): Promise<void> }> {
  const client = new Client({
    connectionString: pg.urlForRole('mlain_app'),
    application_name: applicationName,
  });
  await client.connect();
  return { close: () => client.end() };
}
