import { describe, expect, it } from 'vitest';
import type { WorkspaceContext } from '../../../identity/types';
import { bulkVocativeReview } from '../../jobs/bulk-vocative-review';
import { writeContact } from '../../repo/contacts';
import { applyGroupActionBatch } from '../../vocative-review/actions';
import { asMigrator, testContext } from '../support/db';

/**
 * Hromadné vyřízení skupiny fronty ke kontrole oslovení, proti skutečné databázi.
 *
 * Fronta `contacts.bulk_vocative_review` PRODUCENTA MĚLA (`applyGroupAction` do
 * ní zařadí každou skupinu nad pěti tisíci kontakty), ale obsluhu ne. Skupina
 * nad limitem tedy dostala v rozhraní 202 „vyřizujeme" a nevyřídilo se nic.
 */

/**
 * Skupina fronty: kontakty se stejným klíčem jména a nízkou jistotou vokativu.
 * Jistota se dosazuje SQL, protože se test neptá na to, jak se určuje rod,
 * ale na to, co s takovou skupinou udělá job.
 */
async function seedGroup(ctx: WorkspaceContext, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await writeContact(ctx, {
      email: `saskia-${i}@x.cz`,
      firstName: 'Saskia',
      lastName: `Nováková${i}`,
      attributes: {},
    });
  }
  await asMigrator().query(
    `UPDATE contacts SET vocative_confidence = 'low', vocative_locked = false
      WHERE workspace_id = $1 AND first_name_key = 'saskia'`,
    [ctx.workspaceId],
  );
}

type GroupRow = {
  email: string;
  first_name_vocative: string | null;
  vocative_locked: boolean;
  vocative_confidence: string;
  gender: string;
  greeting: string;
};

async function groupRows(ctx: WorkspaceContext): Promise<GroupRow[]> {
  const { rows } = await asMigrator().query<GroupRow>(
    `SELECT email::text AS email, first_name_vocative, vocative_locked,
            vocative_confidence, gender, greeting
       FROM contacts WHERE workspace_id = $1 AND first_name_key = 'saskia'
      ORDER BY email`,
    [ctx.workspaceId],
  );
  return rows;
}

describe('contacts.bulk_vocative_review proti databázi', () => {
  it('zamkne celou skupinu a zapíše přepis jména', async () => {
    const ctx = await testContext();
    await seedGroup(ctx, 5);

    // PŘED: nic není potvrzené.
    const before = await groupRows(ctx);
    expect(before).toHaveLength(5);
    expect(before.every((row) => row.vocative_locked === false)).toBe(true);
    expect(before.every((row) => row.vocative_confidence === 'low')).toBe(true);

    const result = await bulkVocativeReview({
      workspaceId: ctx.workspaceId,
      nameKey: 'saskia',
      kind: 'first',
      action: 'set_vocative',
      vocative: 'Saskie',
      gender: null,
      saveOverride: true,
      expected: 5,
    });

    // PO: všech pět zamčených, s potvrzeným vokativem a přepočítaným oslovením.
    expect(result.affected).toBe(5);
    const after = await groupRows(ctx);
    expect(after.every((row) => row.vocative_locked === true)).toBe(true);
    expect(after.every((row) => row.vocative_confidence === 'high')).toBe(true);
    expect(after.every((row) => row.first_name_vocative === 'Saskie')).toBe(true);
    expect(after.every((row) => row.greeting === 'Dobrý den, Saskie')).toBe(true);

    // Přepis jména, aby příští import stejné jméno nevyhodil do fronty znovu.
    const { rows: overrides } = await asMigrator().query<{ name_key: string; vocative: string }>(
      `SELECT name_key, vocative FROM name_overrides WHERE workspace_id = $1`,
      [ctx.workspaceId],
    );
    expect(overrides).toEqual([{ name_key: 'saskia', vocative: 'Saskie' }]);
  });

  it('druhý běh nemá co měnit (idempotence přes vocative_locked)', async () => {
    const ctx = await testContext();
    await seedGroup(ctx, 3);
    const payload = {
      workspaceId: ctx.workspaceId,
      nameKey: 'saskia',
      kind: 'first' as const,
      action: 'confirm' as const,
      saveOverride: false,
    };

    expect((await bulkVocativeReview(payload)).affected).toBe(3);
    expect(await bulkVocativeReview(payload)).toEqual({ affected: 0, batches: 0 });
  });

  it('běh po dávkách zpracuje skupinu celou a skončí', async () => {
    const ctx = await testContext();
    await seedGroup(ctx, 5);

    // Dávkování se ověřuje na malém limitu, ne na pěti tisících kontaktech:
    // job volá TUTÉŽ funkci, jen s BULK_BATCH_SIZE.
    const sizes: number[] = [];
    for (;;) {
      const written = await applyGroupActionBatch(
        ctx,
        { nameKey: 'saskia', kind: 'first', action: 'confirm', saveOverride: false },
        2,
      );
      if (written === 0) break;
      sizes.push(written);
    }

    expect(sizes).toEqual([2, 2, 1]);
    expect((await groupRows(ctx)).every((row) => row.vocative_locked === true)).toBe(true);
  });

  it('akce set_gender přepočítá vokativ, ne jen zamkne', async () => {
    const ctx = await testContext();
    await writeContact(ctx, {
      email: 'rene@x.cz',
      firstName: 'René',
      lastName: 'Dvořák',
      attributes: {},
    });
    await asMigrator().query(
      `UPDATE contacts SET vocative_confidence = 'low', gender = 'unknown',
                           first_name_vocative = NULL
        WHERE workspace_id = $1 AND first_name_key = 'rene'`,
      [ctx.workspaceId],
    );

    await bulkVocativeReview({
      workspaceId: ctx.workspaceId,
      nameKey: 'rene',
      kind: 'first',
      action: 'set_gender',
      gender: 'male',
      saveOverride: false,
    });

    const { rows } = await asMigrator().query<{
      gender: string;
      gender_source: string;
      first_name_vocative: string | null;
    }>(
      `SELECT gender, gender_source, first_name_vocative FROM contacts
        WHERE workspace_id = $1 AND first_name_key = 'rene'`,
      [ctx.workspaceId],
    );
    expect(rows[0]?.gender).toBe('male');
    expect(rows[0]?.gender_source).toBe('manual');
    expect(rows[0]?.first_name_vocative).not.toBeNull();
  });

  it('prázdný vokativ u set_vocative skončí chybou, ne zamčením prázdna', async () => {
    const ctx = await testContext();
    await seedGroup(ctx, 2);

    await expect(
      bulkVocativeReview({
        workspaceId: ctx.workspaceId,
        nameKey: 'saskia',
        kind: 'first',
        action: 'set_vocative',
        vocative: '   ',
        saveOverride: false,
      }),
    ).rejects.toThrow();

    expect((await groupRows(ctx)).every((row) => row.vocative_locked === false)).toBe(true);
  });

  it('auditní stopa vznikne na každou dávku', async () => {
    const ctx = await testContext();
    await seedGroup(ctx, 3);
    await bulkVocativeReview({
      workspaceId: ctx.workspaceId,
      nameKey: 'saskia',
      kind: 'first',
      action: 'confirm',
      saveOverride: false,
    });

    const { rows } = await asMigrator().query<{
      action: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT action, metadata FROM audit_log
        WHERE workspace_id = $1 AND action = 'contact.vocative_bulk_confirmed'`,
      [ctx.workspaceId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toMatchObject({ name_key: 'saskia', affected: 3, kind: 'first' });
  });
});
