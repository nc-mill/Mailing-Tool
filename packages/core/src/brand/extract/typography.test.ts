import { describe, expect, it } from 'vitest';
import { mapFontStack, medianRadius } from './typography';

describe('mapování písma', () => {
  it('bezpatková písma mapuje na system', () => {
    for (const font of ['Inter', 'Roboto', 'Open Sans', 'Lato']) {
      expect(mapFontStack(`${font}, sans-serif`)).toBe('system');
    }
  });

  it('patková písma mapuje na georgia', () => {
    for (const font of ['Merriweather', 'Playfair Display', 'Georgia']) {
      expect(mapFontStack(`"${font}", serif`)).toBe('georgia');
    }
  });

  it('neznámé firemní písmo padá na system', () => {
    expect(mapFontStack('"Firemní Groteska", sans-serif')).toBe('system');
  });

  it('prázdná hodnota padá na system', () => {
    expect(mapFontStack('')).toBe('system');
    expect(mapFontStack(undefined)).toBe('system');
  });

  it('bezpatkové výjimky se mapují na svůj vlastní stack', () => {
    expect(mapFontStack('Arial, sans-serif')).toBe('arial');
    expect(mapFontStack('Verdana, sans-serif')).toBe('verdana');
    expect(mapFontStack('Tahoma, sans-serif')).toBe('tahoma');
    expect(mapFontStack('"Courier New", monospace')).toBe('courier');
  });
});

describe('zaoblení', () => {
  it('medián se zaokrouhlí na povolenou hodnotu', () => {
    expect(medianRadius(['4px', '6px', '8px'])).toBe(6);
    expect(medianRadius(['3px'])).toBe(4);
    expect(medianRadius(['100px'])).toBe(16);
  });

  it('bez vstupu je výchozí 6', () => {
    expect(medianRadius([])).toBe(6);
  });

  it('nesmyslné hodnoty se ignorují', () => {
    expect(medianRadius(['inherit', '50%', '6px'])).toBe(6);
  });
});
