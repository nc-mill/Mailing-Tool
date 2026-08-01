import { describe, expect, it } from 'vitest';
import { getTableConfig, pgTable, type PgColumnBuilderBase } from 'drizzle-orm/pg-core';
import { bytea, byteaArray, cidr, citext, inet, inetArray } from '../src/schema/_types';

/**
 * Odchylka od plánu vynucená chováním drizzle-orm 0.44.7: `citext('email')`
 * vrací PgCustomColumnBuilder, ne sloupec, a `getSQLType()` je metoda až na
 * PgCustomColumn. Builder se na sloupec promění teprve zabudováním do tabulky,
 * takže si test jednu pomocnou tabulku postaví. Ověřuje se tím totéž co
 * v plánu, jen přes objekt, který metodu skutečně má.
 */
function probeColumn<T extends PgColumnBuilderBase>(builder: T) {
  return getTableConfig(pgTable('probe', { c: builder })).columns[0]!;
}

describe('vlastní typy sloupců', () => {
  it('citext se do SQL zapíše jako citext', () => {
    expect(probeColumn(citext('email')).getSQLType()).toBe('citext');
  });
  it('bytea se do SQL zapíše jako bytea', () => {
    expect(probeColumn(bytea('token_hash')).getSQLType()).toBe('bytea');
  });
  it('byteaArray se do SQL zapíše jako bytea[]', () => {
    expect(probeColumn(byteaArray('email_fingerprints')).getSQLType()).toBe('bytea[]');
  });
  it('inet se do SQL zapíše jako inet', () => {
    expect(probeColumn(inet('ip')).getSQLType()).toBe('inet');
  });
  it('inetArray se do SQL zapíše jako inet[]', () => {
    expect(probeColumn(inetArray('ip_allowlist')).getSQLType()).toBe('inet[]');
  });
  it('cidr se do SQL zapíše jako cidr', () => {
    expect(probeColumn(cidr('range')).getSQLType()).toBe('cidr');
  });

  it('byteaArray nemá vlastní konverzi, hodnotu předává ovladači beze změny', () => {
    // Ovladač pg vrací bytea[] rovnou jako Buffer[] a stejné pole i přijímá,
    // takže jakákoli konverze tady by hodnotu jen poškodila. Test je brána
    // proti tomu, aby ji někdo doplnil podle vzoru pro bytea.
    //
    // PgCustomColumn má mapToDriverValue i mapFromDriverValue vždycky, jsou to
    // metody třídy; volitelné jsou až funkce toDriver a fromDriver z definice
    // typu, které se na sloupci jmenují mapTo a mapFrom. Test proto kontroluje
    // obojí: že definice konverzi nenese a že hodnota projde beze změny,
    // tedy jako tentýž objekt.
    const type = probeColumn(byteaArray('email_fingerprints'));
    const value = [Buffer.from([0x9f, 0x86]), Buffer.from([0x0d, 0x1b])];
    expect((type as unknown as { mapTo?: unknown }).mapTo).toBeUndefined();
    expect((type as unknown as { mapFrom?: unknown }).mapFrom).toBeUndefined();
    expect(type.mapToDriverValue(value)).toBe(value);
    expect(type.mapFromDriverValue(value)).toBe(value);
  });
});
