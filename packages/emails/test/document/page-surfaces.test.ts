import { describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME } from '../../src/document/defaults';
import {
  checkSurfaceVariables,
  PAGE_SURFACES,
  variablesForSurface,
  type PageSurface,
} from '../../src/document/page-surfaces';
import { PAGE_ISSUE_CODES } from '../../src/document/profile';
import type { Document, SectionBlock } from '../../src/document/types';

const SURFACES: readonly PageSurface[] = [
  'form_thanks',
  'confirmed',
  'already_subscribed',
  'unsubscribed',
];

/** Dokument s jedním textem, ve kterém je jeden výraz. */
const withVar = (expr: string): Document => ({
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
            content: [
              {
                t: 'p',
                children: [
                  { t: 's', v: 'Ahoj ' },
                  { t: 'var', expr },
                ],
              },
            ],
          },
        },
      ],
    } as unknown as SectionBlock,
  ],
});

const codes = (expr: string, surface: PageSurface) =>
  checkSurfaceVariables(withVar(expr), surface).map((i) => i.code);

describe('katalog proměnných podle povrchu', () => {
  it('nabízí na každém ze čtyř povrchů neprázdný seznam', () => {
    for (const surface of SURFACES) {
      expect(variablesForSurface(surface).length).toBeGreaterThan(0);
    }
  });

  it('na děkovací stránce nenabízí žádnou proměnnou kontaktu', () => {
    const offered = variablesForSurface('form_thanks');
    expect(offered.some((name) => name.startsWith('contact.'))).toBe(false);
    // Odesílatel, formulář a seznam tam naopak být musí, jinak by stránka
    // neuměla napsat ani to, do čeho se člověk právě přihlásil.
    expect(offered).toContain('workspace.sender_address');
    expect(offered).toContain('data.form_name');
    expect(offered).toContain('data.list_name');
  });

  /**
   * Běhový seznam povrchů. Existuje kvůli hodnotě z ADRESY (`?surface=…`), což je
   * cizí řetězec: `as PageSurface` by ověření jen předstíralo. Odvozuje se z klíčů
   * katalogu, takže nemůže vzniknout povrch, který je v seznamu a v katalogu ne.
   */
  it('běhový seznam povrchů sedí na katalog, ani o jeden navíc', () => {
    expect([...PAGE_SURFACES].sort()).toEqual(
      ['already_subscribed', 'confirmed', 'form_thanks', 'unsubscribed'].sort(),
    );
    for (const surface of PAGE_SURFACES) {
      expect(variablesForSurface(surface).length).toBeGreaterThan(0);
    }
  });

  it('na povrchech s tokenem kontakt nabízí, protože ho z tokenu zná', () => {
    for (const surface of ['confirmed', 'unsubscribed'] as const) {
      expect(variablesForSurface(surface)).toContain('contact.first_name');
      expect(variablesForSurface(surface)).toContain('contact.email');
    }
  });

  /**
   * `already_subscribed` NENÍ stránka z e-mailu, i když tak zní. Bydlí na téže
   * trase jako děkovací stránka, tedy na cíli přesměrování 303 BEZ TOKENU.
   * Do 7. 8. 2026 měla v katalogu kontakt, protože plán ji omylem zařadil mezi
   * stránky otevírané z odkazu; `{{ contact.greeting }}` by tam prošlo validací
   * a u návštěvníka se vykreslilo jako prázdno.
   */
  it('u „už jste přihlášeni" kontakt NENÍ, je to táž trasa jako děkovací stránka', () => {
    const vars = variablesForSurface('already_subscribed');
    expect(vars).not.toContain('contact.first_name');
    expect(vars).not.toContain('contact.email');
    // Název formuláře naopak MÁ, protože formulář zná z adresy.
    expect(vars).toContain('data.form_name');
    expect(codes('contact.first_name', 'already_subscribed')).toEqual([
      PAGE_ISSUE_CODES.variableNotOnSurface,
    ]);
  });

  it('kontakt na děkovací stránce je CHYBA validace, ne prázdný výstup', () => {
    const issues = checkSurfaceVariables(withVar('contact.first_name'), 'form_thanks');
    expect(issues.map((i) => i.code)).toEqual([PAGE_ISSUE_CODES.variableNotOnSurface]);
    expect(issues[0]!.severity).toBe('error');
    // Hláška musí říct KTERÁ proměnná a NA ČEM, jinak ji autor v dlouhé
    // stránce nenajde.
    expect(issues[0]!.params).toEqual({ path: 'contact.first_name', surface: 'form_thanks' });
    expect(issues[0]!.pointer).toBe('/blocks/0/children/0/props/content/0/children/1/expr');
  });

  it('tatáž proměnná na stránce po potvrzení projde', () => {
    expect(codes('contact.first_name', 'confirmed')).toEqual([]);
    expect(codes('contact.first_name', 'unsubscribed')).toEqual([]);
  });

  it('vlastní atribut kontaktu projde tam, kde kontakt je, katalog ho nemusí vyjmenovat', () => {
    expect(codes('contact.attr.mesto', 'confirmed')).toEqual([]);
    expect(codes('contact.attr.mesto', 'form_thanks')).toEqual([
      PAGE_ISSUE_CODES.variableNotOnSurface,
    ]);
  });

  it('nedá se obejít filtrem ani náhradní hodnotou', () => {
    expect(codes('contact.first_name | default: "kamaráde"', 'form_thanks')).toEqual([
      PAGE_ISSUE_CODES.variableNotOnSurface,
    ]);
  });

  it('název formuláře je jen na děkovací stránce, název seznamu všude', () => {
    expect(codes('data.form_name', 'form_thanks')).toEqual([]);
    expect(codes('data.form_name', 'confirmed')).toEqual([PAGE_ISSUE_CODES.variableNotOnSurface]);
    for (const surface of SURFACES) expect(codes('data.list_name', surface)).toEqual([]);
  });

  it('odmítne klíč, který do data nikdo nedá, i když je kořen povolený', () => {
    expect(codes('data.confirm_url', 'confirmed')).toEqual([PAGE_ISSUE_CODES.variableNotOnSurface]);
  });

  it('odmítne kořeny, které na stránce nemají co dělat', () => {
    for (const expr of ['campaign.name', 'unsubscribe_url', 'webview_url']) {
      expect(codes(expr, 'confirmed')).toEqual([PAGE_ISSUE_CODES.variableNotOnSurface]);
    }
  });

  it('hlídá i podmínku zobrazení, tichý blok je stejná vada jako prázdný text', () => {
    const doc = withVar('workspace.name');
    (doc.blocks[0]!.children[0] as { visibleWhen?: unknown }).visibleWhen = {
      field: 'contact.attr.mesto',
      op: 'present',
    };
    const issues = checkSurfaceVariables(doc, 'form_thanks');
    expect(issues.map((i) => i.code)).toEqual([PAGE_ISSUE_CODES.variableNotOnSurface]);
    expect(issues[0]!.pointer).toBe('/blocks/0/children/0/visibleWhen/field');
  });

  it('hlídá i proměnnou v odkazu tlačítka, ne jen v textu', () => {
    const doc = withVar('workspace.name');
    doc.blocks[0]!.children.push({
      id: 'b_000000000003',
      type: 'button',
      props: { ...blockDefaults('button'), href: 'https://example.test/{{ contact.email }}' },
    } as never);
    expect(checkSurfaceVariables(doc, 'form_thanks').map((i) => i.code)).toEqual([
      PAGE_ISSUE_CODES.variableNotOnSurface,
    ]);
  });
});
