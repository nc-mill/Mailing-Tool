import { describe, expect, it } from 'vitest';
import { prepareRenderData } from '../src/liquid/prepare-render-data';

describe('prepareRenderData', () => {
  it('zkrátí pole na prvních 200 prvků', () => {
    const raw = { contact: { tags: Array.from({ length: 250 }, (_, i) => `t${i}`) } };
    const prepared = prepareRenderData(raw, { fields: [], presence: [] });
    expect((prepared.contact as { tags: string[] }).tags).toHaveLength(200);
    expect((prepared.contact as { tags: string[] }).tags[199]).toBe('t199');
  });

  it('serializuje čísla nad 2^53 jako řetězec', () => {
    const prepared = prepareRenderData(
      { contact: { vs: 9_007_199_254_740_993n } },
      { fields: [], presence: [] },
    );
    expect((prepared.contact as { vs: unknown }).vs).toBe('9007199254740993');
  });

  it('doplní _context.timezone a _context.locale vždy', () => {
    const prepared = prepareRenderData({}, { fields: [], presence: [] });
    expect(prepared._context).toEqual({ timezone: 'UTC', locale: 'cs' });
  });

  it('nepřepíše _context, který už dorazil', () => {
    const prepared = prepareRenderData(
      { _context: { timezone: 'Europe/Prague', locale: 'en' } },
      { fields: [], presence: [] },
    );
    expect(prepared._context).toEqual({ timezone: 'Europe/Prague', locale: 'en' });
  });

  it('naplní _present pro každou cestu z renderSchema.presence', () => {
    const prepared = prepareRenderData(
      { contact: { city: '   ', first_name: 'Jana' } },
      { fields: [], presence: ['contact.city', 'contact.first_name', 'contact.zip'] },
    );
    expect(prepared._present).toEqual({
      contact__city: false,
      contact__first_name: true,
      contact__zip: false,
    });
  });

  it('past prázdného řetězce: řetězec ze samých mezer není present', () => {
    const prepared = prepareRenderData(
      { contact: { city: '  \t ' } },
      { fields: [], presence: ['contact.city'] },
    );
    expect((prepared._present as Record<string, boolean>).contact__city).toBe(false);
  });
});
