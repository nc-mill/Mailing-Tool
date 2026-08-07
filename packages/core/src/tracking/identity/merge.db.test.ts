import { randomUUID } from 'node:crypto';
import { ensurePartitionsForRange } from '@mlain/db/partitions';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSystemContext } from '../../identity/context';
import { readContactTimeline } from '../../reports/timeline/query';
import { withWorkspace } from '../../tx';
import { asMigrator, seedWorkspace } from '../test/support/db';
import { runIdentityMerge, revertIdentityMerge } from './merge';

/**
 * Databázový test slučování identit.
 *
 * ODCHYLKY OD PLÁNU (Task 30), všechny vynucené repozitářem:
 * - Plán stavěl na `withTestDatabase`, `seedContact` a `seedWebEvents`
 *   z `@mlain/db/testing`. Takový klíč `@mlain/db` v `exports` nemá; používá se
 *   proto harness domény trackingu (`../test/support/db`), pod kterým běží
 *   ostatní databázové testy téhle domény.
 * - Strop se zkouší na 120 událostech proti stropu 50, ne na 15 000 proti
 *   10 000. Testuje se tatáž větev kódu, jen za sekundy místo minut.
 */

const NOW = new Date('2026-07-31T12:00:00.000Z');
const IN_WINDOW = new Date('2026-07-30T12:00:00.000Z');
const BEFORE_WINDOW = new Date('2026-05-01T12:00:00.000Z');

const translate = (key: string): string => key;

type Fixture = { workspaceId: string; contactId: string; anonymousId: string; bindingId: string };

async function ensureWebEventPartitions(at: Date): Promise<void> {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  await ensurePartitionsForRange(asMigrator(), 'web_events', 'received_at', start, end);
}

/** Projekt, kontakt a zapsaná vazba. Vazbu zakládá seed, testuje se slučování. */
async function seedFixture(): Promise<Fixture> {
  const workspaceId = await seedWorkspace();
  const anonymousId = randomUUID();
  const { rows: contact } = await asMigrator().query<{ id: string }>(
    `INSERT INTO contacts (workspace_id, email, first_name, last_name)
     VALUES ($1, $2, 'Jana', 'Nováková') RETURNING id`,
    [workspaceId, `k-${randomUUID().slice(0, 8)}@example.cz`],
  );
  const contactId = contact[0]!.id;
  await asMigrator().query(
    `INSERT INTO identities (workspace_id, anonymous_id, contact_id, bound_at, bind_count)
     VALUES ($1, $2, $3, $4, 1)`,
    [workspaceId, anonymousId, contactId, NOW],
  );
  const { rows: binding } = await asMigrator().query<{ id: string }>(
    `INSERT INTO identity_bindings (workspace_id, anonymous_id, contact_id, valid_from, source)
     VALUES ($1, $2, $3, $4, 'email_click') RETURNING id`,
    [workspaceId, anonymousId, contactId, NOW],
  );
  return { workspaceId, contactId, anonymousId, bindingId: binding[0]!.id };
}

type SeedEventsInput = {
  workspaceId: string;
  anonymousId?: string;
  contactId?: string;
  count: number;
  occurredAt: Date;
  erased?: boolean;
};

async function seedWebEvents(input: SeedEventsInput): Promise<void> {
  await ensureWebEventPartitions(input.occurredAt);
  await asMigrator().query(
    `INSERT INTO web_events (id, received_at, occurred_at, workspace_id, name,
                             anonymous_id, contact_id, source, erased_at)
     SELECT gen_random_uuid(),
            ($1::timestamptz + (g || ' seconds')::interval),
            ($1::timestamptz + (g || ' seconds')::interval),
            $2, 'page_view', $3, $4, 'web', $5
       FROM generate_series(1, $6) AS g`,
    [
      input.occurredAt.toISOString(),
      input.workspaceId,
      input.anonymousId ?? null,
      input.contactId ?? null,
      input.erased === true ? input.occurredAt.toISOString() : null,
      input.count,
    ],
  );
}

async function countEventsForContact(workspaceId: string, contactId: string): Promise<number> {
  const { rows } = await asMigrator().query<{ count: string }>(
    `SELECT count(*) FROM web_events WHERE workspace_id = $1 AND contact_id = $2`,
    [workspaceId, contactId],
  );
  return Number(rows[0]!.count);
}

async function countMergeRows(workspaceId: string, bindingId: string): Promise<number> {
  const { rows } = await asMigrator().query<{ count: string }>(
    `SELECT count(*) FROM identity_merges WHERE workspace_id = $1 AND binding_id = $2`,
    [workspaceId, bindingId],
  );
  return Number(rows[0]!.count);
}

