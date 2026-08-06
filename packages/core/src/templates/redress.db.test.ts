import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@mlain/db/schema';
import { blockDefaults, DEFAULT_THEME } from '@mlain/emails/document/defaults';
import type { Document } from '@mlain/emails/document/types';
import { saveDefaultBrandProfile } from '../brand/repo/profiles.repo';
import type { BrandProfileSummary } from '../brand/repo/profiles.repo';
import type { FieldCatalog } from '../contacts/fields/catalog';
import { seedWorkspaceForCoreTests } from '../identity/test-helpers';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { closePools, withWorkspace } from '../tx';
import { redressTemplatesToBrand } from './redress';
import { findTemplateById } from './repository';
import { createTemplate } from './service';

let harness: PgHarness;

beforeAll(async () => {
  harness = await startPgHarness();
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

const catalog: FieldCatalog = { version: 'v1', fields: [] };

const footer = { id: 'b_000000000099', type: 'footer', props: blockDefaults('footer') };
const design = {
  schemaVersion: 1,
  meta: { name: 'T', previewText: '', language: 'cs' },
  theme: DEFAULT_THEME,
  blocks: [
    {
      id: 'b_000000000001',
      type: 'section',
      props: blockDefaults('section'),
      children: [footer],
    },
  ],
} as unknown as Document;

const FIALOVA = '#d324eb';
const ZELENA = '#0d7a3f';

const profile = (
  primary: string,
  fonts = 'system',
): Parameters<typeof saveDefaultBrandProfile>[2] => ({
  name: 'Značka',
  palette: {
    primary,
    secondary: '#52ff6e',
    accent: '#aceb24',
    background: '#ffffff',
    text: '#111827',
    source: {},
  },
  typography: { headingStack: fonts, bodyStack: fonts, radius: 6 },
  logoAssetId: null,
});

const seeded = async () => {
  const ws = await seedWorkspaceForCoreTests();
  return { ws, ctx: { ctx: ws.ctx, fields: catalog, userId: ws.userId } };
};

/** Uloží značku a vrátí profil v tom tvaru, v jakém ho čte převlékání. */
const setBrand = async (
  ctx: Awaited<ReturnType<typeof seeded>>['ctx'],
  workspaceId: string,
  input: Parameters<typeof saveDefaultBrandProfile>[2],
): Promise<BrandProfileSummary> => {
  await withWorkspace(ctx.ctx, (tx) => saveDefaultBrandProfile(tx, workspaceId, input));
  const { findDefaultBrandProfile } = await import('../brand/repo/profiles.repo');
  return (await withWorkspace(ctx.ctx, (tx) => findDefaultBrandProfile(tx)))!;
};

const documentOf = async (ctx: Awaited<ReturnType<typeof seeded>>['ctx'], id: string) => {
  const row = await withWorkspace(ctx.ctx, (tx) => findTemplateById(tx, ctx.ctx, id));
  return row!.design as Document;
};

const rowOf = async (ctx: Awaited<ReturnType<typeof seeded>>['ctx'], id: string) =>
  (await withWorkspace(ctx.ctx, (tx) => findTemplateById(tx, ctx.ctx, id)))!;

/**
 * PŘEVLEČENÍ ULOŽENÝCH E-MAILŮ DO BAREV ZNAČKY.
 *
 * Chytá přesně tu stížnost, kvůli které to vzniklo: „změnil jsem barvy značky
 * a v existující kampani mám pořád staré". Zapékání při zakládání ji neřeší,
 * protože motiv je součást uloženého dokumentu.
 */
describe('redressTemplatesToBrand', () => {
  it('existující e-mail dostane nové barvy značky', async () => {
    const { ws, ctx } = await seeded();
    const stara = await setBrand(ctx, ws.workspaceId, profile(FIALOVA));
    const row = await createTemplate(ctx, { name: 'Stará kampaň', document: design });
    expect((await documentOf(ctx, row.id)).theme.colors['brand.primary']).toBe(FIALOVA);

    const nova = await setBrand(ctx, ws.workspaceId, profile(ZELENA));
    const result = await withWorkspace(ctx.ctx, (tx) =>
      redressTemplatesToBrand(tx, ctx.ctx, { previous: stara, next: nova, fields: catalog }),
    );

    expect(result.changed).toBe(1);
    expect((await documentOf(ctx, row.id)).theme.colors['brand.primary']).toBe(ZELENA);
  });

  it('nehýbe s updated_at, aby se knihovna nepřerovnala', async () => {
    const { ws, ctx } = await seeded();
    const stara = await setBrand(ctx, ws.workspaceId, profile(FIALOVA));
    const row = await createTemplate(ctx, { name: 'Beze změny času', document: design });
    const pred = (await rowOf(ctx, row.id)).updatedAt;

    const nova = await setBrand(ctx, ws.workspaceId, profile(ZELENA));
    await withWorkspace(ctx.ctx, (tx) =>
      redressTemplatesToBrand(tx, ctx.ctx, { previous: stara, next: nova, fields: catalog }),
    );

    const po = await rowOf(ctx, row.id);
    expect(po.updatedAt.getTime()).toBe(pred.getTime());
    // Kontrola, že test opravdu něco převlékl: bez toho by procházel i tehdy,
    // kdyby se nezměnilo vůbec nic.
    expect((po.design as Document).theme.colors['brand.primary']).toBe(ZELENA);
  });

  it('zděděné písmo přebere, ručně nastavené nechá být', async () => {
    const { ws, ctx } = await seeded();
    const stara = await setBrand(ctx, ws.workspaceId, profile(FIALOVA, 'georgia'));
    const zdedene = await createTemplate(ctx, { name: 'Zděděné písmo', document: design });
    const vlastni = await createTemplate(ctx, {
      name: 'Vlastní písmo',
      document: {
        ...design,
        theme: { ...DEFAULT_THEME, fonts: { heading: 'courier', body: 'courier' } },
      } as unknown as Document,
    });

    const nova = await setBrand(ctx, ws.workspaceId, profile(ZELENA, 'verdana'));
    await withWorkspace(ctx.ctx, (tx) =>
      redressTemplatesToBrand(tx, ctx.ctx, { previous: stara, next: nova, fields: catalog }),
    );

    expect((await documentOf(ctx, zdedene.id)).theme.fonts).toEqual({
      heading: 'verdana',
      body: 'verdana',
    });
    // Barvy dostane i tenhle, protože ty se autorovat nedají. Písmo ne.
    const upravený = await documentOf(ctx, vlastni.id);
    expect(upravený.theme.fonts).toEqual({ heading: 'courier', body: 'courier' });
    expect(upravený.theme.colors['brand.primary']).toBe(ZELENA);
  });

  it('nešahá na šířku obsahu ani typografii dokumentu', async () => {
    const { ws, ctx } = await seeded();
    const stara = await setBrand(ctx, ws.workspaceId, profile(FIALOVA));
    const row = await createTemplate(ctx, {
      name: 'Širší obsah',
      document: {
        ...design,
        theme: { ...DEFAULT_THEME, contentWidth: 640 },
      } as unknown as Document,
    });

    const nova = await setBrand(ctx, ws.workspaceId, profile(ZELENA));
    await withWorkspace(ctx.ctx, (tx) =>
      redressTemplatesToBrand(tx, ctx.ctx, { previous: stara, next: nova, fields: catalog }),
    );

    const doc = await documentOf(ctx, row.id);
    expect(doc.theme.contentWidth).toBe(640);
    expect(doc.theme.colors['brand.primary']).toBe(ZELENA);
  });

  it('obsah odeslané kampaně se nepřevléká, rozepsané ano', async () => {
    const { ws, ctx } = await seeded();
    const stara = await setBrand(ctx, ws.workspaceId, profile(FIALOVA));
    const odeslana = await createTemplate(ctx, {
      name: 'Odeslaná · pracovní kopie',
      kind: 'system',
      document: design,
    });
    const rozepsana = await createTemplate(ctx, {
      name: 'Rozepsaná · pracovní kopie',
      kind: 'system',
      document: design,
    });
    await withWorkspace(ctx.ctx, (tx) =>
      tx.insert(schema.campaigns).values([
        {
          workspaceId: ws.workspaceId,
          name: 'Odeslaná',
          templateId: odeslana.id,
          status: 'sent',
        },
        {
          workspaceId: ws.workspaceId,
          name: 'Rozepsaná',
          templateId: rozepsana.id,
          status: 'draft',
        },
      ]),
    );

    const nova = await setBrand(ctx, ws.workspaceId, profile(ZELENA));
    await withWorkspace(ctx.ctx, (tx) =>
      redressTemplatesToBrand(tx, ctx.ctx, { previous: stara, next: nova, fields: catalog }),
    );

    expect((await documentOf(ctx, odeslana.id)).theme.colors['brand.primary']).toBe(FIALOVA);
    expect((await documentOf(ctx, rozepsana.id)).theme.colors['brand.primary']).toBe(ZELENA);
  });

  /**
   * Zamyká se podle ODKAZU Z KAMPANĚ, ne podle `kind`. Ukázková data zakládají
   * odeslanou kampaň bez vlastní kopie obsahu (`campaigns.design` je NULL),
   * takže u ní je knihovní šablona jediný záznam o tom, co se poslalo.
   */
  it('knihovní šablona odeslané kampaně se taky nepřevléká', async () => {
    const { ws, ctx } = await seeded();
    const stara = await setBrand(ctx, ws.workspaceId, profile(FIALOVA));
    const knihovni = await createTemplate(ctx, {
      name: 'Knihovní z odeslané kampaně',
      kind: 'campaign',
      document: design,
    });
    await withWorkspace(ctx.ctx, (tx) =>
      tx.insert(schema.campaigns).values({
        workspaceId: ws.workspaceId,
        name: 'Ukázka odeslaná',
        templateId: knihovni.id,
        status: 'sent',
      }),
    );

    const nova = await setBrand(ctx, ws.workspaceId, profile(ZELENA));
    await withWorkspace(ctx.ctx, (tx) =>
      redressTemplatesToBrand(tx, ctx.ctx, { previous: stara, next: nova, fields: catalog }),
    );

    expect((await documentOf(ctx, knihovni.id)).theme.colors['brand.primary']).toBe(FIALOVA);
  });

  it('druhé spuštění téže značky už nic nemění', async () => {
    const { ws, ctx } = await seeded();
    const stara = await setBrand(ctx, ws.workspaceId, profile(FIALOVA));
    await createTemplate(ctx, { name: 'Idempotence', document: design });

    const nova = await setBrand(ctx, ws.workspaceId, profile(ZELENA));
    const prvni = await withWorkspace(ctx.ctx, (tx) =>
      redressTemplatesToBrand(tx, ctx.ctx, { previous: stara, next: nova, fields: catalog }),
    );
    const druhy = await withWorkspace(ctx.ctx, (tx) =>
      redressTemplatesToBrand(tx, ctx.ctx, { previous: nova, next: nova, fields: catalog }),
    );

    expect(prvni.changed).toBe(1);
    expect(druhy.changed).toBe(0);
  });

  it('cizí projekt zůstane nedotčený', async () => {
    const a = await seeded();
    const b = await seeded();
    const staraA = await setBrand(a.ctx, a.ws.workspaceId, profile(FIALOVA));
    await setBrand(b.ctx, b.ws.workspaceId, profile(FIALOVA));
    const cizi = await createTemplate(b.ctx, { name: 'Cizí projekt', document: design });

    const novaA = await setBrand(a.ctx, a.ws.workspaceId, profile(ZELENA));
    await withWorkspace(a.ctx.ctx, (tx) =>
      redressTemplatesToBrand(tx, a.ctx.ctx, { previous: staraA, next: novaA, fields: catalog }),
    );

    expect((await documentOf(b.ctx, cizi.id)).theme.colors['brand.primary']).toBe(FIALOVA);
  });

  it('přepočítá stav validace, aby knihovna nehlásila v pořádku u nečitelných barev', async () => {
    const { ws, ctx } = await seeded();
    const stara = await setBrand(ctx, ws.workspaceId, profile(FIALOVA));
    const row = await createTemplate(ctx, { name: 'Validace', document: design });
    await withWorkspace(ctx.ctx, (tx) =>
      tx
        .update(schema.templates)
        .set({ validationState: 'unknown', validationErrors: [] })
        .where(eq(schema.templates.id, row.id)),
    );

    const nova = await setBrand(ctx, ws.workspaceId, profile(ZELENA));
    await withWorkspace(ctx.ctx, (tx) =>
      redressTemplatesToBrand(tx, ctx.ctx, { previous: stara, next: nova, fields: catalog }),
    );

    // Stav se po převlečení nesmí nechat na tom, co v řádku stálo předtím.
    expect((await rowOf(ctx, row.id)).validationState).toBe('valid');
  });
});
