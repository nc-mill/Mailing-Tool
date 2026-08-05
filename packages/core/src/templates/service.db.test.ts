import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@mlain/db/schema';
import { blockDefaults, DEFAULT_THEME } from '@mlain/emails/document/defaults';
import type { Document } from '@mlain/emails/document/types';
import type { FieldCatalog } from '../contacts/fields/catalog';
import type { WorkspaceContext } from '../identity/types';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { closePools, withWorkspace } from '../tx';
import { seedWorkspaceForCoreTests } from '../identity/test-helpers';
import { findDeletedTemplateById, findTemplateById } from './repository';
import { createVersion } from './versions';
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  renameTemplate,
  restoreTemplate,
  saveDesign,
} from './service';

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

/** Auditní záznamy k jedné šabloně. Každý test má vlastní projekt, takže se nemíchají. */
const auditFor = async (ctx: WorkspaceContext, templateId: string) =>
  withWorkspace(ctx, (tx) =>
    tx
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.workspaceId, ctx.workspaceId),
          eq(schema.auditLog.targetId, templateId),
        ),
      ),
  );

const serviceCtx = async (fields: FieldCatalog = catalog) => {
  const ws = await seedWorkspaceForCoreTests();
  return { ws, ctx: { ctx: ws.ctx, fields, userId: ws.userId } };
};

describe('template service', () => {
  it('creates a template from a document and records the validation state', async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, { name: 'První', kind: 'campaign', document: design });
    expect(row.validationState).toBe('valid');
  });

  it('creates a template from base template parameters', async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, {
      name: 'Z generátoru',
      kind: 'campaign',
      baseTemplate: {
        variant: 'newsletter',
        brand: {
          palette: { primary: '#2563eb' },
          typography: { headingStack: 'Arial', bodyStack: 'Arial', radius: 6 },
        },
        language: 'cs',
        darkMode: true,
        sections: [{ kind: 'hero', headline: 'Vítejte' }],
      },
    });
    expect(JSON.stringify(row.design)).toContain('workspace.sender_address');
  });

  it('stores used fields on the very first write, without a second save', async () => {
    const fields: FieldCatalog = {
      version: 'v2',
      fields: [
        {
          path: 'attr.city',
          type: 'string',
          label: { en: 'City' },
          group: 'custom',
          deleted: false,
        },
      ],
    };
    const { ctx } = await serviceCtx(fields);
    const conditional = {
      ...design,
      blocks: [
        {
          id: 'b_000000000001',
          type: 'section',
          props: blockDefaults('section'),
          children: [
            {
              id: 'b_000000000002',
              type: 'text',
              visibleWhen: { field: 'contact.attr.city', op: 'present' },
              props: blockDefaults('text'),
            },
            footer,
          ],
        },
      ],
    } as unknown as Document;
    const row = await createTemplate(ctx, {
      name: 'Podmíněná',
      kind: 'campaign',
      document: conditional,
    });
    // Tohle je celý smysl testu. Dřív se `usedFields` doplňovalo druhým voláním
    // `updateTemplateDesign` s TÝMŽ dokumentem, takže se porovnal shodný hash,
    // funkce skončila na `changed: false` a sloupec zůstal prázdný napořád.
    expect(row.usedFields).toContain('contact.attr.city');
  });

  it('refuses to save when the design hash does not match', async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, { name: 'A', kind: 'campaign', document: design });
    await expect(saveDesign(ctx, row.id, design, Buffer.alloc(32))).rejects.toThrow(
      'precondition_failed',
    );
  });

  it('duplicates a template with a new name and its own history', async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, { name: 'A', kind: 'campaign', document: design });
    const copy = await duplicateTemplate(ctx, row.id);
    expect(copy.id).not.toBe(row.id);
    expect(copy.name).toBe('A (kopie)');
  });

  it('numbers further copies instead of failing on the unique index', async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, { name: 'A', kind: 'campaign', document: design });
    const first = await duplicateTemplate(ctx, row.id);
    const second = await duplicateTemplate(ctx, row.id);
    const third = await duplicateTemplate(ctx, row.id);
    expect([first.name, second.name, third.name]).toEqual([
      'A (kopie)',
      'A (kopie 2)',
      'A (kopie 3)',
    ]);
  });

  it('shortens a long name so the copy still fits the length check', async () => {
    const { ctx } = await serviceCtx();
    const longName = 'Š'.repeat(118);
    const row = await createTemplate(ctx, { name: longName, kind: 'campaign', document: design });
    const copy = await duplicateTemplate(ctx, row.id);
    // ck_templates__name_len povoluje 1 až 120 znaků. Bez zkrácení by šablona
    // se 118 znaky nešla zkopírovat vůbec a uživatel by dostal 500.
    expect(copy.name.length).toBeLessThanOrEqual(120);
    expect(copy.name.endsWith('(kopie)')).toBe(true);
  });

  it('refuses to delete a starter template', async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, {
      name: 'Dodávaná',
      kind: 'campaign',
      document: design,
      starter: true,
    });
    await expect(deleteTemplate(ctx, row.id)).rejects.toThrow('template_starter_immutable');
  });
});

