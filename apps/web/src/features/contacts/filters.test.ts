import { describe, expect, it } from 'vitest';
import {
  CONTACT_LIST_ORDERS,
  contactsHref,
  describeFilters,
  filtersToQuery,
  hasAnyFilter,
  readContactFilters,
} from './filters';

describe('readContactFilters', () => {
  it('přečte prázdné parametry jako prázdný filtr', () => {
    expect(readContactFilters({})).toEqual({});
  });

  it('u pole vezme první hodnotu, protože duplicitní parametr je vždycky omyl', () => {
    expect(readContactFilters({ q: ['novak', 'jiny'] })).toEqual({ q: 'novak' });
  });

  it('ořízne mezery kolem hledaného výrazu a prázdné hledání zahodí', () => {
    expect(readContactFilters({ q: '  novak  ' })).toEqual({ q: 'novak' });
    expect(readContactFilters({ q: '   ' })).toEqual({});
  });

  it('propustí jen známé hodnoty stavu', () => {
    expect(readContactFilters({ status: 'active' })).toEqual({ status: 'active' });
    expect(readContactFilters({ status: 'subscribed' })).toEqual({});
  });

  it('propustí jen známé hodnoty jistoty oslovení', () => {
    expect(readContactFilters({ vocative_confidence: 'low' })).toEqual({
      vocative_confidence: 'low',
    });
    expect(readContactFilters({ vocative_confidence: 'high' })).toEqual({});
  });

  it('propustí jen platné datum ve tvaru YYYY-MM-DD', () => {
    expect(readContactFilters({ created_after: '2026-07-31' })).toEqual({
      created_after: '2026-07-31',
    });
    expect(readContactFilters({ created_after: '31. 7. 2026' })).toEqual({});
  });

  it('ignoruje cizí parametry, které do URL přidá analytika', () => {
    expect(readContactFilters({ utm_source: 'mail', cursor: 'abc', q: 'novak' })).toEqual({
      q: 'novak',
    });
  });
});

describe('filtersToQuery', () => {
  it('poskládá jen vyplněné parametry', () => {
    expect(filtersToQuery({ q: 'novak', status: 'active' }, { limit: 50 })).toEqual({
      q: 'novak',
      status: 'active',
      limit: 50,
    });
  });

  it('nikdy neposílá prázdné hodnoty', () => {
    expect(filtersToQuery({}, {})).toEqual({});
  });

  it('zná jen povolené hodnoty řazení, protože každá musí mít krycí index', () => {
    expect(CONTACT_LIST_ORDERS).toEqual([
      'created_at.desc',
      'created_at.asc',
      'updated_at.desc',
      'last_activity_at.desc',
    ]);
  });
});

describe('hasAnyFilter', () => {
  it('pozná prázdný filtr', () => {
    expect(hasAnyFilter({})).toBe(false);
  });

  it('pozná i samotné hledání', () => {
    expect(hasAnyFilter({ q: 'novak' })).toBe(true);
  });
});

describe('describeFilters', () => {
  const names = {
    lists: { 'l-1': 'Zákazníci' },
    tags: { 't-1': 'Brno' },
    segments: {},
  };

  it('popíše filtr po částech, každou jako celou zprávu s vlastním klíčem', () => {
    expect(
      describeFilters({ list_id: 'l-1', tag_id: 't-1', status: 'active', q: 'novák' }, names),
    ).toEqual([
      { key: 'chip.list', values: { value: 'Zákazníci' } },
      { key: 'chip.tag', values: { value: 'Brno' } },
      { key: 'chip.status', values: { value: 'status.active' } },
      { key: 'chip.search', values: { value: 'novák' } },
    ]);
  });

  it('u neznámého identifikátoru použije identifikátor, ne prázdno', () => {
    expect(describeFilters({ list_id: 'l-x' }, names)).toEqual([
      { key: 'chip.list', values: { value: 'l-x' } },
    ]);
  });

  it('u nejistého oslovení nemá žádný slot', () => {
    expect(describeFilters({ vocative_confidence: 'low' }, names)).toEqual([
      { key: 'chip.vocative', values: {} },
    ]);
  });

  it('prázdný filtr nemá co popsat', () => {
    expect(describeFilters({}, names)).toEqual([]);
  });
});

describe('contactsHref', () => {
  it('bez filtru a bez kurzoru vrátí holou cestu', () => {
    expect(contactsHref('/w/eshop/contacts', {})).toBe('/w/eshop/contacts');
  });

  it('kurzor přidá k filtru, čísla stránek v URL nikdy nejsou', () => {
    expect(contactsHref('/w/eshop/contacts', { status: 'active' }, 'c2')).toBe(
      '/w/eshop/contacts?status=active&cursor=c2',
    );
  });
});
