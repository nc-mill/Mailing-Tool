import {
  ALLOWED_FILTERS,
  ALLOWED_ROOTS,
  COMPILED_ONLY_ROOTS,
  DATE_FORMAT_WHITELIST,
  DEFAULT_VALUE_FORBIDDEN_CHARS,
  HTML_ENTITIES_IN_CONSTRUCT,
  INTERNAL_ROOTS,
  LIQUID_LIMITS,
  SUPPORTED_COMPARISON_OPERATORS,
  UNSUPPORTED_LITERALS,
} from './grammar';

export type SourceSpan = { start: number; end: number; line: number; col: number };

export type LiquidIssue = {
  code: string;
  severity: 'error' | 'warning' | 'info';
  span: SourceSpan;
  pointer?: string;
  params?: Record<string, string | number>;
  suggestion?:
    | { kind: 'replace'; replace_with: string; label: string }
    | {
        kind: 'set_visibility';
        block_id: string;
        field: string;
        op: 'present' | 'blank';
        label: string;
      };
};

export type LiquidAstNode =
  | { type: 'text'; value: string }
  | { type: 'output'; expr: string }
  | { type: 'tag'; name: string; body: string };

export type LiquidAst = { nodes: LiquidAstNode[] };

/**
 * Úzký seznam povolených cest kontaktu, který validátor potřebuje k rozhodnutí
 * "tohle pole existuje". NENÍ to katalog polí: ten je bohatý, má cesty, typy
 * a popisky, vlastní ho P07 a jmenuje se `FieldCatalog`. Dřív se tenhle typ
 * jmenoval taky `FieldCatalog`, takže dvě neslučitelné věci nesly jedno jméno
 * a P08, P07 i P12 jím myslely tu druhou (rozhodnutí R2). Přejmenováno na
 * `LiquidRoots`; P07 svůj katalog na tenhle tvar zúží jednou funkcí.
 */
export type LiquidRoots = {
  contactFirstClass: readonly string[];
  contactAttrKeys: readonly string[];
};

export type LiquidLevel = 'authored' | 'compiled';

export type LiquidContext = {
  level: LiquidLevel;
  template_kind?: 'campaign' | 'transactional' | 'system';
  fields?: LiquidRoots;
  roots?: readonly string[];
  /** JSON pointer na uzel dokumentu, doplňuje ho volající */
  pointer?: string;
  /** id bloku pro akci "nastavit podmínku v panelu vlastností" */
  block_id?: string;
};

export type LiquidValidationResult =
  { ok: true; issues: LiquidIssue[]; ast: LiquidAst } | { ok: false; issues: LiquidIssue[] };

const BLOCK_TAGS = new Set(['if', 'unless', 'for']);
const CLOSING_TAGS: Record<string, string> = { endif: 'if', endunless: 'unless', endfor: 'for' };
const BRANCH_TAGS = new Set(['elsif', 'else']);
const IDENT = /^[a-z_][a-z0-9_]*$/;

