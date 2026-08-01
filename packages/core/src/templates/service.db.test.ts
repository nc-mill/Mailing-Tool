import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME } from '@mlain/emails/document/defaults';
import type { Document } from '@mlain/emails/document/types';
import type { FieldCatalog } from '../contacts/fields/catalog';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { closePools } from '../tx';
import { seedWorkspaceForCoreTests } from '../identity/test-helpers';
import { createTemplate, deleteTemplate, duplicateTemplate, saveDesign } from './service';

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
