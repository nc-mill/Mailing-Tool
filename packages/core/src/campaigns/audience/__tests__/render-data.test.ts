import { describe, expect, it } from 'vitest';
import { FIRST_CLASS_CONTACT_FIELDS } from '../../../contacts/fields/catalog';
import {
  buildRenderData,
  renderDataColumns,
  renderDataSelectItem,
  ISO_DATE_CONTACT_COLUMNS,
  RENDER_DATA_EXCLUDED_FIELDS,
  SNAPSHOTTABLE_CONTACT_COLUMNS,
} from '../render-data';

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

  it('renderDataColumns dodava i pole mimo puvodni sedmicku sloupcu', () => {
    // Presne ta pole, ktera paletka personalizace nabizi a materializace je drive
    // nedodala, takze merge tag dorazil prazdny.
    expect(
      renderDataColumns([
        'contact.middle_name',
        'contact.title_prefix',
        'contact.title_suffix',
        'contact.gender',
        'contact.last_name_vocative',
        'contact.locale',
        'contact.created_at',
      ]),
    ).toEqual([
      'created_at',
      'gender',
      'last_name_vocative',
      'locale',
      'middle_name',
      'title_prefix',
      'title_suffix',
    ]);
  });

  it('neznamy nazev se do dotazu nedostane', () => {
    // Nazev sloupce jde do SELECT jako text, takze tohle je bezpecnostni hranice,
    // ne kosmetika.
    expect(renderDataColumns(['contact.password_hash', 'contact.email_fingerprints'])).toEqual([]);
    expect(renderDataColumns(['contact.id) FROM contacts --'])).toEqual([]);
  });

  it('poradi je stabilni bez ohledu na poradi znacek v sablone', () => {
    expect(renderDataColumns(['contact.last_name', 'contact.first_name'])).toEqual(
      renderDataColumns(['contact.first_name', 'contact.last_name']),
    );
  });

  it('vycet sloupcu pokryva vsechna prvotridni pole katalogu', () => {
    // Kdo prida pole do katalogu a sem ne, dostane cerveny test misto tiche prazdne
    // hodnoty v odeslane zprave. `email` je vyjimka, ta je ve vyctu vyloucenych.
    const chybi = FIRST_CLASS_CONTACT_FIELDS.map((f) => f.path).filter(
      (path) =>
        path !== 'email' && !(SNAPSHOTTABLE_CONTACT_COLUMNS as readonly string[]).includes(path),
    );
    expect(chybi).toEqual([]);
  });

  it('kazde casove pole katalogu se normalizuje na RFC 3339', () => {
    // Bez normalizace prijde z ovladace „2026-08-07 09:57:51+00" a filtr `date`
    // v senderu takovy tvar odmita, takze znacka vyrenderuje prazdno.
    const chybi = FIRST_CLASS_CONTACT_FIELDS.filter(
      (f) =>
        (f.type === 'datetime' || f.type === 'date') &&
        !(ISO_DATE_CONTACT_COLUMNS as readonly string[]).includes(f.path),
    ).map((f) => f.path);
    expect(chybi).toEqual([]);
  });

  it('casovy sloupec se vybira pres to_char, ostatni primo', () => {
    expect(renderDataSelectItem('first_name', 'c')).toBe('c.first_name');
    expect(renderDataSelectItem('created_at', 'c')).toBe(
      `to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at`,
    );
  });
});