const run = (f: Fixture, over: Partial<Parameters<typeof runIdentityMerge>[0]> = {}) =>
  runIdentityMerge({
    workspaceId: f.workspaceId,
    anonymousId: f.anonymousId,
    contactId: f.contactId,
    bindingId: f.bindingId,
    windowDays: 30,
    maxEvents: 10_000,
    batchSize: 1000,
    now: NOW,
    ...over,
  });

describe('runIdentityMerge', () => {
  beforeAll(async () => {
    await ensureWebEventPartitions(NOW);
    await ensureWebEventPartitions(BEFORE_WINDOW);
  }, 120_000);

  it('doplní contact_id anonymním událostem v okně a časová osa je začne počítat kontaktu', async () => {
    const f = await seedFixture();
    await seedWebEvents({
      workspaceId: f.workspaceId,
      anonymousId: f.anonymousId,
      count: 5,
      occurredAt: IN_WINDOW,
    });

    // Časová osa je čtecí cesta produktu. Před sloučením o událostech neví,
    // protože je nemá pod kontaktem ani v `web_event_months`.
    const before = await withWorkspace(createSystemContext(f.workspaceId, 'test'), (tx) =>
      readContactTimeline(tx, createSystemContext(f.workspaceId, 'test'), {
        contactId: f.contactId,
        limit: 50,
        translate,
        now: NOW,
      }),
    );
    expect(before.items).toHaveLength(0);

    const result = await run(f);
    expect(result.status).toBe('completed');
    expect(result.eventsTotal).toBe(5);
    expect(await countEventsForContact(f.workspaceId, f.contactId)).toBe(5);

    const after = await withWorkspace(createSystemContext(f.workspaceId, 'test'), (tx) =>
      readContactTimeline(tx, createSystemContext(f.workspaceId, 'test'), {
        contactId: f.contactId,
        limit: 50,
        translate,
        now: NOW,
      }),
    );
    expect(after.items).toHaveLength(5);
  });

  it('doplní web_event_months a posune contacts.last_activity_at', async () => {
    const f = await seedFixture();
    await seedWebEvents({
      workspaceId: f.workspaceId,
      anonymousId: f.anonymousId,
      count: 2,
      occurredAt: IN_WINDOW,
    });
    await run(f);

    const { rows: months } = await asMigrator().query<{ count: string }>(
      `SELECT count(*) FROM web_event_months
        WHERE workspace_id = $1 AND subject_kind = 'contact' AND subject_id = $2`,
      [f.workspaceId, f.contactId],
    );
    expect(Number(months[0]!.count)).toBeGreaterThan(0);

    const { rows: contact } = await asMigrator().query<{ last: Date | null }>(
      `SELECT last_activity_at AS last FROM contacts WHERE id = $1`,
      [f.contactId],
    );
    expect(contact[0]!.last).not.toBeNull();
  });

  it('události starší než okno se nepřipojí', async () => {
    const f = await seedFixture();
    await seedWebEvents({
      workspaceId: f.workspaceId,
      anonymousId: f.anonymousId,
      count: 3,
      occurredAt: BEFORE_WINDOW,
    });
    const result = await run(f);
    expect(result.eventsTotal).toBe(0);
    expect(await countEventsForContact(f.workspaceId, f.contactId)).toBe(0);
  });

  it('události s erased_at se přeskočí, vymazaná historie se nikdy nekřísí', async () => {
    const f = await seedFixture();
    await seedWebEvents({
      workspaceId: f.workspaceId,
      anonymousId: f.anonymousId,
      count: 4,
      occurredAt: IN_WINDOW,
      erased: true,
    });
    const result = await run(f);
    expect(result.eventsTotal).toBe(0);
  });

  it('při překročení stropu skončí ve stavu truncated a doplní přesně strop', async () => {
    const f = await seedFixture();
    await seedWebEvents({
      workspaceId: f.workspaceId,
      anonymousId: f.anonymousId,
      count: 120,
      occurredAt: IN_WINDOW,
    });
    const result = await run(f, { maxEvents: 50, batchSize: 20 });
    expect(result.status).toBe('truncated');
    expect(result.eventsTotal).toBe(50);
    expect(await countEventsForContact(f.workspaceId, f.contactId)).toBe(50);
  });

  it('opakované spuštění nezdvojí události ani řádky v identity_merges', async () => {
    const f = await seedFixture();
    await seedWebEvents({
      workspaceId: f.workspaceId,
      anonymousId: f.anonymousId,
      count: 5,
      occurredAt: IN_WINDOW,
    });
    const first = await run(f);
    const second = await run(f);

    expect(second.mergeId).toBe(first.mergeId);
    expect(second.status).toBe('completed');
    expect(second.eventsTotal).toBe(5);
    expect(await countEventsForContact(f.workspaceId, f.contactId)).toBe(5);
    expect(await countMergeRows(f.workspaceId, f.bindingId)).toBe(1);
  });

  it('přerušený běh druhé spuštění dokončí a events_total nese součet obou', async () => {
    const f = await seedFixture();
    await seedWebEvents({
      workspaceId: f.workspaceId,
      anonymousId: f.anonymousId,
      count: 10,
      occurredAt: IN_WINDOW,
    });
    // První běh spadl po pěti událostech: řádek zůstal ve stavu running.
    const partial = await run(f, { maxEvents: 5, batchSize: 5 });
    expect(partial.status).toBe('truncated');
    await asMigrator().query(`UPDATE identity_merges SET status = 'running' WHERE id = $1`, [
      partial.mergeId,
    ]);

    const finished = await run(f);
    expect(finished.mergeId).toBe(partial.mergeId);
    expect(finished.status).toBe('completed');
    expect(finished.eventsTotal).toBe(10);
    expect(await countMergeRows(f.workspaceId, f.bindingId)).toBe(1);
  });

  it('kontakt s processing_restricted job přeskočí bez práce', async () => {
    const f = await seedFixture();
    await asMigrator().query(`UPDATE contacts SET processing_restricted = true WHERE id = $1`, [
      f.contactId,
    ]);
    await seedWebEvents({
      workspaceId: f.workspaceId,
      anonymousId: f.anonymousId,
      count: 3,
      occurredAt: IN_WINDOW,
    });

    const result = await run(f);
    expect(result.status).toBe('skipped_restricted');
    expect(result.mergeId).toBeNull();
    expect(await countEventsForContact(f.workspaceId, f.contactId)).toBe(0);
    expect(await countMergeRows(f.workspaceId, f.bindingId)).toBe(0);
  });

  it('měkce smazaný kontakt se chová stejně jako omezený', async () => {
    const f = await seedFixture();
    await asMigrator().query(`UPDATE contacts SET deleted_at = now() WHERE id = $1`, [f.contactId]);
    expect((await run(f)).status).toBe('skipped_restricted');
  });

  /**
   * Souhlas s měřením se kontroluje ZNOVU, mezi vazbou a během jobu mohl člověk
   * měření odmítnout. Doplnit mu `contact_id` do už uložených anonymních
   * událostí by bylo zpětné pojmenování stopy, kterou si nepřál mít
   * pojmenovanou, a stalo by se to minuty poté, co odmítnutí zaznělo.
   */
  it('odvolaný souhlas s měřením historii nedoplní', async () => {
    const f = await seedFixture();
    const { rows } = await asMigrator().query<{ id: string }>(
      `INSERT INTO consents (workspace_id, contact_id, purpose, scope_list_id, status,
                             legal_basis, source, evidence, recorded_by, occurred_at)
       VALUES ($1, $2, 'analytics', NULL, 'withdrawn', 'consent', 'admin', '{}'::jsonb,
               'system', now())
       RETURNING id`,
      [f.workspaceId, f.contactId],
    );
    await asMigrator().query(
      `INSERT INTO contact_consent_state (contact_id, workspace_id, purpose, status,
                                          legal_basis, since, last_consent_id)
       VALUES ($1, $2, 'analytics', 'withdrawn', 'consent', now(), $3)`,
      [f.contactId, f.workspaceId, rows[0]!.id],
    );
    await seedWebEvents({
      workspaceId: f.workspaceId,
      anonymousId: f.anonymousId,
      count: 3,
      occurredAt: IN_WINDOW,
    });

    const result = await run(f);
    expect(result.status).toBe('skipped_measurement_withdrawn');
    expect(result.mergeId).toBeNull();
    expect(await countEventsForContact(f.workspaceId, f.contactId)).toBe(0);
    expect(await countMergeRows(f.workspaceId, f.bindingId)).toBe(0);
  });

  it('anonymní stopa navázaná na JINÝ kontakt zůstane anonymní', async () => {
    const f = await seedFixture();
    const { rows: other } = await asMigrator().query<{ id: string }>(
      `INSERT INTO contacts (workspace_id, email) VALUES ($1, $2) RETURNING id`,
      [f.workspaceId, `jiny-${randomUUID().slice(0, 8)}@example.cz`],
    );
    const otherContactId = other[0]!.id;
    // Prohlížeč mezitím patří někomu jinému, například po přeposlaném e-mailu.
    await asMigrator().query(
      `UPDATE identities SET contact_id = $3 WHERE workspace_id = $1 AND anonymous_id = $2`,
      [f.workspaceId, f.anonymousId, otherContactId],
    );
    await seedWebEvents({
      workspaceId: f.workspaceId,
      anonymousId: f.anonymousId,
      count: 4,
      occurredAt: IN_WINDOW,
    });

    const result = await run(f);
    expect(result.status).toBe('skipped_conflict');
    expect(await countEventsForContact(f.workspaceId, f.contactId)).toBe(0);
    expect(await countEventsForContact(f.workspaceId, otherContactId)).toBe(0);
    expect(await countMergeRows(f.workspaceId, f.bindingId)).toBe(0);
  });

  it('nepřepíše událost, kterou už vlastní jiný kontakt', async () => {
    const f = await seedFixture();
    const { rows: other } = await asMigrator().query<{ id: string }>(
      `INSERT INTO contacts (workspace_id, email) VALUES ($1, $2) RETURNING id`,
      [f.workspaceId, `cizi-${randomUUID().slice(0, 8)}@example.cz`],
    );
    const otherContactId = other[0]!.id;
    await seedWebEvents({
      workspaceId: f.workspaceId,
      anonymousId: f.anonymousId,
      contactId: otherContactId,
      count: 3,
      occurredAt: IN_WINDOW,
    });

    const result = await run(f);
    expect(result.eventsTotal).toBe(0);
    expect(await countEventsForContact(f.workspaceId, otherContactId)).toBe(3);
  });
});

