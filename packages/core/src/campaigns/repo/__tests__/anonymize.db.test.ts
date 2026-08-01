import { beforeEach, describe, expect, it } from 'vitest';
import { withTestWorkspace, seedMessages, type TestWorkspace } from '../../test/harness';
import { withWorkspace } from '../../../tx';
import { anonymizeMessages } from '../outbox';
import { rawSql } from '../raw-sql';

describe('anonymizace zprav pri vymazu kontaktu', () => {
  let ctx: TestWorkspace;
  beforeEach(async () => {
    ctx = await withTestWorkspace();
  });

  it('prepise adresu na placeholder a vyprazdni render_data, radek zustava', async () => {
    const { contactId } = await seedMessages(ctx, { statuses: ['sent'] });
    await anonymizeMessages(ctx.workspace, contactId);
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ email: string; render_data: unknown }>(
        rawSql(`SELECT email, render_data FROM messages WHERE contact_id = $1`, [contactId]),
      ),
    );
    expect(r.rows[0]!.email).toBe(`erased+${contactId}@erased.invalid`);
    expect(r.rows[0]!.render_data).toEqual({});
  });

  it('anonymizuje i recipient v message_events', async () => {
    const { contactId } = await seedMessages(ctx, { statuses: ['sent'], withEvents: true });
    await anonymizeMessages(ctx.workspace, contactId);
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ recipient: string }>(
        rawSql(`SELECT recipient FROM message_events WHERE contact_id = $1`, [contactId]),
      ),
    );
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.every((x) => x.recipient.endsWith('@erased.invalid'))).toBe(true);
  });

  it('statistiky kampane zustanou, pocet radku se nemeni', async () => {
    const { contactId, campaignId } = await seedMessages(ctx, { statuses: ['sent'] });
    const before = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ n: number }>(
        rawSql(`SELECT count(*)::int AS n FROM messages WHERE campaign_id = $1`, [campaignId]),
      ),
    );
    await anonymizeMessages(ctx.workspace, contactId);
    const after = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ n: number }>(
        rawSql(`SELECT count(*)::int AS n FROM messages WHERE campaign_id = $1`, [campaignId]),
      ),
    );
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });
});