describe('mazání šablony', () => {
  it('šablona zmizí z knihovny, ale řádek i verze zůstanou', async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, {
      name: 'Ke smazání',
      kind: 'campaign',
      document: design,
    });
    // Verze vzniká až při odeslání nebo ručním uložení bodu, takže se pro tenhle
    // test založí výslovně: jde právě o to, že smazání šablony ji nesmí odnést.
    await withWorkspace(ctx.ctx, (tx) =>
      createVersion(tx, ctx.ctx, row.id, { reason: 'pre_send', pinned: true }),
    );

    await deleteTemplate(ctx, row.id);

    await withWorkspace(ctx.ctx, async (tx) => {
      // Čtení domény šablonu nevidí, ...
      expect(await findTemplateById(tx, ctx.ctx, row.id)).toBeUndefined();
      // ... řádek ale existuje dál a nese `deleted_at`. To je celý rozdíl proti
      // tvrdému mazání: kdyby se řádek mazal, vzal by kaskádou i verze, tedy
      // uložený důkaz, co přesně se rozeslalo.
      const deleted = await findDeletedTemplateById(tx, ctx.ctx, row.id);
      expect(deleted?.deletedAt).toBeInstanceOf(Date);
      const versions = await tx
        .select()
        .from(schema.templateVersions)
        .where(eq(schema.templateVersions.templateId, row.id));
      expect(versions.length).toBeGreaterThan(0);
    });
  });

  it('kampaň založená ze šablony smazání přežije i s odkazem na ni', async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, { name: 'Zdroj', kind: 'campaign', document: design });
    const campaignId = await withWorkspace(ctx.ctx, async (tx) => {
      const [campaign] = await tx
        .insert(schema.campaigns)
        .values({
          workspaceId: ctx.ctx.workspaceId,
          name: 'Z šablony',
          templateId: row.id,
          // Obsah je VLASTNÍ KOPIE kampaně, ne odkaz do šablony. Právě proto
          // smazání šablony kampani nic nebere.
          design: design as unknown as Record<string, unknown>,
        })
        .returning({ id: schema.campaigns.id });
      return campaign!.id;
    });

    await deleteTemplate(ctx, row.id);

    await withWorkspace(ctx.ctx, async (tx) => {
      const [campaign] = await tx
        .select()
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, campaignId));
      expect(campaign).toBeDefined();
      // Odkaz se NEVYNULOVAL: měkké mazání řádek nechává, takže cizí klíč
      // `ON DELETE SET NULL` nemá co spustit a stopa po původu kampaně zůstává.
      expect(campaign?.templateId).toBe(row.id);
      expect(campaign?.design).not.toBeNull();
    });
  });

  it('zapíše do auditu template.deleted i počet kampaní, kterých se to týká', async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, {
      name: 'Auditovaná',
      kind: 'campaign',
      document: design,
    });
    await withWorkspace(ctx.ctx, (tx) =>
      tx.insert(schema.campaigns).values({
        workspaceId: ctx.ctx.workspaceId,
        name: 'Jediná',
        templateId: row.id,
      }),
    );

    await deleteTemplate(ctx, row.id);

    const entries = await auditFor(ctx.ctx, row.id);
    expect(entries.map((entry) => entry.action)).toContain('template.deleted');
    const deleted = entries.find((entry) => entry.action === 'template.deleted');
    expect(deleted?.targetType).toBe('template');
    expect(deleted?.metadata).toMatchObject({ name: 'Auditovaná', campaigns_using: 1 });
  });

  it('testovací odeslání počet kampaní nenafoukne', async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, { name: 'Jen test', kind: 'campaign', document: design });
    await withWorkspace(ctx.ctx, (tx) =>
      tx.insert(schema.campaigns).values({
        workspaceId: ctx.ctx.workspaceId,
        name: 'Schránka na testovací odeslání',
        kind: 'system',
        templateId: row.id,
      }),
    );

    await deleteTemplate(ctx, row.id);

    const entries = await auditFor(ctx.ctx, row.id);
    const deleted = entries.find((entry) => entry.action === 'template.deleted');
    expect(deleted?.metadata).toMatchObject({ campaigns_using: 0 });
  });
});

