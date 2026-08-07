import { randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { IDENTITY_MERGE_QUEUE } from '../jobs/identity-merge';
import { asMigrator, seedWorkspace } from '../test/support/db';
import { bindIdentity } from './bind';

/**
 * Databázový test vazby identity, tedy PRODUCENTA fronty `identity.merge`.
 *
 * Zařazení se ověřuje proti skutečné instalaci pg-boss, ne jen proti špiónovi:
 * `pgboss.job.name` má cizí klíč na `pgboss.queue`, takže překlep ve jméně
 * fronty by se ve špiónovi neprojevil vůbec, kdežto tady zápis spadne.
 */

const NOW = new Date('2026-07-31T12:00:00.000Z');

type Fixture = { workspaceId: string; contactId: string; otherContactId: string };

async function seedContact(workspaceId: string): Promise<string> {
  const { rows } = await asMigrator().query<{ id: string }>(
    `INSERT INTO contacts (workspace_id, email) VALUES ($1, $2) RETURNING id`,
    [workspaceId, `k-${randomUUID().slice(0, 8)}@example.cz`],
  );
  return rows[0]!.id;
}

async function seedFixture(): Promise<Fixture> {
  const workspaceId = await seedWorkspace();
  return {
    workspaceId,
    contactId: await seedContact(workspaceId),
    otherContactId: await seedContact(workspaceId),
  };
}

/**
 * Odvolání souhlasu s měřením. Píše se do `contact_consent_state`, tedy do
 * odvozené tabulky, kterou plní `recordConsent` ve stejné transakci jako
 * append-only log; test se ptá přesně na to, co čte měření.
 */
async function withdrawMeasurement(workspaceId: string, contactId: string): Promise<void> {
  const { rows } = await asMigrator().query<{ id: string }>(
    `INSERT INTO consents (workspace_id, contact_id, purpose, scope_list_id, status,
                           legal_basis, source, evidence, recorded_by, occurred_at)
     VALUES ($1, $2, 'analytics', NULL, 'withdrawn', 'consent', 'admin', '{}'::jsonb,
             'system', now())
     RETURNING id`,
    [workspaceId, contactId],
  );
  await asMigrator().query(
    `INSERT INTO contact_consent_state (contact_id, workspace_id, purpose, status,
                                        legal_basis, since, last_consent_id)
     VALUES ($1, $2, 'analytics', 'withdrawn', 'consent', now(), $3)
     ON CONFLICT (contact_id, purpose) DO UPDATE
        SET status = 'withdrawn', last_consent_id = EXCLUDED.last_consent_id`,
    [contactId, workspaceId, rows[0]!.id],
  );
}

async function countBindings(workspaceId: string, anonymousId: string): Promise<number> {
  const { rows } = await asMigrator().query<{ count: string }>(
    `SELECT count(*) FROM identity_bindings WHERE workspace_id = $1 AND anonymous_id = $2`,
    [workspaceId, anonymousId],
  );
  return Number(rows[0]!.count);
}

async function selectIdentityContactId(
  workspaceId: string,
  anonymousId: string,
): Promise<string | null> {
  const { rows } = await asMigrator().query<{ contact_id: string | null }>(
    `SELECT contact_id FROM identities WHERE workspace_id = $1 AND anonymous_id = $2`,
    [workspaceId, anonymousId],
  );
  return rows[0]?.contact_id ?? null;
}

describe('bindIdentity', () => {
  let scheduleMerge: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const url = process.env['DATABASE_URL_MIGRATOR'];
    if (url === undefined) throw new Error('harness nenastavil DATABASE_URL_MIGRATOR');
    const boss = new PgBoss({
      connectionString: url,
      schema: 'pgboss',
      supervise: false,
      schedule: false,
    });
    await boss.start();
    await boss.createQueue(IDENTITY_MERGE_QUEUE);
    await boss.stop({ graceful: false });
    await asMigrator().query(`GRANT USAGE ON SCHEMA pgboss TO mlain_app`);
    await asMigrator().query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO mlain_app`,
    );
  }, 180_000);

  const bind = (
    f: Fixture,
    anonymousId: string,
    contactId: string,
    over: Partial<Parameters<typeof bindIdentity>[0]> = {},
  ) =>
    bindIdentity({
      workspaceId: f.workspaceId,
      anonymousId,
      contactId,
      source: 'email_click',
      evidence: {},
      now: NOW,
      scheduleMerge: scheduleMerge as unknown as Parameters<
        typeof bindIdentity
      >[0]['scheduleMerge'],
      ...over,
    });

  beforeAll(() => {
    scheduleMerge = vi.fn(async () => {});
  });

  it('první vazba zařadí skutečnou úlohu identity.merge se singleton klíčem vazby', async () => {
    const f = await seedFixture();
    const anonymousId = randomUUID();

    // Bez špióna: zařazení jde do pg-boss přesně tak, jak poběží v provozu.
    const outcome = await bindIdentity({
      workspaceId: f.workspaceId,
      anonymousId,
      contactId: f.contactId,
      source: 'email_click',
      evidence: { via: 'test' },
      now: NOW,
    });
    expect(outcome).toBe('created');

    const { rows } = await asMigrator().query<{
      name: string;
      data: { workspaceId: string; anonymousId: string; contactId: string; bindingId: string };
      singleton_key: string | null;
    }>(`SELECT name, data, singleton_key FROM pgboss.job WHERE data->>'anonymousId' = $1`, [
      anonymousId,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe(IDENTITY_MERGE_QUEUE);
    expect(rows[0]!.data.contactId).toBe(f.contactId);
    expect(rows[0]!.data.workspaceId).toBe(f.workspaceId);
    // singleton_key drží binding_id, takže dvě úlohy nad touž vazbou nepoběží souběžně.
    expect(rows[0]!.singleton_key).toBe(rows[0]!.data.bindingId);
    expect(await selectIdentityContactId(f.workspaceId, anonymousId)).toBe(f.contactId);
  });

  it('druhá vazba na týž kontakt je unchanged a NEnaplánuje druhé sloučení', async () => {
    const f = await seedFixture();
    const anonymousId = randomUUID();
    expect(await bind(f, anonymousId, f.contactId)).toBe('created');
    scheduleMerge.mockClear();

    expect(await bind(f, anonymousId, f.contactId)).toBe('unchanged');
    expect(scheduleMerge).not.toHaveBeenCalled();
    expect(await countBindings(f.workspaceId, anonymousId)).toBe(1);
  });

  it('návrat po dvaceti minutách s novým tokenem nevytvoří duplicitní sloučení', async () => {
    const f = await seedFixture();
    const anonymousId = randomUUID();
    await bind(f, anonymousId, f.contactId, { now: new Date('2026-07-31T12:00:00.000Z') });
    scheduleMerge.mockClear();

    const later = await bind(f, anonymousId, f.contactId, {
      now: new Date('2026-07-31T12:20:00.000Z'),
    });
    expect(later).toBe('unchanged');
    expect(scheduleMerge).not.toHaveBeenCalled();
    expect(await countBindings(f.workspaceId, anonymousId)).toBe(1);
  });

  it('vazba na jiný kontakt je rebound a historii NEslučuje', async () => {
    const f = await seedFixture();
    const anonymousId = randomUUID();
    await bind(f, anonymousId, f.contactId);
    scheduleMerge.mockClear();

    expect(await bind(f, anonymousId, f.otherContactId)).toBe('rebound');
    expect(scheduleMerge).not.toHaveBeenCalled();
    expect(await selectIdentityContactId(f.workspaceId, anonymousId)).toBe(f.otherContactId);
  });

  it('sedmá vazba za 24 hodin je sdílené zařízení a nic nemění', async () => {
    const f = await seedFixture();
    const anonymousId = randomUUID();
    for (let i = 0; i < 6; i += 1) {
      await bind(f, anonymousId, i % 2 === 0 ? f.contactId : f.otherContactId);
    }
    scheduleMerge.mockClear();

    expect(await bind(f, anonymousId, f.contactId)).toBe('shared');
    expect(scheduleMerge).not.toHaveBeenCalled();
    expect(await countBindings(f.workspaceId, anonymousId)).toBe(6);
  });

  it('kontakt s processing_restricted vazbu nezaloží a nespustí sloučení', async () => {
    const f = await seedFixture();
    const anonymousId = randomUUID();
    await asMigrator().query(`UPDATE contacts SET processing_restricted = true WHERE id = $1`, [
      f.contactId,
    ]);

    expect(await bind(f, anonymousId, f.contactId)).toBe('restricted');
    expect(scheduleMerge).not.toHaveBeenCalled();
    expect(await selectIdentityContactId(f.workspaceId, anonymousId)).toBeNull();
    expect(await countBindings(f.workspaceId, anonymousId)).toBe(0);
  });

  /**
   * Odvolaný souhlas s měřením zastaví vazbu ze stejného místa jako článek 18,
   * ale s vlastním výsledkem: obojí odmítne, důvod je jiný a v metrice se to
   * musí dát odlišit.
   */
  it('kontakt s odvolaným souhlasem s měřením vazbu nezaloží', async () => {
    const f = await seedFixture();
    const anonymousId = randomUUID();
    await withdrawMeasurement(f.workspaceId, f.contactId);

    expect(await bind(f, anonymousId, f.contactId)).toBe('measurement_withdrawn');
    expect(scheduleMerge).not.toHaveBeenCalled();
    expect(await selectIdentityContactId(f.workspaceId, anonymousId)).toBeNull();
    expect(await countBindings(f.workspaceId, anonymousId)).toBe(0);
  });

  /**
   * Chybějící záznam NENÍ odmítnutí. Kdyby byl, přestala by po nasazení fungovat
   * vazba všem kontaktům v každé instalaci naráz: účel `analytics` dnes nemá
   * v `contact_consent_state` ani jeden řádek.
   */
  it('kontakt bez záznamu o měření se váže dál', async () => {
    const f = await seedFixture();
    expect(await bind(f, randomUUID(), f.contactId)).toBe('created');
  });

  it('znovu udělený souhlas vazbu zase povolí', async () => {
    const f = await seedFixture();
    await withdrawMeasurement(f.workspaceId, f.contactId);
    expect(await bind(f, randomUUID(), f.contactId)).toBe('measurement_withdrawn');

    await asMigrator().query(
      `UPDATE contact_consent_state SET status = 'granted'
        WHERE contact_id = $1 AND purpose = 'analytics'`,
      [f.contactId],
    );
    expect(await bind(f, randomUUID(), f.contactId)).toBe('created');
  });

  it('zrušení omezení obnoví normální chování bez dalšího kroku', async () => {
    const f = await seedFixture();
    const anonymousId = randomUUID();
    await asMigrator().query(`UPDATE contacts SET processing_restricted = true WHERE id = $1`, [
      f.contactId,
    ]);
    await bind(f, anonymousId, f.contactId);
    await asMigrator().query(`UPDATE contacts SET processing_restricted = false WHERE id = $1`, [
      f.contactId,
    ]);

    expect(await bind(f, anonymousId, f.contactId)).toBe('created');
  });

  it('měkce smazaný kontakt se chová stejně jako omezený', async () => {
    const f = await seedFixture();
    await asMigrator().query(`UPDATE contacts SET deleted_at = now() WHERE id = $1`, [f.contactId]);
    expect(await bind(f, randomUUID(), f.contactId)).toBe('restricted');
  });

  it('neexistující kontakt vazbu nezaloží', async () => {
    const f = await seedFixture();
    const anonymousId = randomUUID();
    expect(await bind(f, anonymousId, randomUUID())).toBe('contact_not_found');
    expect(await countBindings(f.workspaceId, anonymousId)).toBe(0);
  });

  it('souběžné vazby téhož anonymního ID neztratí ani jeden zápis', async () => {
    const f = await seedFixture();
    const anonymousId = randomUUID();
    const results = await Promise.all([
      bind(f, anonymousId, f.contactId),
      bind(f, anonymousId, f.contactId),
      bind(f, anonymousId, f.contactId),
    ]);
    expect(results.filter((r) => r === 'created')).toHaveLength(1);
    expect(results.filter((r) => r === 'unchanged')).toHaveLength(2);
    expect(await countBindings(f.workspaceId, anonymousId)).toBe(1);
  });
});
