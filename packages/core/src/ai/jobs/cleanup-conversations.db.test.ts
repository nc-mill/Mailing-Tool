import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { seedWorkspaceForCoreTests, type SeededWorkspace } from '../../identity/test-helpers';
import { startPgHarness, type PgHarness } from '../../test-support/pg-harness';
import { closePools, withWorkspace } from '../../tx';
import { handlers } from './queue-handlers';
import { systemCleanupConversationsDeps } from './system-deps';

/**
 * DŮKAZ, že `ai.cleanup_conversations` doopravdy uklidí.
 *
 * Úloha padala každou noc, protože obsluha byla vedená jako `needsDependencies`:
 * `cleanupConversations` mělo testy, ale továrnu jeho závislostí nikdo nenapsal.
 * Konverzace i s tím, co do nich lidé napsali, tedy zůstávaly v databázi navždy,
 * bez ohledu na `AI_CONVERSATION_RETENTION_DAYS`.
 *
 * Jednotkové testy vedle tuhle vadu zachytit nemohly: podstrkují si `CleanupDeps`,
 * tedy právě to, co v produkci chybělo. Měřítkem je proto řádek v databázi.
 */
let harness: PgHarness;
let seeded: SeededWorkspace;

beforeAll(async () => {
  harness = await startPgHarness();
  seeded = await seedWorkspaceForCoreTests();
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

async function seedConversation(updatedAt: Date): Promise<string> {
  return withWorkspace(seeded.ctx, async (tx) => {
    const rows = await tx
      .insert(schema.aiConversations)
      .values({
        workspaceId: seeded.ctx.workspaceId,
        model: 'claude-sonnet-5',
        createdAt: updatedAt,
        updatedAt,
      })
      .returning({ id: schema.aiConversations.id });
    return rows[0]!.id;
  });
}

async function exists(id: string): Promise<boolean> {
  return withWorkspace(seeded.ctx, async (tx) => {
    const rows = await tx
      .select({ id: schema.aiConversations.id })
      .from(schema.aiConversations)
      .where(eq(schema.aiConversations.id, id));
    return rows.length > 0;
  });
}

const dayMs = 24 * 60 * 60 * 1000;

describe('retence konverzací nad skutečnou databází', () => {
  it('smaže konverzaci starší než lhůta a mladší nechá', async () => {
    const stara = await seedConversation(new Date(Date.now() - 400 * dayMs));
    const cerstva = await seedConversation(new Date());

    const deps = systemCleanupConversationsDeps();
    const deleted = await deps.deleteConversationsOlderThan(new Date(Date.now() - 90 * dayMs));

    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await exists(stara)).toBe(false);
    expect(await exists(cerstva)).toBe(true);
  });

  it('zprávy konverzace zmizí kaskádou, nezůstanou osiřelé', async () => {
    const id = await seedConversation(new Date(Date.now() - 400 * dayMs));
    await withWorkspace(seeded.ctx, (tx) =>
      tx.insert(schema.aiMessages).values({
        workspaceId: seeded.ctx.workspaceId,
        conversationId: id,
        seq: 1,
        role: 'user',
        parts: [{ type: 'text', text: 'ahoj' }],
      }),
    );

    await systemCleanupConversationsDeps().deleteConversationsOlderThan(
      new Date(Date.now() - 90 * dayMs),
    );

    const zbyle = await withWorkspace(seeded.ctx, (tx) =>
      tx
        .select({ id: schema.aiMessages.id })
        .from(schema.aiMessages)
        .where(eq(schema.aiMessages.conversationId, id)),
    );
    expect(zbyle).toEqual([]);
  });

  /**
   * Tohle je ta vada sama. Obsluha se volá přesně tak, jak ji volá pg-boss:
   * cronový tik s PRÁZDNÝM nákladem. Dřív na tom skončila chybou o chybějících
   * závislostech, tedy dřív, než se vůbec dostala k databázi.
   */
  it('obsluha fronty doběhne na cronovém tiku s prázdným nákladem', async () => {
    await expect(
      handlers['ai.cleanup_conversations']([
        { id: 'j1', name: 'ai.cleanup_conversations', data: {} },
      ]),
    ).resolves.toBeUndefined();
  });
});
