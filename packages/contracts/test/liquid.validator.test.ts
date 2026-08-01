import { describe, expect, it } from 'vitest';
import {
  LIQUID_LIMITS,
  ALLOWED_FILTERS,
  ALLOWED_ROOTS,
  DATE_FORMAT_WHITELIST,
} from '../src/liquid/grammar';
import { validateLiquid } from '../src/liquid/validator';

const ctx = {
  level: 'authored' as const,
  template_kind: 'campaign' as const,
  fields: {
    contactFirstClass: ['first_name', 'greeting', 'city', 'is_vip', 'age', 'tags'],
    contactAttrKeys: ['city'],
  },
};

const codes = (source: string, level: 'authored' | 'compiled' = 'authored'): string[] =>
  validateLiquid(source, { ...ctx, level }).issues.map((issue) => issue.code);

describe('gramatika kontraktu 4.10.2', () => {
  it('má pět filtrů a pět formátů data', () => {
    expect(ALLOWED_FILTERS).toEqual(['default', 'upcase', 'downcase', 'date', 'escape']);
    expect(DATE_FORMAT_WHITELIST).toEqual([
      '%d.%m.%Y',
      '%-d.%-m.%Y',
      '%Y-%m-%d',
      '%d.%m.%Y %H:%M',
      '%H:%M',
    ]);
    expect(LIQUID_LIMITS).toEqual({
      nestingDepth: 3,
      loops: 5,
      iterations: 200,
      pathSegments: 3,
      templateBytes: 512 * 1024,
      outputs: 500,
      renderMs: 50,
    });
    expect(ALLOWED_ROOTS).toContain('contact');
    expect(ALLOWED_ROOTS).toContain('workspace');
    expect(ALLOWED_ROOTS).not.toContain('_context');
  });
});

describe('validátor přijímá to, co má', () => {
  it.each([
    'Dobrý den, {{ contact.first_name }}!',
    '{{ contact.attr.city }}',
    '{% if contact.is_vip %}VIP{% endif %}',
    '{% unless contact.is_vip %}běžný{% endunless %}',
    '{% if contact.is_vip %}A{% elsif contact.city %}B{% else %}C{% endif %}',
    '{% for tag in contact.tags %}{{ tag }}{% endfor %}',
    '{{ contact.first_name | default }}',
    '{{ contact.first_name | upcase }}',
  ])('přijme %s', (source) => {
    expect(validateLiquid(source, ctx).ok).toBe(true);
  });

  it('přijme argument filtru v KOMPILOVANÉ šabloně', () => {
    expect(
      validateLiquid('{{ contact.first_name | default: "kolego" }}', { ...ctx, level: 'compiled' })
        .ok,
    ).toBe(true);
    expect(
      validateLiquid('{{ contact.city | date: "%d.%m.%Y" }}', { ...ctx, level: 'compiled' }).ok,
    ).toBe(true);
  });

  it('přijme _present jen v kompilované šabloně', () => {
    expect(
      validateLiquid('{% if _present.contact__city %}x{% endif %}', { ...ctx, level: 'compiled' })
        .ok,
    ).toBe(true);
    expect(codes('{% if _present.contact__city %}x{% endif %}')).toContain('liquid_unknown_root');
  });
});

