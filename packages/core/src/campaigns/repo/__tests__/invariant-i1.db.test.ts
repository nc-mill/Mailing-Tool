/**
 * Invariant I1 vynucuje DATABÁZE, ne kód.
 *
 * `uq_messages__campaign_contact (campaign_id, contact_id, created_at)` sám o sobě
 * proti duplicitám NECHRÁNÍ: `messages.created_at` má `DEFAULT now()`, takže první
 * cesta, která zprávu vloží bez explicitního `created_at`, index obejde a kontakt
 * dostane e-mail dvakrát, aniž by cokoli spadlo.
 *
 * Ochranu dává až složený cizí klíč `fk_messages__campaign_audience`
 * `(campaign_id, created_at) REFERENCES campaigns (id, audience_built_at)`: zpráva
 * smí existovat jen s `created_at` rovným `audience_built_at` své kampaně, jinak
 * je to tvrdá chyba 23503.
 *
 * Tenhle test je důkaz. Kdyby ten cizí klíč z migrace zmizel, testy materializace
 * zůstanou zelené a zčervená jen tenhle.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  withTestWorkspace,
  seedCampaign,
  seedContacts,
  seedList,
  type TestWorkspace,
} from '../../test/harness';
import { pgErrorCode, withWorkspace } from '../../../tx';
import { startMaterialization } from '../audience-progress';
import { rawSql } from '../raw-sql';

describe('invariant I1 vynucuje databaze', () => {
  let ctx: TestWorkspace;
  beforeEach(async () => {
    ctx = await withTestWorkspace();
  });

  async function insertMessage(
    campaignId: string,
    contactId: string,
    createdAt: string | null,
  ): Promise<void> {
    await withWorkspace(ctx.workspace, (tx) =>
      tx.execute(
        rawSql(
          `INSERT INTO messages (workspace_id, campaign_id, contact_id, kind, email, status, created_at)
           VALUES ($1, $2, $3, 'campaign', 'x@example.cz', 'pending',
                   COALESCE($4::timestamptz, now()))`,
          [ctx.workspaceId, campaignId, contactId, createdAt],
        ),
      ),
    );
  }

  it('zprava s created_at rovnym audience_built_at projde', async () => {
    const list = await seedList(ctx);
    const [contactId] = await seedContacts(ctx, { count: 1, list });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);

    await expect(insertMessage(id, contactId!, audienceBuiltAt)).resolves.toBeUndefined();
  });

  it('zprava s JINYM created_at spadne na 23503, ne az na duplicite u prijemce', async () => {
    const list = await seedList(ctx);
    const [contactId] = await seedContacts(ctx, { count: 1, list });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);
    const posunuty = new Date(Date.parse(audienceBuiltAt!) + 1_000).toISOString();

    let caught: unknown;
    await insertMessage(id, contactId!, posunuty).catch((e: unknown) => {
      caught = e;
    });

    // SQLSTATE se cte pres pgErrorCode. Drizzle chybu ovladace bali, takze
    // `err.code` je undefined a `.rejects.toThrow(/text/)` by se neshodlo.
    expect(pgErrorCode(caught)).toBe('23503');
  });

  it('zprava vlozena s DEFAULT now() misto explicitni hodnoty take spadne', async () => {
    const list = await seedList(ctx);
    const [contactId] = await seedContacts(ctx, { count: 1, list });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    await startMaterialization(ctx.workspace, id, 0);

    let caught: unknown;
    await insertMessage(id, contactId!, null).catch((e: unknown) => {
      caught = e;
    });
    expect(pgErrorCode(caught)).toBe('23503');
  });

  it('kampan bez materializace neni cilem odkazu, takze k ni zprava nevznikne', async () => {
    const list = await seedList(ctx);
    const [contactId] = await seedContacts(ctx, { count: 1, list });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });

    let caught: unknown;
    await insertMessage(id, contactId!, new Date().toISOString()).catch((e: unknown) => {
      caught = e;
    });
    expect(pgErrorCode(caught)).toBe('23503');
  });
});
