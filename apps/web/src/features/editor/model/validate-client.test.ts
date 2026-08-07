import { blockDefaults, DEFAULT_THEME } from '@mlain/emails/document/defaults';
import { PAGE_ISSUE_CODES } from '@mlain/emails/document/profile';
import { describe, expect, it } from 'vitest';
import type { EditorDocument } from './document-types';
import type { PageSurface } from './page-surface';
import { blockIdAtPointer, validateDocumentClient } from './validate-client';

const doc = {
  schemaVersion: 1,
  meta: { name: 'T', previewText: '', language: 'cs' },
  theme: {},
  blocks: [
    {
      id: 'b_s1',
      type: 'section',
      props: {},
      children: [
        { id: 'b_h1', type: 'heading', props: { content: [] } },
        {
          id: 'b_c1',
          type: 'columns',
          props: {},
          children: [
            {
              id: 'b_col1',
              type: 'column',
              props: {},
              children: [{ id: 'b_img1', type: 'image', props: { alt: '' } }],
            },
          ],
        },
      ],
    },
  ],
} as unknown as EditorDocument;

describe('blockIdAtPointer', () => {
  it.each([
    ['/blocks/0', 'b_s1'],
    ['/blocks/0/props/padding', 'b_s1'],
    ['/blocks/0/children/0/props/content', 'b_h1'],
    ['/blocks/0/children/1/children/0/children/0/props/alt', 'b_img1'],
    ['/blocks/0/children/1/children/0', 'b_col1'],
  ])('z %s najde blok %s', (pointer, expected) => {
    expect(blockIdAtPointer(doc, pointer)).toBe(expected);
  });

  it.each([['/theme/colors'], ['/meta/name'], [''], ['/blocks/9/props/x']])(
    'u %s nevrátí nic, místo aby uhádl blok',
    (pointer) => {
      // Nález na motivu nebo na hlavičce k žádnému bloku nepatří. Kdyby se
      // vrátil nejbližší blok, proklik by uživatele poslal někam, kde nic není.
      expect(blockIdAtPointer(doc, pointer)).toBeUndefined();
    },
  );
});

/**
 * NEDOSTUPNÁ PERSONALIZACE JE CHYBA, ne prázdný výstup (plán, oddíl 4.3).
 *
 * Render jede se `strictVariables: false`, takže by z chybějící hodnoty tiše
 * udělal prázdný řetězec a návštěvník by dostal „Děkujeme, " s dírou za čárkou.
 * Přesně tahle třída vady se v produktu projevila dvakrát (prázdná adresa
 * odesílatele v patičce, potvrzovací e-mail bez adresy), proto se odmítá
 * uložení, místo aby se to vykreslilo naprázdno.
 */
describe('kontrola personalizace podle povrchu stránky', () => {
  const pageDoc = (expr: string): EditorDocument =>
    ({
      schemaVersion: 1,
      meta: { name: 'Děkujeme', previewText: '', language: 'cs' },
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
                content: [{ t: 'p', children: [{ t: 'var', expr }] }],
              },
            },
          ],
        },
      ],
    }) as unknown as EditorDocument;

  const codesFor = (
    expr: string,
    options: { templateKind: 'page' | 'campaign'; pageSurface?: PageSurface },
  ): string[] =>
    validateDocumentClient(
      pageDoc(expr),
      { version: 'v1', fields: [] },
      { assetIds: new Set<string>(), ...options },
    )
      .filter((issue) => issue.severity === 'error')
      .map((issue) => issue.code);

  it('na děkovací stránce hlásí kontakt jako chybu, ne jako prázdno', () => {
    expect(
      codesFor('contact.first_name', { templateKind: 'page', pageSurface: 'form_thanks' }),
    ).toContain(PAGE_ISSUE_CODES.variableNotOnSurface);
  });

  it('na stránce po potvrzení tentýž údaj projde', () => {
    expect(
      codesFor('contact.first_name', { templateKind: 'page', pageSurface: 'confirmed' }),
    ).not.toContain(PAGE_ISSUE_CODES.variableNotOnSurface);
  });

  it('nález ukazuje na blok, aby se na něj dalo skočit', () => {
    const issues = validateDocumentClient(
      pageDoc('contact.first_name'),
      { version: 'v1', fields: [] },
      { assetIds: new Set<string>(), templateKind: 'page', pageSurface: 'form_thanks' },
    );
    const found = issues.find((issue) => issue.code === PAGE_ISSUE_CODES.variableNotOnSurface);
    expect(found?.blockId).toBe('b_000000000002');
    // Parametr `path` nese hlášku pro uživatele: bez něj by věta jen řekla,
    // že „něco" chybí, a hledal by to po celém dokumentu.
    expect(found?.params?.path).toBe('contact.first_name');
  });

  it('bez povrchu se stránka posoudí nejúžeji, tedy jako děkovací', () => {
    expect(codesFor('contact.first_name', { templateKind: 'page' })).toContain(
      PAGE_ISSUE_CODES.variableNotOnSurface,
    );
  });

  it('e-mailu se kontrola povrchu netýká vůbec', () => {
    // Kampaň žádný povrch nemá a kontakt je v ní běžný stav. Kdyby se pravidlo
    // pustilo i na ni, přestaly by jít uložit všechny existující šablony.
    expect(codesFor('contact.first_name', { templateKind: 'campaign' })).not.toContain(
      PAGE_ISSUE_CODES.variableNotOnSurface,
    );
  });
});
