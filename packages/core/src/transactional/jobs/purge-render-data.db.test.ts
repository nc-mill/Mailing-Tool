import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { handlerModulePath, queue } from '../../queues';
import { seedWorkspaceForCoreTests } from '../../identity/test-helpers';
import { startPgHarness, type PgHarness } from '../../test-support/pg-harness';
import { closePools, withWorkspace } from '../../tx';
import { handler, TRANSACTIONAL_RENDER_DATA_TTL_HOURS } from './purge_render_data';

let harness: PgHarness;

beforeAll(async () => {
  harness = await startPgHarness();
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

const DATA = { data: { reset_url: 'https://shop.cz/reset?token=jednorazovy' } };

/**
 * Založí zprávu přímo, bez celé odesílací cesty: tenhle test je o úklidu
 * `render_data`, ne o odeslání. Nosnou kampaň zakládá taky přímo, protože
 * `messages.campaign_id` u ne-kampaňové zprávy musí být vyplněné.
 */
async function seedMessage(input: {
  kind: 'transactional' | 'campaign' | 'test';
  status: 'sent' | 'pending';
  sentHoursAgo: number | null;
}) {
  const ws = await seedWorkspaceForCoreTests();
  const contactId = await withWorkspace(ws.ctx, async (tx) => {
    const [contact] = await tx
      .insert(schema.contacts)
      .values({ workspaceId: ws.workspaceId, email: `p-${Date.now()}@example.cz` })
      .returning({ id: schema.contacts.id });
    return contact!.id;
  });

  // Kampaňová zpráva má generovaný sloupec `audience_campaign_id` rovný
  // `campaign_id` a cizí klíč na `campaigns (id, audience_built_at)`, takže
  // nosič musí mít materializaci na tomtéž času. U ostatních druhů je hodnota
  // NULL a kontrola se podle MATCH SIMPLE přeskočí.
  const createdAt = new Date();
  const messageId = await withWorkspace(ws.ctx, async (tx) => {
    const [campaign] = await tx
      .insert(schema.campaigns)
      .values({
        workspaceId: ws.workspaceId,
        name: `Nosič ${Date.now()}`,
        kind: input.kind === 'campaign' ? 'campaign' : 'system',
        status: 'draft',
        subject: 'Reset hesla',
        fromName: 'Shop',
        fromEmail: 'noreply@shop.cz',
        ...(input.kind === 'campaign' ? { audienceBuiltAt: createdAt } : {}),
      })
      .returning({ id: schema.campaigns.id });

    const sentAt =
      input.sentHoursAgo === null
        ? null
        : sql`now() - make_interval(hours => ${input.sentHoursAgo})`;
    const [message] = await tx
      .insert(schema.messages)
      .values({
        workspaceId: ws.workspaceId,
        campaignId: campaign!.id,
        contactId,
        kind: input.kind,
        email: 'jan@example.cz',
        renderData: DATA,
        status: input.status,
        createdAt,
        ...(sentAt === null ? {} : { sentAt: sentAt as never }),
      })
      .returning({ id: schema.messages.id });
    return message!.id;
  });

  // Čte se POD KONTEXTEM PROJEKTU. Bez něj politiky z migrace 0004 nepustí ani
  // řádek a test by tvrdil, že zpráva neexistuje.
  const renderDataOf = async (): Promise<unknown> => {
    const rows = await withWorkspace(ws.ctx, (tx) =>
      tx
        .select({ renderData: schema.messages.renderData })
        .from(schema.messages)
        .where(eq(schema.messages.id, messageId)),
    );
    return rows[0]!.renderData;
  };

  return { ws, messageId, renderDataOf };
}

describe('úklid render_data transakční pošty', () => {
  it('odeslanou transakční zprávu po uplynutí lhůty vynuluje', async () => {
    const { renderDataOf } = await seedMessage({
      kind: 'transactional',
      status: 'sent',
      sentHoursAgo: TRANSACTIONAL_RENDER_DATA_TTL_HOURS + 1,
    });
    expect(await renderDataOf()).toEqual(DATA);
    await handler();
    // Odkaz s jednorázovým tokenem je pryč. Řádek zprávy zůstává, statistiky
    // a rekonciliace na něm stojí.
    expect(await renderDataOf()).toEqual({});
  });

  it('čerstvě odeslanou zprávu nechá být, protože ještě může přijít další pokus', async () => {
    const { renderDataOf } = await seedMessage({
      kind: 'transactional',
      status: 'sent',
      sentHoursAgo: 1,
    });
    await handler();
    expect(await renderDataOf()).toEqual(DATA);
  });

  it('neodeslanou zprávu nechá být, jinak by odešel prázdný e-mail', async () => {
    const { renderDataOf } = await seedMessage({
      kind: 'transactional',
      status: 'pending',
      sentHoursAgo: null,
    });
    await handler();
    expect(await renderDataOf()).toEqual(DATA);
  });

  it('kampaňové ani testovací zprávy se nedotkne, rozsah je úzký schválně', async () => {
    const campaign = await seedMessage({
      kind: 'campaign',
      status: 'sent',
      sentHoursAgo: TRANSACTIONAL_RENDER_DATA_TTL_HOURS + 48,
    });
    const test = await seedMessage({
      kind: 'test',
      status: 'sent',
      sentHoursAgo: TRANSACTIONAL_RENDER_DATA_TTL_HOURS + 48,
    });
    await handler();
    expect(await campaign.renderDataOf()).toEqual(DATA);
    expect(await test.renderDataOf()).toEqual(DATA);
  });

  it('opakovaný běh nic nemění a nehlásí práci, kterou neudělal', async () => {
    const { renderDataOf } = await seedMessage({
      kind: 'transactional',
      status: 'sent',
      sentHoursAgo: TRANSACTIONAL_RENDER_DATA_TTL_HOURS + 1,
    });
    expect(await handler()).toBeGreaterThan(0);
    expect(await renderDataOf()).toEqual({});
    // Druhý běh už nemá co dělat: podmínka `render_data <> '{}'` ho zastaví,
    // takže job nedělá prázdné zápisy každou hodinu donekonečna.
    expect(await handler()).toBe(0);
  });

  it('obsluha leží tam, kde ji codegen workeru hledá', () => {
    expect(handlerModulePath(queue('transactional.purge_render_data'))).toBe(
      'packages/core/src/transactional/jobs/queue-handlers.ts',
    );
  });
});
