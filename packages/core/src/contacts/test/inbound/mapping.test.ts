import { describe, expect, it } from 'vitest';
import { applyMapping, applyTransform, type InboundMapping } from '../../inbound/mapping';
import { readPath } from '../../inbound/path';

const payload = {
  id: 'evt_1',
  type: 'order.created',
  data: {
    customer: { email: 'j@x.cz', first_name: 'Jan', locale: 'cs-CZ', accepts_marketing: true },
    total_price: '1234.5',
    items: [{ sku: 'a' }, { sku: 'b' }],
  },
  created_at: 1735689600,
};

describe('gramatika přístupové cesty', () => {
  it.each([
    ['$', payload],
    ['$.id', 'evt_1'],
    ['$.data.customer.email', 'j@x.cz'],
    ['$.data.items[0].sku', 'a'],
    ['$.data.items[1].sku', 'b'],
  ])('%s vrátí správnou hodnotu', (path, expected) => {
    expect(readPath(payload, path as string)).toEqual(expected);
  });

  it('neexistující cesta vrací null, ne výjimku', () => {
    expect(readPath(payload, '$.data.neexistuje.hluboko')).toBeNull();
    expect(readPath(payload, '$.data.items[9].sku')).toBeNull();
  });

  it.each(['$..email', '$.data[*].sku', '$.data[?(@.x)]', '$.data.items.length()'])(
    'nepodporuje výraz %s',
    (path) => {
      expect(readPath(payload, path)).toBeNull();
    },
  );

  it('gramatika je záměrně minimální a neumí spustit nic', () => {
    expect(readPath(payload, '$.constructor')).toBeNull();
    expect(readPath(payload, '$.__proto__')).toBeNull();
    expect(readPath(payload, '$.prototype')).toBeNull();
  });

  it('zděděná vlastnost se nečte, jen vlastní klíč objektu', () => {
    expect(readPath(payload, '$.toString')).toBeNull();
  });
});

describe('transformace', () => {
  it.each([
    ['lowercase', 'ABC', 'abc'],
    ['uppercase', 'abc', 'ABC'],
    ['trim', '  a  ', 'a'],
    ['language_tag', 'cs-CZ', 'cs'],
  ] as const)('%s převede %s na %s', (transform, input, expected) => {
    expect(applyTransform(input, transform)).toBe(expected);
  });

  it('unix_seconds převede číslo na čas', () => {
    expect(applyTransform(1735689600, 'unix_seconds')).toBe('2025-01-01T00:00:00.000Z');
  });

  it('unix_millis převede milisekundy na čas', () => {
    expect(applyTransform(1735689600000, 'unix_millis')).toBe('2025-01-01T00:00:00.000Z');
  });

  it('boolean používá tutéž tabulku jako koerce polí', () => {
    expect(applyTransform('ano', 'boolean')).toBe(true);
    expect(applyTransform('ne', 'boolean')).toBe(false);
  });

  it('prázdná hodnota se transformací nezmění na řetězec null', () => {
    expect(applyTransform(null, 'lowercase')).toBeNull();
    expect(applyTransform(undefined, 'trim')).toBeNull();
  });
});

describe('applyMapping', () => {
  const mapping: InboundMapping = {
    version: 1,
    event: { path: '$.type', map: { 'order.created': 'subscribe' }, default: 'ignore' },
    external_id: { path: '$.id' },
    contact: {
      email: { path: '$.data.customer.email', required: true },
      first_name: { path: '$.data.customer.first_name' },
      locale: { path: '$.data.customer.locale', transform: 'language_tag' },
      attributes: {
        order_total: { path: '$.data.total_price', type: 'number' },
        last_order_at: { path: '$.created_at', type: 'datetime' },
      },
    },
    lists: ['00000000-0000-0000-0000-000000000001'],
    tags: ['zakaznik'],
    consent: {
      purpose: 'email_marketing',
      legal_basis: 'soft_opt_in',
      when: { path: '$.data.customer.accepts_marketing', equals: true },
      consent_text: 'Souhlasím se zasíláním novinek.',
    },
    on_conflict: 'update',
  };

  it('namapuje kontakt i akci', () => {
    const result = applyMapping(payload, mapping);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action).toBe('subscribe');
    expect(result.externalId).toBe('evt_1');
    expect(result.contact.email).toBe('j@x.cz');
    expect(result.contact['locale']).toBe('cs');
    expect(result.contact.attributes['order_total']).toBe(1234.5);
    expect(result.contact.attributes['last_order_at']).toBe('2025-01-01T00:00:00.000Z');
  });

  it('neznámý typ události spadne na výchozí akci', () => {
    const result = applyMapping({ ...payload, type: 'neznamy' }, mapping);
    expect(result.ok && result.action).toBe('ignore');
  });

  it('akce mimo uzavřený výčet se nepropíše, spadne na ignore', () => {
    const result = applyMapping(payload, {
      ...mapping,
      event: { path: '$.type', map: { 'order.created': 'drop_database' } },
    });
    expect(result.ok && result.action).toBe('ignore');
  });

  it('chybějící povinná hodnota je odmítnutí s vlastním kódem', () => {
    const result = applyMapping({ ...payload, data: { customer: {} } }, mapping);
    expect(result).toEqual({
      ok: false,
      code: 'mapping_required_missing',
      path: '$.data.customer.email',
    });
  });

  it('podmínka souhlasu se vyhodnotí', () => {
    const withConsent = applyMapping(payload, mapping);
    expect(withConsent.ok && withConsent.consent).toBeDefined();
    const without = applyMapping(
      {
        ...payload,
        data: {
          ...payload.data,
          customer: { ...payload.data.customer, accepts_marketing: false },
        },
      },
      mapping,
    );
    expect(without.ok && without.consent).toBeUndefined();
  });

  it('seznamy, štítky a režim kolize mají výchozí hodnoty', () => {
    const result = applyMapping(payload, {
      contact: { email: { path: '$.data.customer.email', required: true } },
    });
    expect(result.ok && result.listIds).toEqual([]);
    expect(result.ok && result.tags).toEqual([]);
    expect(result.ok && result.onConflict).toBe('update');
  });
});
