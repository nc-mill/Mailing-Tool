import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import type { Document } from '@mlain/emails/document/types';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { closePools, pgErrorCode, withWorkspace } from '../tx';
import { seedWorkspaceForCoreTests } from '../identity/test-helpers';
import type { WorkspaceContext } from '../identity/types';
import {
  categoryOf,
  countTemplatesByCategory,
  createTemplateRow,
  EMPTY_TEMPLATE_USAGE,
  findTemplateById,
  listTemplates,
  listTemplateSummaries,
  loadTemplateUsage,
  setValidationState,
  softDeleteTemplate,
  updateTemplateDesign,
  type TemplateCategory,
} from './repository';

let harness: PgHarness;

beforeAll(async () => {
  harness = await startPgHarness();
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

const design = {
  schemaVersion: 1,
  meta: { name: 'T', previewText: '', language: 'cs' },
  theme: {
    contentWidth: 600,
    canvasBackground: 'surface.canvas',
    contentBackground: 'surface.content',
    colors: {},
    fonts: { heading: 'system', body: 'system' },
    typography: { baseFontSize: 16, baseLineHeight: 1.5, headingScale: 1.25 },
    radius: 6,
    darkMode: { strategy: 'auto', colors: {} },
  },
  blocks: [],
} as unknown as Document;

describe('template repository', () => {
  it('creates a row scoped to the workspace', async () => {
    const a = await seedWorkspaceForCoreTests();
    const created = await withWorkspace(a.ctx, (tx) =>
      createTemplateRow(tx, a.ctx, { name: 'První', kind: 'campaign', design, usedFields: [] }),
    );
    expect(created.id).toBeTypeOf('string');
    const found = await withWorkspace(a.ctx, (tx) => findTemplateById(tx, a.ctx, created.id));
    expect(found?.name).toBe('První');
  });

  it('never returns a template from another workspace', async () => {
    const a = await seedWorkspaceForCoreTests();
    const b = await seedWorkspaceForCoreTests();
    const created = await withWorkspace(a.ctx, (tx) =>
      createTemplateRow(tx, a.ctx, { name: 'A', kind: 'campaign', design, usedFields: [] }),
    );
    // Dvě nezávislé vrstvy naráz: RLS neuvidí cizí řádek ani bez podmínky ve WHERE,
    // a podmínka ve WHERE by ho nevrátila ani bez RLS.
    const foreign = await withWorkspace(b.ctx, (tx) => findTemplateById(tx, b.ctx, created.id));
    expect(foreign).toBeUndefined();
    const raw = await withWorkspace(b.ctx, (tx) =>
      tx.select().from(schema.templates).where(eq(schema.templates.id, created.id)),
    );
    expect(raw, 'kdyby tu byl řádek, drží izolaci jen podmínka ve WHERE a RLS nedělá nic').toEqual(
      [],
    );
  });

  it('stores used fields on creation, so impact analysis sees a brand new template', async () => {
    const a = await seedWorkspaceForCoreTests();
    const created = await withWorkspace(a.ctx, (tx) =>
      createTemplateRow(tx, a.ctx, {
        name: 'S poli',
        kind: 'campaign',
        design,
        usedFields: ['contact.attr.city'],
      }),
    );
    expect(created.usedFields).toEqual(['contact.attr.city']);
  });

  it('stores the design hash so an unchanged save is detectable', async () => {
    const a = await seedWorkspaceForCoreTests();
    const created = await withWorkspace(a.ctx, (tx) =>
      createTemplateRow(tx, a.ctx, { name: 'A', kind: 'campaign', design, usedFields: [] }),
    );
    const again = await withWorkspace(a.ctx, (tx) =>
      updateTemplateDesign(tx, a.ctx, created.id, design, []),
    );
    expect(again.changed).toBe(false);
    const changed = await withWorkspace(a.ctx, (tx) =>
      updateTemplateDesign(
        tx,
        a.ctx,
        created.id,
        { ...design, meta: { ...design.meta, name: 'Jiné' } },
        [],
      ),
    );
    expect(changed.changed).toBe(true);
  });

  it('rejects an expected hash that is not thirty two bytes', async () => {
    const a = await seedWorkspaceForCoreTests();
    const created = await withWorkspace(a.ctx, (tx) =>
      createTemplateRow(tx, a.ctx, { name: 'A', kind: 'campaign', design, usedFields: [] }),
    );
    await expect(
      withWorkspace(a.ctx, (tx) =>
        updateTemplateDesign(tx, a.ctx, created.id, design, [], Buffer.alloc(3)),
      ),
    ).rejects.toThrow('precondition_malformed');
  });

  it('hides soft deleted templates from the list', async () => {
    const a = await seedWorkspaceForCoreTests();
    const created = await withWorkspace(a.ctx, (tx) =>
      createTemplateRow(tx, a.ctx, { name: 'A', kind: 'campaign', design, usedFields: [] }),
    );
    await withWorkspace(a.ctx, (tx) => softDeleteTemplate(tx, a.ctx, created.id));
    const list = await withWorkspace(a.ctx, (tx) => listTemplates(tx, a.ctx, { limit: 20 }));
    expect(list.items).toHaveLength(0);
  });

  it('rejects a duplicate name in the same workspace with the sqlstate on the cause', async () => {
    const a = await seedWorkspaceForCoreTests();
    await withWorkspace(a.ctx, (tx) =>
      createTemplateRow(tx, a.ctx, { name: 'A', kind: 'campaign', design, usedFields: [] }),
    );
    // ODCHYLKA OD PLÁNU. Plán chybu chytal UVNITŘ callbacku a vracel ji jako
    // hodnotu. Tím se transakce nechala doběhnout do COMMITu, jenže po 23505
    // je transakce v Postgresu ve stavu „aborted" a COMMIT skončí na 25P02.
    // Test tedy měřil 25P02 místo 23505, tedy chybu obálky, ne kolizi jména.
    // Ověřeno spuštěním: `expected '25P02' to be '23505'`.
    const error = await withWorkspace(a.ctx, async (tx) => {
      await createTemplateRow(tx, a.ctx, {
        name: 'a',
        kind: 'campaign',
        design,
        usedFields: [],
      });
      return null;
    }).catch((caught: unknown) => caught);
    // Tenhle výraz je celý smysl testu: `error.code` je undefined, kód je na cause.
    expect((error as { code?: unknown }).code).toBeUndefined();
    expect(pgErrorCode(error)).toBe('23505');
  });

  it('pages by the pair updated_at and id, so revalidation cannot reshuffle the list', async () => {
    const a = await seedWorkspaceForCoreTests();
    const ids: string[] = [];
    for (const name of ['A', 'B', 'C', 'D']) {
      const row = await withWorkspace(a.ctx, (tx) =>
        createTemplateRow(tx, a.ctx, { name, kind: 'campaign', design, usedFields: [] }),
      );
      ids.push(row.id);
    }
    // Hromadná převalidace posune updated_at u všech řádků na tutéž hodnotu.
    await withWorkspace(a.ctx, async (tx) => {
      for (const id of ids) await setValidationState(tx, a.ctx, id, 'valid', []);
    });
    const first = await withWorkspace(a.ctx, (tx) => listTemplates(tx, a.ctx, { limit: 2 }));
    expect(first.items).toHaveLength(2);
    const second = await withWorkspace(a.ctx, (tx) =>
      listTemplates(tx, a.ctx, { limit: 2, cursor: first.nextCursor! }),
    );
    const seen = [...first.items, ...second.items].map((row) => row.id);
    expect(new Set(seen).size, 'shodné updated_at nesmí řádek zdvojit ani přeskočit').toBe(
      seen.length,
    );
  });

  /**
   * Úsporná podoba seznamu. Dokument `design` je zdaleka největší sloupec
   * tabulky a do výběru šablony není k ničemu, jenže `select()` bez výčtu
   * sloupců ho vytáhne z databáze i tehdy, když ho odpověď zahodí.
   *
   * Test hlídá OBOJÍ: že se sloupec nenačítá, a že se úsporná podoba nerozešla
   * s plnou v tom, co vrací, protože jinak by seznam v jedné podobě ukazoval
   * jiné šablony než v druhé.
   */
  it('úsporný seznam nenačte design a vrací tytéž řádky jako plný', async () => {
    const a = await seedWorkspaceForCoreTests();
    for (const name of ['A', 'B', 'C']) {
      await withWorkspace(a.ctx, (tx) =>
        createTemplateRow(tx, a.ctx, { name, kind: 'campaign', design, usedFields: [] }),
      );
    }

    const full = await withWorkspace(a.ctx, (tx) => listTemplates(tx, a.ctx, { limit: 20 }));
    const lean = await withWorkspace(a.ctx, (tx) =>
      listTemplateSummaries(tx, a.ctx, { limit: 20 }),
    );

    expect(lean.items.map((row) => row.id)).toEqual(full.items.map((row) => row.id));
    for (const row of lean.items) {
      expect(row, 'design se do úsporné podoby nesmí dostat').not.toHaveProperty('design');
    }
    // Kurzor stojí na dvojici (updated_at, id), takže oba sloupce musí ve výběru zůstat.
    expect(lean.items[0]?.updatedAt).toBeInstanceOf(Date);
  });

  it('úsporný seznam ctí filtr i stránkování', async () => {
    const a = await seedWorkspaceForCoreTests();
    for (const name of ['A', 'B', 'C']) {
      await withWorkspace(a.ctx, (tx) =>
        createTemplateRow(tx, a.ctx, { name, kind: 'campaign', design, usedFields: [] }),
      );
    }
    await withWorkspace(a.ctx, (tx) =>
      createTemplateRow(tx, a.ctx, { name: 'D', kind: 'transactional', design, usedFields: [] }),
    );

    const onlyCampaign = await withWorkspace(a.ctx, (tx) =>
      listTemplateSummaries(tx, a.ctx, { limit: 20, kind: 'campaign' }),
    );
    expect(onlyCampaign.items.map((row) => row.name).sort()).toEqual(['A', 'B', 'C']);

    const firstPage = await withWorkspace(a.ctx, (tx) =>
      listTemplateSummaries(tx, a.ctx, { limit: 2 }),
    );
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = await withWorkspace(a.ctx, (tx) =>
      listTemplateSummaries(tx, a.ctx, { limit: 2, cursor: firstPage.nextCursor! }),
    );
    const ids = [...firstPage.items, ...secondPage.items].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/**
 * Kategorie knihovny. Dvě ze tří vycházejí ze sloupce `kind`, třetí z vazby
 * `forms.delivery_template_id`, takže se sem musí dostat i formulář.
 */
describe('kategorie šablon', () => {
  /** Formulář se založí přímo, protože jeho doména sem nepatří a stačí nám vazba. */
  async function seedForm(ctx: WorkspaceContext, name: string, templateId: string) {
    return withWorkspace(ctx, (tx) =>
      tx
        .insert(schema.forms)
        .values({
          workspaceId: ctx.workspaceId,
          name,
          // `ck_forms__slug` chce 16 až 32 znaků z [a-z0-9].
          slug: `test${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.slice(
            0,
            24,
          ),
          deliveryTemplateId: templateId,
        })
        .returning(),
    );
  }

  async function seedThree(ctx: WorkspaceContext) {
    const campaign = await withWorkspace(ctx, (tx) =>
      createTemplateRow(tx, ctx, { name: 'Newsletter', kind: 'campaign', design, usedFields: [] }),
    );
    const formEmail = await withWorkspace(ctx, (tx) =>
      createTemplateRow(tx, ctx, {
        name: 'Z formuláře',
        kind: 'transactional',
        design,
        usedFields: [],
      }),
    );
    const standalone = await withWorkspace(ctx, (tx) =>
      createTemplateRow(tx, ctx, {
        name: 'Potvrzení',
        kind: 'transactional',
        design,
        usedFields: [],
      }),
    );
    // Pracovní obsah kampaně. Do knihovny nepatří, takže ho nesmí vidět ani
    // kategorie, ani počty nad přepínači.
    await withWorkspace(ctx, (tx) =>
      createTemplateRow(tx, ctx, {
        name: 'Kampaň · pracovní',
        kind: 'system',
        design,
        usedFields: [],
      }),
    );
    await seedForm(ctx, 'Patička webu', formEmail.id);
    return { campaign, formEmail, standalone };
  }

  it('rozdělí knihovnu na kampaně, e-maily z formulářů a zbylé transakční', async () => {
    const a = await seedWorkspaceForCoreTests();
    const seeded = await seedThree(a.ctx);

    const byCategory = async (category: TemplateCategory) =>
      (
        await withWorkspace(a.ctx, (tx) =>
          listTemplateSummaries(tx, a.ctx, { limit: 20, category }),
        )
      ).items.map((row) => row.id);

    expect(await byCategory('campaign')).toEqual([seeded.campaign.id]);
    expect(await byCategory('form')).toEqual([seeded.formEmail.id]);
    expect(await byCategory('transactional')).toEqual([seeded.standalone.id]);
  });

  it('počty platí o celé knihovně, ne o stránce, a pracovní obsah kampaně do nich nepatří', async () => {
    const a = await seedWorkspaceForCoreTests();
    await seedThree(a.ctx);

    // Limit 1 schválně: kdyby se počty braly z vrácené stránky, vyšly by jedničky.
    const page = await withWorkspace(a.ctx, (tx) => listTemplateSummaries(tx, a.ctx, { limit: 1 }));
    const counts = await withWorkspace(a.ctx, (tx) => countTemplatesByCategory(tx, a.ctx));

    expect(page.items).toHaveLength(1);
    expect(counts).toEqual({ all: 3, campaign: 1, form: 1, transactional: 1 });
    expect(
      counts.campaign + counts.form + counts.transactional,
      'kategorie jsou výlučné, takže se musí sečíst na celek',
    ).toBe(counts.all);
  });

  it('řekne, který formulář šablonu rozesílá, a u volné šablony mlčí', async () => {
    const a = await seedWorkspaceForCoreTests();
    const seeded = await seedThree(a.ctx);

    const usage = await withWorkspace(a.ctx, (tx) =>
      loadTemplateUsage(tx, a.ctx, [seeded.campaign.id, seeded.formEmail.id]),
    );

    expect(usage.get(seeded.formEmail.id)?.forms.map((form) => form.name)).toEqual([
      'Patička webu',
    ]);
    expect(usage.get(seeded.campaign.id), 'volná šablona nemá zapojení').toBeUndefined();
    expect(categoryOf('transactional', usage.get(seeded.formEmail.id)!)).toBe('form');
    expect(categoryOf('transactional', EMPTY_TEMPLATE_USAGE)).toBe('transactional');
    expect(categoryOf('campaign', EMPTY_TEMPLATE_USAGE)).toBe('campaign');
  });

  it('zachytí i vazbu ze seznamu, tedy potvrzení přihlášení a uvítací e-mail', async () => {
    const a = await seedWorkspaceForCoreTests();
    const confirmation = await withWorkspace(a.ctx, (tx) =>
      createTemplateRow(tx, a.ctx, {
        name: 'Potvrzení',
        kind: 'transactional',
        design,
        usedFields: [],
      }),
    );
    await withWorkspace(a.ctx, (tx) =>
      tx.insert(schema.lists).values({
        workspaceId: a.ctx.workspaceId,
        name: 'Novinky',
        confirmationTemplateId: confirmation.id,
        welcomeTemplateId: confirmation.id,
      }),
    );

    const usage = await withWorkspace(a.ctx, (tx) =>
      loadTemplateUsage(tx, a.ctx, [confirmation.id]),
    );

    // Jeden seznam, dvě různá použití téže šablony. Obě musí být vidět, jinak
    // by uživatel po odpojení potvrzení čekal, že už ji smaže.
    expect(
      usage
        .get(confirmation.id)
        ?.lists.map((list) => list.role)
        .sort(),
    ).toEqual(['confirmation', 'welcome']);
    // Vazba ze seznamu z ní NEDĚLÁ e-mail z formuláře.
    expect(categoryOf('transactional', usage.get(confirmation.id)!)).toBe('transactional');
  });

  it('cizí projekt zapojení nevidí', async () => {
    const a = await seedWorkspaceForCoreTests();
    const b = await seedWorkspaceForCoreTests();
    const seeded = await seedThree(a.ctx);

    const foreign = await withWorkspace(b.ctx, (tx) =>
      loadTemplateUsage(tx, b.ctx, [seeded.formEmail.id]),
    );
    expect(foreign.size).toBe(0);
    const counts = await withWorkspace(b.ctx, (tx) => countTemplatesByCategory(tx, b.ctx));
    expect(counts).toEqual({ all: 0, campaign: 0, form: 0, transactional: 0 });
  });
});
