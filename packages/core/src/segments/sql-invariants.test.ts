import { describe, expect, it } from 'vitest';
import { compileSegmentSql } from './compile/index';
import { segmentErrorCode } from './errors';
import {
  astFor,
  COMBOS,
  FREE_TEXT_CLASSES,
  INVARIANT_OPTS,
  UUID_A,
  UUID_B,
  valueFor,
} from './test-support/combos';

/**
 * Tenhle soubor netestuje chování, testuje TEXT dotazu. Je to schválně: chování
 * by se muselo trefit do závodu nebo do konkrétního plánu, kdežto text je
 * deterministický.
 *
 * Že ten text databáze taky PŘIJME, ověřuje `segments.db.test.ts` spuštěním
 * každé z těch kombinací proti PostgreSQL. Grep nad textem sám o sobě je přesně
 * to, kvůli čemu v tomhle projektu vznikl scénář OB-00: SQL, které projde
 * grepem a ne parserem, vypadá jako zelený test. Obě sady proto berou kombinace
 * ze STEJNÉHO zdroje, `test-support/combos.ts`, který je odvozuje z matice
 * v `operators.ts`.
 */
const BANNED = /now\s*\(|current_timestamp|localtimestamp|current_date/i;

describe('sql text invariants', () => {
  it('covers at least 60 field and operator combinations', () => {
    expect(COMBOS.length).toBeGreaterThanOrEqual(60);
  });

  it.each(COMBOS)('%s + %s emits no wall clock function', (cls, operator) => {
    const { sql } = compileSegmentSql(astFor(cls, operator), INVARIANT_OPTS);
    expect(sql).not.toMatch(BANNED);
  });

  it.each(COMBOS)('%s + %s puts every user value into a parameter', (cls, operator) => {
    const marker = "zzz'; DROP TABLE contacts; --";
    const v = valueFor(cls, operator);
    // Marker se podstrkuje jen tam, kde je volný text legitimní hodnota.
    // U číselného a datového pole ho odmítne `assertValueMatchesClass` dřív,
    // než se ke kompilaci dostane, což je jiná, taky žádoucí obrana.
    const patched =
      FREE_TEXT_CLASSES.has(cls) && 'value' in v && typeof v.value === 'string'
        ? { value: marker }
        : v;
    const { sql, params } = compileSegmentSql(astFor(cls, operator, patched), INVARIANT_OPTS);
    expect(sql).not.toContain('DROP TABLE');
    if ('value' in patched && patched.value === marker) expect(params).toContain(marker);
  });

  it('refuses a text value on a number field instead of emitting a doomed ::numeric cast', () => {
    // Regrese proti 22P02, které se jinak projeví až v databázi za běhu.
    let caught: unknown;
    try {
      compileSegmentSql(astFor('number', 'eq', { value: 'value' }), INVARIANT_OPTS);
    } catch (error) {
      caught = error;
    }
    expect(segmentErrorCode(caught)).toBe('segment_invalid_ast');
  });

  it('refuses a nonsense date value on a datetime field', () => {
    let caught: unknown;
    try {
      compileSegmentSql(astFor('datetime', 'before', { value: 'nikdy' }), INVARIANT_OPTS);
    } catch (error) {
      caught = error;
    }
    expect(segmentErrorCode(caught)).toBe('segment_invalid_ast');
  });

  it.each(COMBOS)('%s + %s never inlines a list value into the text', (cls, operator) => {
    const { sql } = compileSegmentSql(astFor(cls, operator), INVARIANT_OPTS);
    expect(sql).not.toContain(UUID_A);
    expect(sql).not.toContain(UUID_B);
  });

  it.each(COMBOS)('%s + %s refers to asOf only as $2 with an explicit cast', (cls, operator) => {
    // Holé $2 bez castu je ta chyba, která spadne až za běhu a jen u některých
    // operátorů, takže se hlídá plošně nad celou maticí.
    const { sql } = compileSegmentSql(astFor(cls, operator), INVARIANT_OPTS);
    expect(sql).not.toMatch(/\$2(?!::timestamptz)/);
  });

  it('keeps every numeric cast inside CASE WHEN', () => {
    for (const operator of ['gt', 'gte', 'lt', 'lte', 'between'] as const) {
      const { sql } = compileSegmentSql(astFor('number', operator), INVARIANT_OPTS);
      expect(sql, operator).toContain('CASE WHEN');
      expect(sql, operator).toContain('ELSE NULL END');
      expect(sql, operator).not.toMatch(/AND\s*\(a\.attributes ->> \$\d+\)::numeric/);
    }
  });

  it('never interpolates a custom field key', () => {
    const { sql, params } = compileSegmentSql(astFor('text', 'eq'), INVARIANT_OPTS);
    expect(sql).not.toContain("'txt'");
    expect(params).toContain('txt');
  });
});
