/**
 * Minimální gramatika přístupové cesty: $ je kořen, .klíč je vlastnost, [n] je index pole.
 * Nic víc. Žádné wildcardy, žádné filtry, žádné výrazy, žádný eval.
 *
 * Odmítnuta byla knihovna jsonpath-plus: pro mapování příchozích webhooků je zbytečně
 * mocná a je to čtyřicet řádků kódu bez závislosti a bez rizika, že někdo pošle výraz
 * s vedlejším účinkem.
 *
 * Neexistující cesta vrací null, nikdy výjimku: payload z cizího systému se mění
 * a jedno chybějící pole nesmí shodit zpracování celé dávky.
 */
const SEGMENT = /^([a-zA-Z_][a-zA-Z0-9_]*)((\[\d+\])*)$/;

/** Klíče, které by mohly vést k prototypovému znečištění. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function readPath(root: unknown, path: string): unknown {
  if (path === '$') return root;
  if (!path.startsWith('$.')) return null;

  let current: unknown = root;
  for (const rawSegment of path.slice(2).split('.')) {
    const matched = rawSegment.match(SEGMENT);
    if (matched === null) return null;

    const key = matched[1] ?? '';
    if (FORBIDDEN_KEYS.has(key)) return null;
    if (typeof current !== 'object' || current === null) return null;
    if (!Object.prototype.hasOwnProperty.call(current, key)) return null;

    current = (current as Record<string, unknown>)[key];

    // Indexy pole, může jich být víc za sebou.
    const indexes = (matched[2] ?? '').match(/\d+/g) ?? [];
    for (const index of indexes) {
      if (!Array.isArray(current)) return null;
      current = current[Number(index)];
      if (current === undefined) return null;
    }
  }

  return current ?? null;
}
