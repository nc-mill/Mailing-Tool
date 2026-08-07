import { beforeEach, describe, expect, it } from 'vitest';
import {
  withTestWorkspace,
  seedCampaign,
  seedContacts,
  seedList,
  type TestWorkspace,
} from '../../test/harness';
import { withWorkspace } from '../../../tx';
import { ZERO_UUID } from '../../materialize/plan-constants';
import { materializeBatch } from '../outbox';
import { startMaterialization } from '../audience-progress';
import { rawSql } from '../raw-sql';
import type { ResolvedTrialSettings } from '../../../providers/trial-mode';

const TRIAL_OFF: ResolvedTrialSettings = { trial_mode: false };

/**
 * Merge tagy, ktere paletka personalizace v editoru NABIZI a kandidatsky dotaz
 * materializace je drive nedodal, protoze SELECT mel pevny vycet sedmi sloupcu.
 * Hodnota dosla do render_data jako null a v odeslane zprave bylo prazdno.
 */
const OFFERED_PATHS = [
  'contact.first_name',
  'contact.last_name',
  'contact.middle_name',
  'contact.title_prefix',
  'contact.title_suffix',
  'contact.gender',
  'contact.first_name_vocative',
  'contact.last_name_vocative',
  'contact.greeting',
  'contact.locale',
  'contact.created_at',
] as const;

describe('vyber sloupcu kontaktu podle sablony', () => {
  let ctx: TestWorkspace;
  beforeEach(async () => {
    ctx = await withTestWorkspace();
  });

  async function materializeWith(
    paths: readonly string[],
    presence: readonly string[] = [],
  ): Promise<Array<{ render_data: Record<string, unknown>; status: string }>> {
    const list = await seedList(ctx);
    const [contactId] = await seedContacts(ctx, { count: 1, list });
    await withWorkspace(ctx.workspace, (tx) =>
      tx.execute(
        rawSql(
          `UPDATE contacts
              SET first_name = 'Jana', last_name = 'Nováková', middle_name = 'Marie',
                  title_prefix = 'Ing.', title_suffix = 'Ph.D.', gender = 'female',
                  first_name_vocative = 'Jano', last_name_vocative = 'Nováková',
                  greeting = 'Dobrý den, Jano', locale = 'cs'
            WHERE id = $1 AND workspace_id = $2`,
          [contactId!, ctx.workspaceId],
        ),
      ),
    );

    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);
    await materializeBatch(ctx.workspace, {
      campaignId: id,
      audienceBuiltAt: audienceBuiltAt!,
      cursor: ZERO_UUID,
      batchSize: 500,
      where: { sql: 'true', params: [] },
      renderPlan: {
        usedPaths: [...paths],
        preparedSchema: { fields: [...paths], presence: [...presence] },
      },
      sampleContactIds: [],
      releaseAt: null,
      trial: TRIAL_OFF,
    });

    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ render_data: Record<string, unknown>; status: string }>(
        rawSql(`SELECT render_data, status FROM messages WHERE campaign_id = $1`, [id]),
      ),
    );
    return r.rows;
  }

  it('vsechna nabizena pole doputuji do render_data, ne jen sedm pevnych sloupcu', async () => {
    const rows = await materializeWith(OFFERED_PATHS);
    expect(rows).toHaveLength(1);
    const contact = rows[0]!.render_data.contact as Record<string, unknown>;

    expect(contact.first_name).toBe('Jana');
    expect(contact.last_name).toBe('Nováková');
    expect(contact.middle_name).toBe('Marie');
    expect(contact.title_prefix).toBe('Ing.');
    expect(contact.title_suffix).toBe('Ph.D.');
    expect(contact.gender).toBe('female');
    expect(contact.first_name_vocative).toBe('Jano');
    expect(contact.last_name_vocative).toBe('Nováková');
    expect(contact.greeting).toBe('Dobrý den, Jano');
    expect(contact.locale).toBe('cs');
    // RFC 3339, ne postgresovy tvar s mezerou: filtr `date` v senderu jiny neuzna
    // a znacka by vyrenderovala prazdno.
    expect(contact.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('podmineny blok nad nove dodanym polem vyjde pravdive', async () => {
    const rows = await materializeWith(['contact.title_prefix'], ['contact.title_prefix']);
    const present = rows[0]!.render_data._present as Record<string, boolean>;
    expect(present.contact__title_prefix).toBe(true);
  });

  it('e-mail se do render_data nedostane, i kdyz ho sablona uvadi', async () => {
    const rows = await materializeWith(['contact.email', 'contact.first_name']);
    expect(JSON.stringify(rows[0]!.render_data)).not.toContain('@example.com');
  });

  it('sablona bez merge tagu nesnapshotuje zadny sloupec kontaktu', async () => {
    const rows = await materializeWith([]);
    expect(rows[0]!.render_data.contact).toEqual({});
  });

  it('strop render_data plati i pri vyberu podle sablony', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 1, list, attributes: { bio: 'x'.repeat(9000) } });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);

    const paths = [...OFFERED_PATHS, 'contact.attr.bio'];
    const out = await materializeBatch(ctx.workspace, {
      campaignId: id,
      audienceBuiltAt: audienceBuiltAt!,
      cursor: ZERO_UUID,
      batchSize: 500,
      where: { sql: 'true', params: [] },
      renderPlan: { usedPaths: paths, preparedSchema: { fields: paths, presence: [] } },
      sampleContactIds: [],
      releaseAt: null,
      trial: TRIAL_OFF,
    });

    expect(out.skippedOversize).toBe(1);
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ status: string; error_code: string | null; render_data: unknown }>(
        rawSql(`SELECT status, error_code, render_data FROM messages WHERE campaign_id = $1`, [id]),
      ),
    );
    expect(r.rows[0]!.status).toBe('skipped');
    expect(r.rows[0]!.error_code).toBe('render_data_too_large');
    expect(r.rows[0]!.render_data).toEqual({});
  });
});