describe('revertIdentityMerge', () => {
  it('vrátí contact_id na NULL u přesně těch událostí, které merge změnil', async () => {
    const f = await seedFixture();
    await seedWebEvents({
      workspaceId: f.workspaceId,
      anonymousId: f.anonymousId,
      count: 3,
      occurredAt: IN_WINDOW,
    });
    // Události, které přišly už s vyplněným contact_id, k tomu kontaktu patří:
    // vznikly až po vazbě a vrácení sloučení se jich nesmí dotknout.
    await seedWebEvents({
      workspaceId: f.workspaceId,
      anonymousId: f.anonymousId,
      contactId: f.contactId,
      count: 2,
      occurredAt: new Date('2026-07-31T11:00:00.000Z'),
    });

    const merge = await run(f);
    expect(merge.eventsTotal).toBe(3);
    expect(await countEventsForContact(f.workspaceId, f.contactId)).toBe(5);

    const reverted = await revertIdentityMerge({
      workspaceId: f.workspaceId,
      mergeId: merge.mergeId!,
      revertedBy: randomUUID(),
      now: NOW,
    });
    expect(reverted).toBe(3);
    expect(await countEventsForContact(f.workspaceId, f.contactId)).toBe(2);

    const { rows } = await asMigrator().query<{ status: string; reverted_at: Date | null }>(
      `SELECT status, reverted_at FROM identity_merges WHERE id = $1`,
      [merge.mergeId],
    );
    expect(rows[0]!.status).toBe('reverted');
    expect(rows[0]!.reverted_at).not.toBeNull();
  });

  it('vrácené sloučení se opakovaným během jobu nekřísí', async () => {
    const f = await seedFixture();
    await seedWebEvents({
      workspaceId: f.workspaceId,
      anonymousId: f.anonymousId,
      count: 3,
      occurredAt: IN_WINDOW,
    });
    const merge = await run(f);
    await revertIdentityMerge({
      workspaceId: f.workspaceId,
      mergeId: merge.mergeId!,
      revertedBy: randomUUID(),
      now: NOW,
    });

    const again = await run(f);
    expect(again.status).toBe('skipped_reverted');
    expect(await countEventsForContact(f.workspaceId, f.contactId)).toBe(0);
  });

  it('revert sloučení, které není completed ani truncated, skončí kódem tracking_merge_not_revertible', async () => {
    const f = await seedFixture();
    const { rows } = await asMigrator().query<{ id: string }>(
      `INSERT INTO identity_merges (workspace_id, anonymous_id, contact_id, binding_id,
                                    window_from, window_to, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'running') RETURNING id`,
      [f.workspaceId, f.anonymousId, f.contactId, f.bindingId, BEFORE_WINDOW, NOW],
    );
    await expect(
      revertIdentityMerge({
        workspaceId: f.workspaceId,
        mergeId: rows[0]!.id,
        revertedBy: randomUUID(),
        now: NOW,
      }),
    ).rejects.toThrow(/tracking_merge_not_revertible/);
  });
});
