import { beforeEach, describe, expect, it } from 'vitest';
import { createHtmlEngine } from '@mlain/contracts/liquid/engine';
import { COMPILED_ONLY_ROOTS } from '@mlain/contracts/liquid/grammar';
import { prepareRenderData } from '@mlain/contracts/liquid/prepare-render-data';
import { blockDefaults, DEFAULT_THEME } from '@mlain/emails/document/defaults';
import { toPreparedSchema } from '@mlain/emails/paths';
import type { ResolvedTrialSettings } from '../../providers/trial-mode';
import { withWorkspace } from '../../tx';
import { compileCampaign, renderPlanForCampaign } from '../compile-service';
import { startMaterialization } from '../repo/audience-progress';
import { listCampaignLinks } from '../repo/links';
import { materializeBatch } from '../repo/outbox';
import { rawSql } from '../repo/raw-sql';
import { ZERO_UUID } from '../materialize/plan-constants';
import {
  seedCampaign,
  seedContacts,
  seedList,
  withTestWorkspace,
  type TestWorkspace,
} from '../test/harness';

/**
 * Celý řetěz: kompilace, uložení, materializace, interpolace.
 *
 * Existuje proto, že každý článek zvlášť je v pořádku a rozejít se dokážou tak, že
 * se to pozná až na odeslaném mailu, kde chybí celá sekce a nikde přitom nic nespadlo.
 * Schválně NEPOUŽÍVÁ konstanty P13: jméno kořene bere z kontraktů a mapu plní
 * kontraktní funkcí, tedy toutéž, jakou má náhled i sender.
 */

/** Zkušební režim vypnutý: materializace ho čte vždycky, i mimo jeho scénáře. */
const TRIAL_OFF: ResolvedTrialSettings = { trial_mode: false };

const footer = { id: 'b_000000000099', type: 'footer', props: blockDefaults('footer') };

/** Dokument s odkazem, s personalizací a s podmíněným blokem nad contact.attr.city. */
function design(): unknown {
  return {
    schemaVersion: 1,
    meta: { name: 'Jarní novinky', previewText: 'Vítejte', language: 'cs' },
    theme: DEFAULT_THEME,
    blocks: [
      {
        id: 'b_000000000001',
        type: 'section',
        props: blockDefaults('section'),
        children: [
          {
            id: 'b_000000000002',
            type: 'text',
            props: {
              ...blockDefaults('text'),
              content: [
                {
                  t: 'p',
                  children: [
                    { t: 's', v: 'Ahoj ' },
                    { t: 'var', expr: 'contact.first_name' },
                    { t: 's', v: ', mrkni na ' },
                    {
                      t: 'a',
                      href: 'https://example.cz/akce',
                      trackable: true,
                      children: [{ t: 's', v: 'akci' }],
                    },
                  ],
                },
              ],
            },
          },
          {
            id: 'b_000000000003',
            type: 'text',
            visibleWhen: { field: 'contact.attr.city', op: 'present' },
            props: {
              ...blockDefaults('text'),
              content: [{ t: 'p', children: [{ t: 's', v: 'Jsme i u vás' }] }],
            },
          },
          footer,
        ],
      },
    ],
  };
}

async function seedCityField(ctx: TestWorkspace): Promise<void> {
  await withWorkspace(ctx.workspace, (tx) =>
    tx.execute(
      rawSql(
        `INSERT INTO contact_fields (workspace_id, key, type, label)
         VALUES ($1, 'city', 'text', '{"en":"City","cs":"Město"}'::jsonb)`,
        [ctx.workspaceId],
      ),
    ),
  );
}

