import { describe, expect, it } from 'vitest';
import {
  CONTACT_LIST_ORDERS,
  contactsHref,
  describeFilters,
  filtersOffToolbar,
  filtersToQuery,
  hasAnyFilter,
  readContactFilters,
  unconfirmedCountFilters,
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

/**
 * Meta řádek pod názvem obrazovky říká „13 kontaktů · 10 nepotvrzených". Druhé číslo se
 * čte jako podíl z prvního, takže se musí počítat ze stejné množiny. Do 7. 8. 2026 se
 * počítalo za celý projekt a se zapnutým filtrem z toho vycházelo, že ze sedmi kontaktů
 * je deset nepotvrzených.
 */
describe('unconfirmedCountFilters', () => {
  it('bez filtru se ptá na celý projekt', () => {
    expect(unconfirmedCountFilters({})).toEqual({ status: 'unconfirmed' });
  });

  it('se zapnutým filtrem počítá jen v jeho rozsahu, ne za celý projekt', () => {
    expect(unconfirmedCountFilters({ list_id: 'l-1' })).toEqual({
      list_id: 'l-1',
      status: 'unconfirmed',
    });
    expect(unconfirmedCountFilters({ tag_id: 't-1', q: 'novak' })).toEqual({
      tag_id: 't-1',
      q: 'novak',
      status: 'unconfirmed',
    });
  });

  it('u filtru stavu se neptá vůbec, protože by číslo bylo nula nebo totéž ještě jednou', () => {
    expect(unconfirmedCountFilters({ status: 'active' })).toBeNull();
    expect(unconfirmedCountFilters({ status: 'unconfirmed' })).toBeNull();
    expect(unconfirmedCountFilters({ list_id: 'l-1', status: 'bounced' })).toBeNull();
  });
});

/**
 * Pruh pod lištou popisuje jen to, co z lišty vidět NENÍ. Bez tohohle odečtení by
 * nad tlačítkem „Novinky" stála věta „Filtr: seznam Novinky", tedy týž údaj dvakrát.
 */
describe('filtersOffToolbar', () => {
  const vse = { list: true, tag: true };

  it('seznam, štítek, hledání ani tři stavy z přepínače neopakuje', () => {
    expect(
      filtersOffToolbar({ list_id: 'l-1', tag_id: 't-1', q: 'novak', status: 'active' }, vse),
    ).toEqual({});
    expect(filtersOffToolbar({ status: 'unconfirmed' }, vse)).toEqual({});
  });

  it('stav, pro který v přepínači tlačítko není, nechá být', () => {
    // Přepínač zná Všechny, Aktivní a Nepotvrzené. Odhlášený ani odražený na něm
    // poznat nejsou, takže odkaz na ně by jinak vypadal jako nefiltrovaný seznam.
    expect(filtersOffToolbar({ status: 'bounced' }, vse)).toEqual({ status: 'bounced' });
    expect(filtersOffToolbar({ status: 'unsubscribed' }, vse)).toEqual({
      status: 'unsubscribed',
    });
  });

  it('filtry bez ovládání v liště nechává vždycky', () => {
    const filters = {
      segment_id: 's-1',
      vocative_confidence: 'low' as const,
      created_after: '2026-01-01',
      created_before: '2026-02-01',
    };
    expect(filtersOffToolbar(filters, vse)).toEqual(filters);
  });

  it('nekreslenou nabídku neodečítá, jinak by filtr zmizel z obrazovky úplně', () => {
    expect(
      filtersOffToolbar({ list_id: 'l-1', tag_id: 't-1' }, { list: false, tag: true }),
    ).toEqual({ list_id: 'l-1' });
    expect(
      filtersOffToolbar({ list_id: 'l-1', tag_id: 't-1' }, { list: true, tag: false }),
    ).toEqual({ tag_id: 't-1' });
  });

  it('původní filtr nemění, protože z něj pořád skládáme adresu', () => {
    const filters = { list_id: 'l-1', q: 'novak' };
    filtersOffToolbar(filters, vse);
    expect(filters).toEqual({ list_id: 'l-1', q: 'novak' });
  });
});
