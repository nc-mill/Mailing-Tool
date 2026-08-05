import { describe, expect, it } from 'vitest';
import { CONTENT_TYPES, emptyDocument, isKnownType } from './document-types';

describe('document-types', () => {
  it('zná devět obsahových typů bloků', () => {
    expect([...CONTENT_TYPES].sort()).toEqual([
      'button',
      'divider',
      'footer',
      'heading',
      'html',
      'image',
      'social',
      'spacer',
      'text',
    ]);
  });

  it('repeat je známý typ, přestože se v paletě nenabízí', () => {
    expect(isKnownType('repeat')).toBe(true);
    expect(isKnownType('carousel')).toBe(false);
  });

  it('prázdný dokument má schemaVersion 1 a jednu sekci', () => {
    const doc = emptyDocument('cs');
    expect(doc.schemaVersion).toBe(1);
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]!.type).toBe('section');
    expect(doc.meta.language).toBe('cs');
  });

  it('prázdný dokument splňuje tvrdé požadavky schématu, ne jen tvar typu', () => {
    // Prázdný motiv a prázdné props by prošly typem a spadly až ve validaci
    // na serveru. Kořen schématu vyžaduje osm klíčů motivu, sekce vyžaduje
    // props i children a obojí má additionalProperties: false.
    const doc = emptyDocument('cs');
    expect(Object.keys(doc.theme).sort()).toEqual([
      'canvasBackground',
      'colors',
      'contentBackground',
      'contentWidth',
      'darkMode',
      'fonts',
      'radius',
      'typography',
    ]);
    expect(doc.blocks[0]!.id).toMatch(/^b_[0-9a-z]{12}$/);
    expect(doc.blocks[0]!.props).toHaveProperty('padding');
  });

  /**
   * Sekce NENÍ prázdná a nesmí být.
   *
   * Dřívější znění tvrdilo `children).toEqual([])`, jenže takový dokument
   * server odmítl doménovým pravidlem S4:
   *
   *   POST /api/v1/templates → 422 template_document_invalid
   *   findings: [{ code: 'content_missing_unsubscribe' }]
   *
   * Šablonu proto nešlo z rozhraní založit vůbec; uživatel viděl jen
   * „Šablonu se nepodařilo vytvořit." Patička je dítě sekce, ne blok nejvyšší
   * úrovně: nahoře smí být jedině sekce.
   */
  it('prázdný dokument má v sekci patičku, jinak neprojde pravidlem o odhlášení', () => {
    const doc = emptyDocument('cs');
    const children = doc.blocks[0]!.children ?? [];
    expect(children).toHaveLength(1);
    expect(children[0]!.type).toBe('footer');
    expect(children[0]!.id).toMatch(/^b_[0-9a-z]{12}$/);
    expect(children[0]!.props).toHaveProperty('showUnsubscribe');
  });

  it('meta.name není prázdné, schéma má minLength 1', () => {
    expect(emptyDocument('cs').meta.name.length).toBeGreaterThan(0);
    expect(emptyDocument('cs', 'Vítací e-mail').meta.name).toBe('Vítací e-mail');
  });
});
