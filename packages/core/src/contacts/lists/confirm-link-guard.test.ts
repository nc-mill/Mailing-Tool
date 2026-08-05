import { describe, expect, it } from 'vitest';
import { blockDefaults, DEFAULT_THEME } from '@mlain/emails/document/defaults';
import type { Document } from '@mlain/emails/document/types';
import type { FieldCatalog } from '../fields/catalog';
import { documentHasConfirmLink, documentUsesUnsubscribeUrl } from './confirm-link-guard';
import { CONFIRM_URL_EXPRESSION, defaultSubscriptionEmail } from './default-emails';

const fields: FieldCatalog = { version: 'v1', fields: [] };

function documentWith(children: unknown[]): Document {
  return {
    schemaVersion: 1,
    meta: { name: 'Potvrzení', previewText: '', language: 'cs' },
    theme: DEFAULT_THEME,
    blocks: [
      {
        id: 'b_000000000001',
        type: 'section',
        props: blockDefaults('section'),
        children,
      },
    ],
  } as unknown as Document;
}

const paragraph = (children: unknown[]) => ({
  id: 'b_000000000002',
  type: 'text',
  props: { ...blockDefaults('text'), content: [{ t: 'p', children }] },
});

describe('závora na potvrzovací odkaz', () => {
  it('vestavěné znění potvrzení projde', () => {
    expect(documentHasConfirmLink(defaultSubscriptionEmail('confirmation', 'cs'), fields)).toBe(
      true,
    );
    expect(documentHasConfirmLink(defaultSubscriptionEmail('confirmation', 'en'), fields)).toBe(
      true,
    );
  });

  it('vestavěné uvítání neprojde, protože potvrzovat nemá co', () => {
    expect(documentHasConfirmLink(defaultSubscriptionEmail('welcome', 'cs'), fields)).toBe(false);
  });

  it('odkaz v tlačítku stačí', () => {
    const document = documentWith([
      {
        id: 'b_000000000003',
        type: 'button',
        props: {
          ...blockDefaults('button'),
          label: [{ t: 'p', children: [{ t: 's', v: 'Potvrdit' }] }],
          href: CONFIRM_URL_EXPRESSION,
        },
      },
    ]);
    expect(documentHasConfirmLink(document, fields)).toBe(true);
  });

  it('odkaz v textu stačí taky', () => {
    // Odkaz uvnitř odstavce je druhá legitimní podoba potvrzení. Kdyby sběrač
    // cest četl jen tlačítka, závora by ho odmítla a uživatel by nechápal proč.
    const document = documentWith([
      paragraph([
        { t: 'a', href: CONFIRM_URL_EXPRESSION, children: [{ t: 's', v: 'Potvrdit přihlášení' }] },
      ]),
    ]);
    expect(documentHasConfirmLink(document, fields)).toBe(true);
  });

  it('vypsaná adresa jako proměnná v textu stačí', () => {
    // Poštovní klient, který nevykreslí tlačítko, je běžný. Vypsaná adresa je
    // proto plnohodnotná cesta k potvrzení, ne náhražka.
    const document = documentWith([paragraph([{ t: 'var', expr: 'data.confirm_url' }])]);
    expect(documentHasConfirmLink(document, fields)).toBe(true);
  });

  it('dokument s odkazem někam jinam neprojde', () => {
    const document = documentWith([
      {
        id: 'b_000000000003',
        type: 'button',
        props: {
          ...blockDefaults('button'),
          label: [{ t: 'p', children: [{ t: 's', v: 'Na web' }] }],
          href: 'https://example.cz',
        },
      },
    ]);
    expect(documentHasConfirmLink(document, fields)).toBe(false);
  });
});

/**
 * ZÁVORA: odhlašovací odkaz v e-mailu seznamu.
 *
 * Sender u `messages.kind = 'transactional'` odhlašovací odkaz nevyrábí
 * a v render datech ho bezpodmínečně přepíše prázdným řetězcem, takže by
 * `{{ unsubscribe_url }}` skončil jako prázdný `href`.
 */
describe('odhlašovací odkaz v e-mailu seznamu', () => {
  it('vestavěná znění ho nemají ani jedno', () => {
    for (const kind of ['confirmation', 'welcome', 'goodbye'] as const) {
      expect(documentUsesUnsubscribeUrl(defaultSubscriptionEmail(kind, 'cs'), fields)).toBe(false);
    }
  });

  it('zapnuté odhlášení v patičce se pozná', () => {
    const document = documentWith([
      {
        id: 'b_000000000004',
        type: 'footer',
        props: { ...blockDefaults('footer'), showUnsubscribe: true },
      },
    ]);
    expect(documentUsesUnsubscribeUrl(document, fields)).toBe(true);
  });

  it('vypnuté odhlášení v patičce projde', () => {
    const document = documentWith([
      {
        id: 'b_000000000004',
        type: 'footer',
        props: { ...blockDefaults('footer'), showUnsubscribe: false },
      },
    ]);
    expect(documentUsesUnsubscribeUrl(document, fields)).toBe(false);
  });

  it('ruční odkaz v textu se pozná taky', () => {
    // Druhá podoba téže věci. Kdyby se hlídala jen patička, autor by odkaz
    // napsal do textu a závora by mlčela.
    const document = documentWith([
      paragraph([
        { t: 'a', href: '{{ unsubscribe_url }}', children: [{ t: 's', v: 'Odhlásit se' }] },
      ]),
    ]);
    expect(documentUsesUnsubscribeUrl(document, fields)).toBe(true);
  });
});
