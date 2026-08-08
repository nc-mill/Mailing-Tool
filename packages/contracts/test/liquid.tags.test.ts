import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHtmlEngine, createTextEngine, listBuiltinTagNames } from '../src/liquid/engine';
import { ALLOWED_TAGS } from '../src/liquid/grammar';
import { validateLiquid } from '../src/liquid/validator';

/**
 * Regresní sada nálezu N1. Kontrakt měl uzavřené FILTRY a otevřené TAGY, takže
 * `{% render 'package.json' %}` vrátilo obsah souboru. Předmět kampaně přitom
 * neprocházel validátorem a šel do renderu tak, jak ho uživatel napsal.
 */
describe('uzavřený seznam tagů', () => {
  it('vestavěné tagy se dají vyjmenovat a `if`, `unless` a `for` jsou mezi nimi', () => {
    const names = listBuiltinTagNames();
    expect(names.length).toBeGreaterThanOrEqual(15);
    for (const tag of ['if', 'unless', 'for']) expect(names).toContain(tag);
    // Právě tyhle tři čtou soubory. Kdyby je knihovna přejmenovala, přepsání by
    // je minulo a test by to musel odhalit.
    for (const tag of ['include', 'render', 'layout']) expect(names).toContain(tag);
  });

  const forbidden = [
    '{% include "package.json" %}',
    "{% render 'package.json' %}",
    '{% layout "package.json" %}',
    '{% assign x = 1 %}',
    '{% capture x %}y{% endcapture %}',
    '{% case x %}{% when 1 %}a{% endcase %}',
    '{% comment %}x{% endcomment %}',
    '{% raw %}x{% endraw %}',
    '{% tablerow x in y %}{% endtablerow %}',
    '{% cycle "a", "b" %}',
    '{% increment x %}',
    '{% decrement x %}',
    '{% echo x %}',
    '{% liquid echo 1 %}',
    '{% # komentář %}',
    '{% break %}',
    '{% continue %}',
  ];

  it.each(forbidden)('%s selže v HTML i textovém enginu', async (source) => {
    await expect(createHtmlEngine().parseAndRender(source, {})).rejects.toThrow();
    await expect(createTextEngine().parseAndRender(source, {})).rejects.toThrow();
  });

  it('zakázaný tag selže i ve větvi, která se nevykoná', async () => {
    // Kdyby chyba padala až z `render`, stačilo by útočníkovi obalit include
    // podmínkou a šablona by prošla. Chyba proto musí padat z `parse`.
    await expect(
      createTextEngine().parseAndRender(
        '{% if false %}{% include "package.json" %}{% endif %}',
        {},
      ),
    ).rejects.toThrow();
  });

  it('include ani render nepřečtou soubor z disku', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mlain-liquid-'));
    const secret = path.join(dir, 'secret.env');
    writeFileSync(secret, 'SECRET_KEY=topsecret-poc\n');

    for (const source of [
      `{% include "${secret}" %}`,
      `{% render "${secret}" %}`,
      `{% layout "${secret}" %}`,
      '{% include "package.json" %}',
    ]) {
      const engine = createTextEngine();
      await expect(engine.parseAndRender(source, {})).rejects.toThrow();
    }
  });

  it('validátor odmítne tag mimo seznam už na úrovni zdroje', () => {
    for (const source of ['{% include "x" %}', "{% render 'x' %}", '{% layout "x" %}']) {
      const result = validateLiquid(source, { level: 'authored' });
      expect(result.ok).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toContain('liquid_tag_not_allowed');
    }
  });
});

describe('legitimní Liquid zůstal beze změny', () => {
  const data = {
    contact: { first_name: 'Jana', vip: true, tags: ['a', 'b'], note: '' },
  };

  it.each([
    ['{{ contact.first_name }}', 'Jana'],
    ['{% if contact.vip %}A{% else %}B{% endif %}', 'A'],
    ['{% if contact.chybi %}A{% elsif contact.vip %}C{% else %}B{% endif %}', 'C'],
    ['{% unless contact.vip %}U{% endunless %}', ''],
    ['{% for t in contact.tags %}{{ t }},{% endfor %}', 'a,b,'],
    ['{{ contact.first_name | upcase }}', 'JANA'],
    ['{{ contact.chybi | default: "kolego" }}', 'kolego'],
    // Prázdný řetězec je podle kontraktu pravdivý, viz LQ-301.
    ['{% if contact.note %}A{% else %}B{% endif %}', 'A'],
  ])('%s vrátí %s', async (source, expected) => {
    expect(await createTextEngine().parseAndRender(source, data)).toBe(expected);
    expect(await createHtmlEngine().parseAndRender(source, data)).toBe(expected);
  });

  it('gramatika povoluje právě osm jmen a tři z nich jsou v registru knihovny', () => {
    expect([...ALLOWED_TAGS]).toEqual([
      'if',
      'elsif',
      'else',
      'endif',
      'unless',
      'endunless',
      'for',
      'endfor',
    ]);
    // Zbylých pět jsou větve a uzávěry, které si blokové tagy parsují samy,
    // takže v registru knihovny nejsou a přepsání se jich netýká.
    const registry = new Set(listBuiltinTagNames());
    expect([...ALLOWED_TAGS].filter((tag) => registry.has(tag))).toEqual(['if', 'unless', 'for']);
  });
});
