import { describe, expect, it } from 'vitest';
import { buildRenderData, renderDataColumns, RENDER_DATA_EXCLUDED_FIELDS } from '../render-data';

const contact = {
  id: 'c1',
  email: 'jana@example.cz',
  first_name: 'Jana',
  last_name: 'Nováková',
  first_name_vocative: 'Jano',
  greeting: 'Dobrý den, Jano',
  attributes: { city: 'Brno', orders_count: 3, note: null },
};

describe('render_data', () => {
  it('tvar je vnoreny, ne plochy, jinak Liquid nic nevyrendruje', () => {
    const rd = buildRenderData(contact, ['contact.first_name']);
    expect(rd.data).toEqual({ contact: { first_name: 'Jana' } });
    expect(Object.keys(rd.data)).not.toContain('contact.first_name');
  });

  it('vlastni pole jde pod contact.attr, ne contact.custom', () => {
    const rd = buildRenderData(contact, ['contact.attr.city']);
    expect(rd.data).toEqual({ contact: { attr: { city: 'Brno' } } });
  });

  it('null se zapisuje jako null, ne vynechava', () => {
    const rd = buildRenderData(contact, ['contact.attr.note']);
    expect(rd.data.contact.attr).toEqual({ note: null });
  });

  it('e-mail se nikdy nesnapshotuje, je v samostatnem sloupci', () => {
    const rd = buildRenderData(contact, ['contact.email', 'contact.first_name']);
    expect(JSON.stringify(rd.data)).not.toContain('jana@example.cz');
    expect(RENDER_DATA_EXCLUDED_FIELDS).toContain('contact.email');
  });

  it('unsubscribe_url a webview_url se nesnapshotuji, stavi je sender z tokenu', () => {
    const rd = buildRenderData(contact, ['unsubscribe_url', 'webview_url', 'contact.first_name']);
    expect(rd.data).toEqual({ contact: { first_name: 'Jana' } });
  });

  it('hlubsi nez dve urovne se odmita', () => {
    expect(() => buildRenderData(contact, ['contact.attr.a.b'])).toThrowError(/dvě úrovně/);
  });

  it('pres 8 kB vraci priznak too large, ne vyjimku', () => {
    const big = { ...contact, attributes: { blob: 'x'.repeat(9000) } };
    const rd = buildRenderData(big, ['contact.attr.blob']);
    expect(rd.tooLarge).toBe(true);
    expect(rd.errorCode).toBe('render_data_too_large');
  });

  it('renderDataColumns vraci jen sloupce, ktere sablona pouziva', () => {
    expect(renderDataColumns(['contact.first_name', 'contact.attr.city']).sort()).toEqual([
      'attributes',
      'first_name',
    ]);
  });
});