describe('vrácení smazané šablony', () => {
  it('vrátí šablonu do knihovny a zapíše template.restored', async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, { name: 'Vrácená', kind: 'campaign', document: design });
    await deleteTemplate(ctx, row.id);

    const restored = await restoreTemplate(ctx, row.id);

    expect(restored.deletedAt).toBeNull();
    await withWorkspace(ctx.ctx, async (tx) => {
      expect(await findTemplateById(tx, ctx.ctx, row.id)).toBeDefined();
    });
    const actions = (await auditFor(ctx.ctx, row.id)).map((entry) => entry.action);
    expect(actions).toContain('template.restored');
  });

  it('nevrátí šablonu, když jméno mezitím zabrala jiná', async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, { name: 'Sporná', kind: 'campaign', document: design });
    await deleteTemplate(ctx, row.id);
    // Částečný unikátní index platí jen mezi nesmazanými řádky, takže tohle projde.
    await createTemplate(ctx, { name: 'Sporná', kind: 'campaign', document: design });

    // Přejmenovat cizí šablonu za zády uživatele by bylo horší než odmítnout.
    await expect(restoreTemplate(ctx, row.id)).rejects.toThrow('template_name_conflict');
  });

  it('vrácení nesmazané šablony nic nerozbije a vrátí ji beze změny', async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, { name: 'Živá', kind: 'campaign', document: design });

    // Dvojklik na Vrátit zpět nesmí skončit chybou 404 na šabloně, kterou
    // uživatel vidí před sebou.
    const restored = await restoreTemplate(ctx, row.id);
    expect(restored.id).toBe(row.id);
  });

  it('neznámé id skončí na not_found', async () => {
    const { ctx } = await serviceCtx();
    await expect(restoreTemplate(ctx, '00000000-0000-0000-0000-0000000000ff')).rejects.toThrow(
      'not_found',
    );
  });

  /**
   * Formulář si e-mail bere ze ŽIVÉ šablony při každém odeslání, kdežto kampaň
   * z ní jen jednou opsala obsah. Kdyby se smazání pustilo, formulář by dál
   * sbíral adresy a jeho e-mail by nikam nechodil, aniž by cokoli spadlo.
   */
  it('šablonu, kterou rozesílá formulář, smazat nenechá', async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, {
      name: 'E-mail z formuláře',
      kind: 'transactional',
      document: design,
    });
    await withWorkspace(ctx.ctx, (tx) =>
      tx.insert(schema.forms).values({
        workspaceId: ctx.ctx.workspaceId,
        name: 'Patička webu',
        slug: 'formulartestslug0001',
        deliveryTemplateId: row.id,
      }),
    );

    await expect(deleteTemplate(ctx, row.id)).rejects.toThrow('template_in_use');
    const alive = await withWorkspace(ctx.ctx, (tx) => findTemplateById(tx, ctx.ctx, row.id));
    expect(alive, 'odmítnuté smazání nesmí nic změnit').toBeDefined();

    // Po odpojení se maže jako každá jiná: zákaz je o vazbě, ne o šabloně.
    await withWorkspace(ctx.ctx, (tx) =>
      tx
        .update(schema.forms)
        .set({ deliveryTemplateId: null })
        .where(eq(schema.forms.deliveryTemplateId, row.id)),
    );
    await deleteTemplate(ctx, row.id);
    expect(
      await withWorkspace(ctx.ctx, (tx) => findTemplateById(tx, ctx.ctx, row.id)),
    ).toBeUndefined();
  });

  it('šablonu navázanou na seznam smazat taky nenechá', async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, {
      name: 'Potvrzení přihlášení',
      kind: 'transactional',
      document: design,
    });
    await withWorkspace(ctx.ctx, (tx) =>
      tx.insert(schema.lists).values({
        workspaceId: ctx.ctx.workspaceId,
        name: 'Novinky',
        confirmationTemplateId: row.id,
      }),
    );

    await expect(deleteTemplate(ctx, row.id)).rejects.toThrow('template_in_use');
  });

  it('přejmenování změní jméno řádku I meta.name dokumentu, protože z něj je předmět', async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, {
      name: 'E-mail z formuláře test',
      kind: 'transactional',
      document: design,
    });
    expect((row.design as Document).meta.name).toBe('E-mail z formuláře test');

    const renamed = await renameTemplate(ctx, row.id, 'Děkujeme za zprávu');

    expect(renamed.name).toBe('Děkujeme za zprávu');
    // Tohle je celý smysl: `subjectFor` v test-send.ts i v delivery-email.ts
    // skládá předmět z `meta.name`. Bez téhle věty by uživatel viděl nový
    // název v knihovně a lidem by chodil e-mail se starým předmětem.
    expect((renamed.design as Document).meta.name).toBe('Děkujeme za zprávu');
    // Hash se musí posunout, jinak by editor držel zámek na dokument,
    // který v databázi už není.
    expect(renamed.designHash.equals(row.designHash)).toBe(false);
  });

  it('zapíše do auditu template.renamed se starým i novým jménem', async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, {
      name: 'E-mail z formuláře test',
      kind: 'transactional',
      document: design,
    });

    await renameTemplate(ctx, row.id, 'Děkujeme za zprávu');

    const zaznamy = await auditFor(ctx.ctx, row.id);
    const prejmenovani = zaznamy.filter((z) => z.action === 'template.renamed');
    expect(prejmenovani).toHaveLength(1);
    // Staré jméno je v metadatech schválně: bez něj se z auditu nedá poznat,
    // která šablona se přejmenovala, protože pod původním názvem ji už nikdo
    // nenajde. Přejmenování navíc mění předmět odesílaného e-mailu.
    expect(prejmenovani[0]?.metadata).toMatchObject({
      from: 'E-mail z formuláře test',
      to: 'Děkujeme za zprávu',
    });
  });

  it('odmítnuté ani prázdné přejmenování do auditu nic nezapíše', async () => {
    const { ctx } = await serviceCtx();
    await createTemplate(ctx, { name: 'Zabrané', kind: 'campaign', document: design });
    const row = await createTemplate(ctx, { name: 'Moje', kind: 'campaign', document: design });

    await expect(renameTemplate(ctx, row.id, 'Zabrané')).rejects.toThrow('template_name_conflict');
    // Přejmenování na tutéž hodnotu není změna, takže taky nemá co zapisovat.
    await renameTemplate(ctx, row.id, 'Moje');

    const zaznamy = await auditFor(ctx.ctx, row.id);
    expect(zaznamy.filter((z) => z.action === 'template.renamed')).toHaveLength(0);
  });

  it('ořízne mezery a jméno ze samých mezer odmítne', async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, { name: 'Původní', kind: 'campaign', document: design });

    const trimmed = await renameTemplate(ctx, row.id, '  Uklizený název  ');
    expect(trimmed.name).toBe('Uklizený název');

    // `min(1)` na trase tohle pustí, délka je tři. V knihovně by vznikla
    // šablona s neviditelným jménem.
    await expect(renameTemplate(ctx, row.id, '   ')).rejects.toThrow('template_name_empty');
  });

  it('obsazené jméno skončí konfliktem, ne tichým přejmenováním', async () => {
    const { ctx } = await serviceCtx();
    await createTemplate(ctx, { name: 'Zabrané', kind: 'campaign', document: design });
    const row = await createTemplate(ctx, { name: 'Moje', kind: 'campaign', document: design });

    // Index je na `lower(name)`, takže i jiná velikost písmen je kolize.
    await expect(renameTemplate(ctx, row.id, 'zabrané')).rejects.toThrow('template_name_conflict');
    const unchanged = await withWorkspace(ctx.ctx, (tx) => findTemplateById(tx, ctx.ctx, row.id));
    expect(unchanged?.name).toBe('Moje');
  });

  it('přejmenování na tutéž hodnotu nic nezapisuje, aby šablona nevyskočila na začátek knihovny', async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, {
      name: 'Beze změny',
      kind: 'campaign',
      document: design,
    });

    const again = await renameTemplate(ctx, row.id, 'Beze změny');

    expect(again.updatedAt.getTime()).toBe(row.updatedAt.getTime());
    expect(again.designHash.equals(row.designHash)).toBe(true);
  });

  it('kampaň v mazání nebrání, protože si obsah drží ve vlastní kopii', async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, { name: 'Předloha', kind: 'campaign', document: design });
    await withWorkspace(ctx.ctx, (tx) =>
      tx.insert(schema.campaigns).values({
        workspaceId: ctx.ctx.workspaceId,
        name: 'Z předlohy',
        templateId: row.id,
      }),
    );

    await deleteTemplate(ctx, row.id);
    expect(
      await withWorkspace(ctx.ctx, (tx) => findTemplateById(tx, ctx.ctx, row.id)),
    ).toBeUndefined();
  });
});
