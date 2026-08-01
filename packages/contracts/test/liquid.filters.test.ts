import { describe, expect, it } from 'vitest';
import { createHtmlEngine, createTextEngine, listBuiltinFilterNames } from '../src/liquid/engine';
import { dateFilter, defaultFilter, simpleDowncase, simpleUpcase } from '../src/liquid/filters';

describe('pět vlastních filtrů', () => {
  it('default vrací argument pro nil, false, prázdný řetězec a prázdné pole, ale ne pro 0', () => {
    expect(defaultFilter(null, 'kolego')).toBe('kolego');
    expect(defaultFilter(undefined, 'kolego')).toBe('kolego');
    expect(defaultFilter(false, 'kolego')).toBe('kolego');
    expect(defaultFilter('', 'kolego')).toBe('kolego');
    expect(defaultFilter([], 'kolego')).toBe('kolego');
    expect(defaultFilter(0, 'kolego')).toBe(0);
    expect(defaultFilter('Jana', 'kolego')).toBe('Jana');
  });

  it('upcase je simple mapping, ne full mapping', () => {
    expect(simpleUpcase('ěščřžýáíéůúňťď')).toBe('ĚŠČŘŽÝÁÍÉŮÚŇŤĎ');
    expect(simpleUpcase('chalupa')).toBe('CHALUPA');
    // ß, ﬁ, ŉ, ǰ a ΐ mají jen FULL uppercase mapping, tedy se nemění.
    // Naivní toUpperCase() by z ß udělal SS a rozešel by se s Go.
    expect(simpleUpcase('ß ﬁ ŉ ǰ ΐ')).toBe('ß ﬁ ŉ ǰ ΐ');
    expect(simpleDowncase('ĚŠČ')).toBe('ěšč');
  });

  it('date umí všech pět formátů a nikdy nevrací chybu', () => {
    const iso = '2026-08-01T12:40:00Z';
    expect(dateFilter(iso, '%d.%m.%Y', 'Europe/Prague')).toBe('01.08.2026');
    expect(dateFilter(iso, '%-d.%-m.%Y', 'Europe/Prague')).toBe('1.8.2026');
    expect(dateFilter(1_784_995_200, '%Y-%m-%d', 'Europe/Prague')).toBe('2026-07-25');
    expect(dateFilter(iso, '%d.%m.%Y %H:%M', 'Europe/Prague')).toBe('01.08.2026 14:40');
    expect(dateFilter(iso, '%H:%M', 'Europe/Prague')).toBe('14:40');
    expect(dateFilter('včera', '%d.%m.%Y', 'Europe/Prague')).toBe('');
    expect(dateFilter(null, '%d.%m.%Y', 'Europe/Prague')).toBe('');
    expect(dateFilter({}, '%d.%m.%Y', 'Europe/Prague')).toBe('');
    expect(dateFilter(iso, '%d.%m.%Y', undefined)).toBe('01.08.2026');
  });
});

describe('instance enginů', () => {
  it('HTML engine escapuje pět znaků přesně podle kontraktu', async () => {
    const html = await createHtmlEngine().parseAndRender('{{ x }}', { x: `a&b<c>d"e'f` });
    expect(html).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f');
  });

  it('textový engine neescapuje nic', async () => {
    const text = await createTextEngine().parseAndRender('{{ x }}', { x: `a&b<c>d"e'f` });
    expect(text).toBe(`a&b<c>d"e'f`);
  });

  it('escape je no-op, hodnota se neescapuje dvakrát', async () => {
    expect(await createHtmlEngine().parseAndRender('{{ x | escape }}', { x: 'a&b' })).toBe(
      'a&amp;b',
    );
  });

  it('každý vestavěný filtr mimo naši pětici při renderu selže', async () => {
    const builtins = listBuiltinFilterNames();
    expect(builtins.length).toBeGreaterThan(30);
    const engine = createHtmlEngine();
    for (const name of builtins) {
      if (['default', 'upcase', 'downcase', 'date', 'escape'].includes(name)) continue;
      await expect(engine.parseAndRender(`{{ x | ${name} }}`, { x: 'a' })).rejects.toThrow();
    }
  });

  it('chybějící proměnná je prázdný řetězec, ne chyba', async () => {
    expect(await createHtmlEngine().parseAndRender('[{{ contact.a.b }}]', {})).toBe('[]');
  });

  it('pravdivost: falešné jsou jen false a nil', async () => {
    const engine = createTextEngine();
    expect(await engine.parseAndRender('{% if x %}A{% else %}B{% endif %}', { x: '' })).toBe('A');
    expect(await engine.parseAndRender('{% if x %}A{% else %}B{% endif %}', { x: 0 })).toBe('A');
    expect(await engine.parseAndRender('{% if x %}A{% else %}B{% endif %}', { x: false })).toBe(
      'B',
    );
    expect(await engine.parseAndRender('{% if x %}A{% else %}B{% endif %}', {})).toBe('B');
  });
});
