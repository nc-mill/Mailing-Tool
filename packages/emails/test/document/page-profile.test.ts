import { describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME } from '../../src/document/defaults';
import type { FieldCatalog } from '../../src/external/field-catalog';
import { PAGE_ISSUE_CODES, validationProfileFor } from '../../src/document/profile';
import { checkFields } from '../../src/document/semantic-fields';
import { checkStructure } from '../../src/document/semantic-structure';
import type { Document, SectionBlock } from '../../src/document/types';

const ASSET = '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071';

const catalog: FieldCatalog = { version: 'v1', fields: [] };

const section = (children: unknown[]): SectionBlock =>
  ({
    id: 'b_000000000001',
    type: 'section',
    props: blockDefaults('section'),
    children,
  }) as SectionBlock;

const docOf = (children: unknown[]): Document => ({
  schemaVersion: 1,
  meta: { name: 'Děkujeme', previewText: '', language: 'cs' },
  theme: DEFAULT_THEME,
  blocks: [section(children)],
});

const structure = (children: unknown[], kind: 'page' | 'campaign' = 'page') =>
  checkStructure(docOf(children), { templateKind: kind }).map((i) => i.code);

const fields = (children: unknown[], kind: 'page' | 'campaign' = 'page') =>
  checkFields(docOf(children), {
    templateKind: kind,
    fields: catalog,
    assetIds: new Set([ASSET]),
    estimatedHtmlBytes: 1000,
  });

const footer = { id: 'b_000000000002', type: 'footer', props: blockDefaults('footer') };
const html = {
  id: 'b_000000000003',
  type: 'html',
  props: { ...blockDefaults('html'), code: '<b>x</b>' },
};

describe('validační profil page', () => {
  it('mapuje kind page na vlastní profil a ostatní druhy nechává být', () => {
    expect(validationProfileFor('page')).toBe('page');
    expect(validationProfileFor('campaign')).toBe('campaign');
    expect(validationProfileFor('transactional')).toBe('transactional');
    expect(validationProfileFor('system')).toBe('campaign');
  });

  it('zakáže patičku i syrové HTML, každé s vlastním kódem', () => {
    const codes = structure([footer, html]);
    expect(codes).toContain(PAGE_ISSUE_CODES.footerForbidden);
    expect(codes).toContain(PAGE_ISSUE_CODES.htmlForbidden);
    // Dva různé kódy, ne jeden společný: uživatel potřebuje vědět, který blok
    // odstranit a proč, a jsou to dva různé důvody.
    expect(PAGE_ISSUE_CODES.footerForbidden).not.toBe(PAGE_ISSUE_CODES.htmlForbidden);
  });

  it('ukáže na konkrétní blok, ne na kořen dokumentu', () => {
    const issues = checkStructure(docOf([footer, html]), { templateKind: 'page' });
    expect(issues.find((i) => i.code === PAGE_ISSUE_CODES.footerForbidden)?.pointer).toBe(
      '/blocks/0/children/0',
    );
    expect(issues.find((i) => i.code === PAGE_ISSUE_CODES.htmlForbidden)?.pointer).toBe(
      '/blocks/0/children/1',
    );
  });

  it('nechává kampaň beze změny, zákaz platí jen pro stránku', () => {
    const codes = structure([footer, html], 'campaign');
    expect(codes).not.toContain(PAGE_ISSUE_CODES.footerForbidden);
    expect(codes).not.toContain(PAGE_ISSUE_CODES.htmlForbidden);
  });

  it('povolí nadpis, text, tlačítko, obrázek, oddělovač, mezeru, sekci, sloupce a sociální sítě', () => {
    const columns = {
      id: 'b_000000000010',
      type: 'columns',
      props: blockDefaults('columns'),
      children: [
        {
          id: 'b_000000000011',
          type: 'column',
          props: blockDefaults('column'),
          children: [
            {
              id: 'b_000000000012',
              type: 'heading',
              props: {
                ...blockDefaults('heading'),
                content: [{ t: 'p', children: [{ t: 's', v: 'Hotovo' }] }],
              },
            },
            {
              id: 'b_000000000013',
              type: 'text',
              props: {
                ...blockDefaults('text'),
                content: [{ t: 'p', children: [{ t: 's', v: 'Přihlášení je potvrzené.' }] }],
              },
            },
          ],
        },
        {
          id: 'b_000000000014',
          type: 'column',
          props: blockDefaults('column'),
          children: [
            {
              id: 'b_000000000015',
              type: 'image',
              props: { ...blockDefaults('image'), assetId: ASSET, alt: 'Logo' },
            },
          ],
        },
      ],
    };
    const children = [
      columns,
      {
        id: 'b_000000000016',
        type: 'button',
        props: { ...blockDefaults('button'), href: 'https://example.test/dal' },
      },
      { id: 'b_000000000017', type: 'divider', props: blockDefaults('divider') },
      { id: 'b_000000000018', type: 'spacer', props: blockDefaults('spacer') },
      {
        id: 'b_000000000019',
        type: 'social',
        props: {
          ...blockDefaults('social'),
          items: [{ network: 'facebook', href: 'https://facebook.test/demo' }],
        },
      },
    ];

    expect(structure(children)).toEqual([]);
    expect(fields(children).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('nevyžaduje odhlašovací odkaz, ani jako varování', () => {
    // Kampaň bez odhlášení je chyba, protože jde o obchodní sdělení. Na stránku
    // po odhlášení se chodí PRÁVĚ z toho odkazu, takže ho nemá kde mít.
    expect(fields([], 'campaign').map((i) => i.code)).toContain('content_missing_unsubscribe');
    expect(fields([]).map((i) => i.code)).not.toContain('content_missing_unsubscribe');
  });

  it('nehlásí proměnnou v odkazu jako nesledovatelnou, stránka odkazy nesleduje', () => {
    const button = {
      id: 'b_000000000020',
      type: 'button',
      props: { ...blockDefaults('button'), href: '{{ data.confirm_url }}' },
    };
    const codes = structure([button]);
    expect(codes).not.toContain('liquid_in_trackable_href');
    expect(codes).not.toContain('link_variable_not_tracked');
  });
});