export function validateLiquid(source: string, ctx: LiquidContext): LiquidValidationResult {
  const issues: LiquidIssue[] = [];
  const nodes: LiquidAstNode[] = [];
  const roots = new Set<string>([
    ...(ctx.roots ?? ALLOWED_ROOTS),
    ...(ctx.level === 'compiled' ? COMPILED_ONLY_ROOTS : []),
  ]);

  const spanAt = (start: number, end: number): SourceSpan => {
    const before = source.slice(0, start);
    const line = before.split('\n').length;
    const col = start - (before.lastIndexOf('\n') + 1) + 1;
    return { start, end, line, col };
  };
  const push = (
    code: string,
    start: number,
    end: number,
    severity: LiquidIssue['severity'] = 'error',
    extra: Partial<LiquidIssue> = {},
  ): void => {
    issues.push({
      code,
      severity,
      span: spanAt(start, end),
      // `pointer` se přidává jen když ho volající dodal: pod exactOptionalPropertyTypes
      // není `pointer: undefined` totéž co chybějící klíč.
      ...(ctx.pointer === undefined ? {} : { pointer: ctx.pointer }),
      ...extra,
    });
  };

  if (Buffer.byteLength(source, 'utf8') > LIQUID_LIMITS.templateBytes) {
    push('liquid_template_too_large', 0, source.length);
    return { ok: false, issues };
  }

  const stack: Array<{ name: string; start: number; loopVar?: string }> = [];
  let outputs = 0;
  let loops = 0;
  let maxConditionDepth = 0;
  let conditionDepth = 0;
  let forDepth = 0;
  let cursor = 0;

  while (cursor < source.length) {
    const outputStart = source.indexOf('{{', cursor);
    const tagStart = source.indexOf('{%', cursor);
    if (outputStart === -1 && tagStart === -1) break;

    const isOutput = tagStart === -1 || (outputStart !== -1 && outputStart < tagStart);
    const start = isOutput ? outputStart : tagStart;
    const closeMark = isOutput ? '}}' : '%}';
    const closeIndex = source.indexOf(closeMark, start + 2);
    if (closeIndex === -1) {
      push('liquid_unbalanced_block', start, source.length, 'error', {
        params: { tag: source.slice(start, start + 2) },
      });
      return { ok: false, issues };
    }
    const end = closeIndex + 2;

    if (source[start + 2] === '-') push('liquid_whitespace_control_not_allowed', start, start + 3);
    if (source[closeIndex - 1] === '-')
      push('liquid_whitespace_control_not_allowed', closeIndex - 1, end);

    const inner = source
      .slice(start + 2, closeIndex)
      .replace(/^-/, '')
      .replace(/-$/, '');

    nodes.push({ type: 'text', value: source.slice(cursor, start) });
    cursor = end;

    if (ctx.level === 'compiled') {
      for (const entity of HTML_ENTITIES_IN_CONSTRUCT) {
        if (inner.includes(entity)) {
          push('liquid_escaped_entity_in_construct', start, end, 'error', { params: { entity } });
        }
      }
    }

    if (isOutput) {
      outputs += 1;
      nodes.push({ type: 'output', expr: inner.trim() });
      validateOutput(inner, start, end);
    } else {
      nodes.push({ type: 'tag', name: inner.trim().split(/\s+/)[0] ?? '', body: inner.trim() });
      validateTag(inner, start, end);
    }
  }
  nodes.push({ type: 'text', value: source.slice(cursor) });

  if (outputs > LIQUID_LIMITS.outputs)
    push('liquid_too_many_outputs', 0, source.length, 'error', { params: { outputs } });
  if (loops > LIQUID_LIMITS.loops)
    push('liquid_too_many_loops', 0, source.length, 'error', { params: { loops } });
  if (maxConditionDepth > LIQUID_LIMITS.nestingDepth) {
    push('liquid_nesting_too_deep', 0, source.length, 'error', {
      params: { depth: maxConditionDepth },
    });
  }
  for (const open of stack) {
    push('liquid_unbalanced_block', open.start, source.length, 'error', {
      params: { tag: open.name, expected: `end${open.name}` },
    });
  }

  const hasError = issues.some((issue) => issue.severity === 'error');
  return hasError ? { ok: false, issues } : { ok: true, issues, ast: { nodes } };

  function validateOutput(inner: string, start: number, end: number): void {
    const parts = splitFilters(inner);
    validatePath(parts.expr.trim(), start, end);
    for (const filter of parts.filters) {
      const colon = filter.indexOf(':');
      const name = (colon === -1 ? filter : filter.slice(0, colon)).trim();
      const argument = colon === -1 ? undefined : filter.slice(colon + 1).trim();

      if (name === 'vocative') {
        push('liquid_vocative_filter', start, end, 'error', {
          params: { filter: name },
          suggestion: {
            kind: 'replace',
            replace_with: '{{ contact.first_name_vocative }}',
            label: '5. pád',
          },
        });
        continue;
      }
      if (!(ALLOWED_FILTERS as readonly string[]).includes(name)) {
        push('liquid_filter_not_allowed', start, end, 'error', { params: { filter: name } });
        continue;
      }
      if (name === 'escape') push('liquid_escape_not_needed', start, end, 'info');
      if (argument === undefined) continue;

      if (ctx.level === 'authored') {
        push('liquid_string_literal_not_allowed', start, end, 'error', {
          params: { filter: name },
        });
        push('liquid_filter_argument_not_allowed', start, end, 'error', {
          params: { filter: name },
        });
        continue;
      }
      if (name !== 'default' && name !== 'date') {
        push('liquid_filter_argument_not_allowed', start, end, 'error', {
          params: { filter: name },
        });
        continue;
      }
      const literal = argument.match(/^"([^"]*)"$/);
      if (!literal) {
        push('liquid_filter_argument_not_allowed', start, end, 'error', {
          params: { filter: name },
        });
        continue;
      }
      // Skupina 1 existuje vždy, když regulární výraz sedl; `?? ''` je jen kvůli
      // noUncheckedIndexedAccess, chování se tím nemění.
      const value = literal[1] ?? '';
      if (name === 'date' && !(DATE_FORMAT_WHITELIST as readonly string[]).includes(value)) {
        push('liquid_date_format_not_allowed', start, end, 'error', { params: { format: value } });
      }
      if (name === 'default' && DEFAULT_VALUE_FORBIDDEN_CHARS.some((ch) => value.includes(ch))) {
        push('liquid_default_value_invalid', start, end, 'error', { params: { value } });
      }
    }
  }

  function validateTag(inner: string, start: number, end: number): void {
    const trimmed = inner.trim();
    const name = trimmed.split(/\s+/)[0] ?? '';
    const rest = trimmed.slice(name.length).trim();

    if (CLOSING_TAGS[name]) {
      const opened = stack.pop();
      if (!opened || opened.name !== CLOSING_TAGS[name]) {
        push('liquid_unbalanced_block', start, end, 'error', { params: { tag: name } });
        return;
      }
      if (opened.name === 'for') {
        forDepth -= 1;
        // Iterační proměnná platí jen uvnitř svého cyklu. Bez tohohle řádku by
        // `{{ tag }}` prošlo i za `{% endfor %}`.
        if (opened.loopVar !== undefined) roots.delete(opened.loopVar);
      } else {
        conditionDepth -= 1;
      }
      return;
    }
    if (BRANCH_TAGS.has(name)) {
      if (name === 'elsif') validateCondition(rest, start, end);
      return;
    }
    if (!BLOCK_TAGS.has(name)) {
      push('liquid_tag_not_allowed', start, end, 'error', { params: { tag: name } });
      return;
    }

    const frame: { name: string; start: number; loopVar?: string } = { name, start };
    stack.push(frame);
    if (name === 'for') {
      loops += 1;
      forDepth += 1;
      if (forDepth > 1) push('liquid_nested_for', start, end);
      const forMatch = rest.match(/^([a-z_][a-z0-9_]*)\s+in\s+(\S+)\s*(.*)$/);
      if (!forMatch) {
        push('liquid_unbalanced_block', start, end, 'error', { params: { tag: 'for' } });
        return;
      }
      // Všechny tři skupiny existují vždy, když regulární výraz sedl; `?? ''` je
      // jen kvůli noUncheckedIndexedAccess, chování se tím nemění.
      const loopVar = forMatch[1] ?? '';
      const iterable = forMatch[2] ?? '';
      const tail = (forMatch[3] ?? '').trim();
      // Iterační proměnná je kořen jen po dobu těla cyklu. Jméno se ukládá do
      // položky zásobníku, aby ho endfor uměl odebrat i u vnořených konstrukcí.
      frame.loopVar = loopVar;
      roots.add(loopVar);
      if (tail !== '') {
        push('liquid_for_parameter_not_allowed', start, end, 'error', {
          params: { param: tail.split(/[:\s]/)[0] ?? tail },
        });
      }
      validatePath(iterable, start, end);
      return;
    }
    conditionDepth += 1;
    maxConditionDepth = Math.max(maxConditionDepth, conditionDepth);
    validateCondition(rest, start, end);
  }

  function validateCondition(condition: string, start: number, end: number): void {
    if (/[()]/.test(condition)) {
      push('liquid_parentheses_not_allowed', start, end);
      return;
    }
    if (/\bcontains\b/.test(condition)) {
      push('liquid_contains_not_allowed', start, end);
      return;
    }
    if (/["']/.test(condition)) {
      push('liquid_string_literal_not_allowed', start, end);
      return;
    }
    for (const literal of UNSUPPORTED_LITERALS) {
      if (new RegExp(`\\b${literal}\\b`).test(condition)) {
        push('liquid_literal_not_supported', start, end, 'error', { params: { literal } });
      }
    }
    const operators = condition.match(/(>=|<=|==|!=|>|<)/g) ?? [];
    for (const operator of operators) {
      if (!(SUPPORTED_COMPARISON_OPERATORS as readonly string[]).includes(operator)) {
        push('liquid_comparison_operator_not_supported', start, end, 'error', {
          params: { op: operator },
        });
      }
    }
    for (const operand of condition.split(/\s+(?:and|or)\s+|\s*(?:>=|<=|==|!=|>|<)\s*/)) {
      const token = operand.trim();
      if (token === '' || /^-?\d+(\.\d+)?$/.test(token) || ['true', 'false', 'nil'].includes(token))
        continue;
      if ((UNSUPPORTED_LITERALS as readonly string[]).includes(token)) continue;
      validatePath(token, start, end);
      if (operators.length === 0 && token.startsWith('contact.')) {
        push('liquid_truthy_string_warning', start, end, 'warning', {
          params: { path: token },
          suggestion: {
            kind: 'set_visibility',
            block_id: ctx.block_id ?? '',
            field: token,
            op: 'present',
            label: 'Nastavit podmínku v panelu vlastností',
          },
        });
      }
    }
  }

  function validatePath(path: string, start: number, end: number): void {
    if (path === '') return;
    if (/[[\]]/.test(path)) {
      push('liquid_index_not_allowed', start, end);
      return;
    }
    const segments = path.split('.');
    if (segments.length > LIQUID_LIMITS.pathSegments) {
      push('liquid_path_too_deep', start, end, 'error', { params: { path } });
      return;
    }
    for (const segment of segments) {
      if (!IDENT.test(segment)) {
        push('liquid_identifier_case', start, end, 'error', {
          params: { path, suggestion: path.toLowerCase() },
        });
        return;
      }
    }
    // `split` vrací vždy aspoň jeden prvek, takže `?? ''` je jen kvůli
    // noUncheckedIndexedAccess, chování se tím nemění.
    const root = segments[0] ?? '';
    if ((INTERNAL_ROOTS as readonly string[]).includes(root) || !roots.has(root)) {
      push('liquid_unknown_root', start, end, 'error', { params: { root } });
      return;
    }
    if (root !== 'contact' || !ctx.fields) return;
    if (segments.length === 1) return;
    if (segments[1] === 'attr') {
      if (segments.length === 3 && !ctx.fields.contactAttrKeys.includes(segments[2] ?? '')) {
        push('liquid_unknown_field', start, end, 'error', { params: { path } });
      }
      return;
    }
    if (segments.length === 2 && !ctx.fields.contactFirstClass.includes(segments[1] ?? '')) {
      push('liquid_unknown_field', start, end, 'error', { params: { path } });
    }
  }
}

function splitFilters(inner: string): { expr: string; filters: string[] } {
  const parts: string[] = [];
  let quoted = false;
  let current = '';
  for (const ch of inner) {
    if (ch === '"') quoted = !quoted;
    if (ch === '|' && !quoted) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return {
    // `parts` má vždy aspoň jeden prvek, viz push nad tímhle řádkem.
    expr: parts[0] ?? '',
    filters: parts
      .slice(1)
      .map((f) => f.trim())
      .filter((f) => f !== ''),
  };
}
