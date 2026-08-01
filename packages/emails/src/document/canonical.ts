import { createHash } from 'node:crypto';

/**
 * Kanonická serializace: klíče lexikograficky, bez mezer, UTF-8 (2.1).
 * `JSON.stringify` s polem klíčů nestačí, protože řadí jen na jedné úrovni
 * a u vnořených objektů by pořadí zůstalo takové, v jakém klíče vznikly.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue;
      out[key] = sortValue(source[key]);
    }
    return out;
  }
  return value;
}

/** SHA-256 nad kanonickou serializací. Sloupec design_hash je bytea, proto Buffer. */
export function designHash(value: unknown): Buffer {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest();
}

export function designHashHex(value: unknown): string {
  return designHash(value).toString('hex');
}
