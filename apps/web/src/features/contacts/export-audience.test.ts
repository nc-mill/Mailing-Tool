import { describe, expect, it } from 'vitest';
/*
 * Schémata se berou RELATIVNĚ, ne přes `@mlain/core/...`.
 *
 * Balíček vystavuje jen barrely (`./*` míří na `index.ts`) a `@mlain/core/segments`
 * by stáhl i `repo.ts` a `service.ts`, tedy databázi a konfiguraci. Test potřebuje
 * tři čisté soubory se zodem a nic víc.
 */
import { SegmentAstV1 } from '../../../../../packages/core/src/segments/ast';
import {
  assertOperatorAllowed,
  contactFieldClass,
} from '../../../../../packages/core/src/segments/operators';
import { CreateExportRequest } from '../../../../../packages/core/src/contacts/export/api/schemas';
import {
  EXPORT_COLUMNS,
  emailsToAudience,
  filtersToAudience,
  tagToAudience,
  type ExportAudience,
} from './export-audience';

/**
 * Testy míří na SKUTEČNÁ SCHÉMATA JÁDRA, ne na podvržený server.
 *
 * Přesně tahle třída vad tudy prošla: `exportContactsAction` posílala tvar, který
 * `CreateExportRequest` odmítá, a protože testy mockovaly `apiMutate`, vracely
 * úspěch. Vada se projevila až v prohlížeči jako 422 u každého exportu.
 */

function requestBody(audience: ExportAudience) {
  return {
    kind: 'contacts',
    filter: audience,
    columns: [...EXPORT_COLUMNS],
    format: 'csv',
    locale: 'cs',
  };
}

/** Každá podmínka musí mít operátor, který matice pole a operátorů dovoluje. */
function assertOperatorsValid(audience: ExportAudience) {
  for (const node of audience.ast?.root.children ?? []) {
    if (node.field.kind === 'contact') {
      const key = node.field.key as Parameters<typeof contactFieldClass>[0];
      assertOperatorAllowed(contactFieldClass(key), node.operator as never);
    }
    if (node.field.kind === 'tag') assertOperatorAllowed('tag', node.operator as never);
  }
}

describe('publikum exportu kontaktů', () => {
  it('tělo požadavku projde schématem CreateExportRequest', () => {
    const outcome = filtersToAudience({ status: 'active' });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(() => CreateExportRequest.parse(requestBody(outcome.audience))).not.toThrow();
  });

  it('bez sloupců by schéma tělo odmítlo, proto se posílají vždy', () => {
    const outcome = filtersToAudience({});
    if (!outcome.ok) throw new Error('nefiltrovaný seznam musí publikum vyrobit');
    const { columns, ...withoutColumns } = requestBody(outcome.audience);
    expect(columns.length).toBeGreaterThan(0);
    expect(() => CreateExportRequest.parse(withoutColumns)).toThrow();
  });

  it('starý tvar `{ ids }` schéma odmítá, kvůli tomu export nikdy nefungoval', () => {
    expect(() =>
      CreateExportRequest.parse({ ids: ['c-1'], format: 'csv', columns: [...EXPORT_COLUMNS] }),
    ).toThrow();
  });

  it('výběr kontaktů se překládá na výčet e-mailů a AST je platný', () => {
    const outcome = emailsToAudience(['a@b.cz', 'c@d.cz']);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(() => SegmentAstV1.parse(outcome.audience.ast)).not.toThrow();
    assertOperatorsValid(outcome.audience);
    expect(outcome.audience.ast?.root.children[0]?.values).toEqual(['a@b.cz', 'c@d.cz']);
  });

  it('nad tisíc adres se výběr neposílá, schéma má strop', () => {
    const many = Array.from({ length: 1001 }, (_, index) => `a${index}@b.cz`);
    expect(emailsToAudience(many)).toEqual({ ok: false, reason: 'too_many' });
  });

  it('štítek se překládá na podmínku publika, ne na tag_id', () => {
    const audience = tagToAudience('t-1');
    expect(() => SegmentAstV1.parse(audience.ast)).not.toThrow();
    assertOperatorsValid(audience);
    expect(JSON.stringify(audience)).not.toContain('tag_id');
  });

  it('seznam a segment jdou do listIds a segmentIds, ne do podmínek', () => {
    const outcome = filtersToAudience({ list_id: 'l-1', segment_id: 's-1' });
    if (!outcome.ok) throw new Error('filtr měl projít');
    expect(outcome.audience.listIds).toEqual(['l-1']);
    expect(outcome.audience.segmentIds).toEqual(['s-1']);
    expect(outcome.audience.ast).toBeUndefined();
  });

  it('stav, štítek, oslovení i data se skládají do jednoho platného AST', () => {
    const outcome = filtersToAudience({
      status: 'unconfirmed',
      tag_id: 't-1',
      vocative_confidence: 'low',
      created_after: '2026-01-01',
      created_before: '2026-12-31',
    });
    if (!outcome.ok) throw new Error('filtr měl projít');
    expect(() => SegmentAstV1.parse(outcome.audience.ast)).not.toThrow();
    assertOperatorsValid(outcome.audience);
    expect(outcome.audience.ast?.root.children).toHaveLength(5);
  });

  /**
   * Kdyby se `q` mlčky zahodilo, uživatel by si vyexportoval kontakty, které
   * na obrazovce nevidí. To je horší než odmítnout: server normalizuje diakritiku
   * jinak, než umí podmínka `contains` nad surovým sloupcem.
   */
  it('hledaný výraz se nepřekládá a řekne se to', () => {
    expect(filtersToAudience({ q: 'novak' })).toEqual({ ok: false, reason: 'search' });
    expect(filtersToAudience({ q: '  ', status: 'active' }).ok).toBe(true);
  });

  it('nefiltrovaný seznam vyrobí publikum „všichni", prázdné jádro odmítá', () => {
    const outcome = filtersToAudience({});
    if (!outcome.ok) throw new Error('nefiltrovaný seznam musí publikum vyrobit');
    expect(() => SegmentAstV1.parse(outcome.audience.ast)).not.toThrow();
    assertOperatorsValid(outcome.audience);
    expect(outcome.audience.ast?.root.children[0]?.operator).toBe('is_not_empty');
  });
});