describe('validátor odmítá to, co má', () => {
  it.each([
    ['{% assign x = 1 %}', 'liquid_tag_not_allowed'],
    ['{% capture x %}y{% endcapture %}', 'liquid_tag_not_allowed'],
    ['{% case x %}{% endcase %}', 'liquid_tag_not_allowed'],
    ['{% raw %}x{% endraw %}', 'liquid_tag_not_allowed'],
    ['{% comment %}x{% endcomment %}', 'liquid_tag_not_allowed'],
    ['{{- contact.first_name -}}', 'liquid_whitespace_control_not_allowed'],
    ['{{ contact.first_name | reverse }}', 'liquid_filter_not_allowed'],
    ['{{ contact.first_name | vocative }}', 'liquid_vocative_filter'],
    ['{% if contact.tags contains 1 %}x{% endif %}', 'liquid_contains_not_allowed'],
    ['{% if (contact.is_vip) %}x{% endif %}', 'liquid_parentheses_not_allowed'],
    [
      '{% for a in contact.tags %}{% for b in contact.tags %}{% endfor %}{% endfor %}',
      'liquid_nested_for',
    ],
    ['{% for a in contact.tags limit: 2 %}{% endfor %}', 'liquid_for_parameter_not_allowed'],
    ['{{ contact.tags[0] }}', 'liquid_index_not_allowed'],
    ['{{ contact.first_name | default: "kolego" }}', 'liquid_string_literal_not_allowed'],
    ["{% if contact.city == 'CZ' %}x{% endif %}", 'liquid_string_literal_not_allowed'],
    ['{% if contact.age > 5 %}x{% endif %}', 'liquid_comparison_operator_not_supported'],
    ['{{ contact.a.b.c.d }}', 'liquid_path_too_deep'],
    ['{% if contact.city == blank %}x{% endif %}', 'liquid_literal_not_supported'],
    ['{% if contact.tags == empty %}x{% endif %}', 'liquid_literal_not_supported'],
    ['{{ neznamy.koren }}', 'liquid_unknown_root'],
    ['{{ contact.neexistuje }}', 'liquid_unknown_field'],
    ['{{ contact.First_Name }}', 'liquid_identifier_case'],
    ['{% if contact.is_vip %}x', 'liquid_unbalanced_block'],
    ['{{ _context.timezone }}', 'liquid_unknown_root'],
  ])('odmítne %s kódem %s', (source, code) => {
    const result = validateLiquid(source, ctx);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain(code);
  });

  it('odmítne HTML entitu uvnitř konstrukce v kompilované šabloně', () => {
    expect(codes('{{ contact.first_name | default: &quot;kolego&quot; }}', 'compiled')).toContain(
      'liquid_escaped_entity_in_construct',
    );
  });

  it('odmítne formát data mimo whitelist', () => {
    expect(codes('{{ contact.city | date: "%B %Y" }}', 'compiled')).toContain(
      'liquid_date_format_not_allowed',
    );
  });

  it.each([
    [
      '{% if contact.is_vip %}'.repeat(4) + 'x' + '{% endif %}'.repeat(4),
      'liquid_nesting_too_deep',
    ],
    ['{% for t in contact.tags %}{% endfor %}'.repeat(6), 'liquid_too_many_loops'],
  ])('vynutí limit %#', (source, code) => {
    expect(codes(source)).toContain(code);
  });

  it('vynutí limit 500 výstupů a 512 kB', () => {
    expect(codes('{{ contact.first_name }}'.repeat(501))).toContain('liquid_too_many_outputs');
    expect(codes('x'.repeat(512 * 1024 + 1))).toContain('liquid_template_too_large');
  });
});

describe('varování a informace', () => {
  it('escape dá informační hlášku, ne chybu', () => {
    const result = validateLiquid('{{ contact.first_name | escape }}', ctx);
    expect(result.ok).toBe(true);
    expect(result.issues[0]?.code).toBe('liquid_escape_not_needed');
    expect(result.issues[0]?.severity).toBe('info');
  });

  it('past prázdného řetězce nabídne akci v panelu vlastností, ne náhradní text', () => {
    const result = validateLiquid('{% if contact.city %}x{% endif %}', ctx);
    expect(result.ok).toBe(true);
    const warning = result.issues.find((i) => i.code === 'liquid_truthy_string_warning');
    expect(warning?.severity).toBe('warning');
    expect(warning?.suggestion).toMatchObject({
      kind: 'set_visibility',
      field: 'contact.city',
      op: 'present',
    });
  });

  it('hlásí pozici na řádek a sloupec', () => {
    const result = validateLiquid('první řádek\n{% assign x = 1 %}', ctx);
    expect(result.issues[0]?.span.line).toBe(2);
    expect(result.issues[0]?.span.col).toBe(1);
  });
});