describe('cely retez: kompilace, ulozeni, materializace, interpolace', () => {
  let ctx: TestWorkspace;
  beforeEach(async () => {
    ctx = await withTestWorkspace();
    await seedCityField(ctx);
  });

  it('kompilace ulozi telo, metadata i odkazy a odhlasovaci odkaz v HTML je', async () => {
    const id = await seedCampaign(ctx, { status: 'draft', design: design(), subject: 'Test' });
    const compilation = await compileCampaign(ctx.workspace, id);

    // Bez odhlašovacího odkazu vrací předletová kontrola `campaign_no_unsubscribe`.
    expect(compilation.compileMeta.hasUnsubscribeLink).toBe(true);
    expect(compilation.html).toContain('unsubscribe_url');

    // Podmíněný blok se emituje jako `{% if <koren>.contact__attr__city %}`.
    expect(compilation.html).toContain(`${COMPILED_ONLY_ROOTS[0]}.contact__attr__city`);

    // compile_meta je SKUTEČNĚ v databázi, ne jen v návratové hodnotě.
    const stored = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{
        compile_meta: { usedPaths: string[] } | null;
        compiled_html: string | null;
        compiled_text: string | null;
        compiled_hash: string | null;
        revision: number;
      }>(
        rawSql(
          `SELECT compile_meta, compiled_html, compiled_text, compiled_hash, revision
             FROM campaigns WHERE id = $1`,
          [id],
        ),
      ),
    );
    const row = stored.rows[0]!;
    expect(row.compile_meta).not.toBeNull();
    expect(row.compile_meta!.usedPaths).toContain('contact.first_name');
    expect(row.compiled_html).toContain('unsubscribe_url');
    expect(row.compiled_text).not.toBeNull();
    expect(row.compiled_hash).toBe(compilation.compiledHash);
    // Klíč cache senderu je (campaign_id, revision), takže kompilace revizi zvyšuje.
    expect(row.revision).toBe(2);

    // campaign_links vzniká TOUTO cestou a ID i pozice jsou z CompileMeta (D17).
    const links = await listCampaignLinks(ctx.workspace, id);
    expect(links.map((l) => l.id)).toEqual(compilation.compileMeta.links.map((l) => l.id));
    expect(links.map((l) => l.position)).toEqual([1]);
    expect(links[0]!.url).toBe('https://example.cz/akce');
  });

  it('opakovana kompilace odkazy nahradi, nezdvoji', async () => {
    const id = await seedCampaign(ctx, { status: 'draft', design: design(), subject: 'Test' });
    await compileCampaign(ctx.workspace, id);
    await compileCampaign(ctx.workspace, id);
    expect(await listCampaignLinks(ctx.workspace, id)).toHaveLength(1);
  });

  it('kampan mimo upravy se prekompilovat neda: compile_meta je nemenna (D18)', async () => {
    const id = await seedCampaign(ctx, { status: 'sending', design: design(), subject: 'Test' });
    await expect(compileCampaign(ctx.workspace, id)).rejects.toThrowError(/campaign_locked/);
  });

  it('kampan bez obsahu se nezkompiluje a rekne to kodem, ne prazdnym telem', async () => {
    const id = await seedCampaign(ctx, { status: 'draft', subject: 'Test' });
    await withWorkspace(ctx.workspace, (tx) =>
      tx.execute(rawSql(`UPDATE campaigns SET design = NULL WHERE id = $1`, [id])),
    );
    await expect(compileCampaign(ctx.workspace, id)).rejects.toThrowError(/campaign_not_compiled/);
  });

  it('podmineny blok se objevi u toho, kdo ma mesto, a zmizi u toho, kdo ne', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, {
      count: 1,
      list,
      email: 'ma@example.cz',
      attributes: { city: 'Brno' },
    });
    await seedContacts(ctx, { count: 1, list, email: 'nema@example.cz', attributes: {} });
    const id = await seedCampaign(ctx, {
      status: 'draft',
      includeLists: [list],
      design: design(),
      subject: 'Test',
    });

    const compilation = await compileCampaign(ctx.workspace, id);

    // Materializace použije ULOŽENÝ plán, nekompiluje znovu.
    const renderPlan = await renderPlanForCampaign(ctx.workspace, id);
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);
    await materializeBatch(ctx.workspace, {
      campaignId: id,
      audienceBuiltAt: audienceBuiltAt!,
      cursor: ZERO_UUID,
      batchSize: 500,
      where: { sql: 'true', params: [] },
      renderPlan,
      sampleContactIds: [],
      releaseAt: null,
      trial: TRIAL_OFF,
    });

    const outbox = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ email: string; render_data: Record<string, unknown> }>(
        rawSql(`SELECT email, render_data FROM messages WHERE campaign_id = $1 ORDER BY email`, [
          id,
        ]),
      ),
    );
    expect(outbox.rows.map((r) => r.email)).toEqual(['ma@example.cz', 'nema@example.cz']);

    // Interpolace TÝMŽ enginem, jaký má sender.
    // Engine se bere z kontraktu, ne `new Liquid()`: jen ten má nastavení
    // (jsTruthy: false, strictVariables: false), pod kterým platí kontrakt.
    const engine = createHtmlEngine();
    const rendered = await Promise.all(
      outbox.rows.map((r) => engine.parseAndRender(compilation.html, r.render_data)),
    );
    expect(rendered[0]).toContain('Jsme i u vás');
    expect(rendered[1]).not.toContain('Jsme i u vás');
  });

  it('kdyz se render_data ulozi bez pripravy, blok zmizi VSEM (regrese R11)', async () => {
    const id = await seedCampaign(ctx, { status: 'draft', design: design(), subject: 'Test' });
    const compilation = await compileCampaign(ctx.workspace, id);

    // Engine se bere z kontraktu, ne `new Liquid()`: jen ten má nastavení
    // (jsTruthy: false, strictVariables: false), pod kterým platí kontrakt.
    const engine = createHtmlEngine();
    const surova = { contact: { first_name: 'Jan', attr: { city: 'Brno' } } };
    const bezPripravy = await engine.parseAndRender(compilation.html, surova);
    const sPripravou = await engine.parseAndRender(
      compilation.html,
      prepareRenderData(surova, toPreparedSchema(compilation.compileMeta.renderSchema)),
    );

    // Tohle je ta tichá vada: hodnota JE vyplněná, a blok přesto zmizí.
    expect(bezPripravy).not.toContain('Jsme i u vás');
    expect(sPripravou).toContain('Jsme i u vás');
  });
});
