/**
 * Ořez vlastností události, viz plán P10 Task 23.
 *
 * OŘEZ NESMÍ BÝT TICHÝ. Kdo posílá do košíkové události čtyřicet vlastností
 * nebo strukturu o čtyřech úrovních, dostane osekaná data; když se to nikde
 * neohlásí, projeví se to až tím, že mu v segmentu chybí kontakty, a hledá
 * se to týdny.
 *
 * Události s ořezanými vlastnostmi jsou započítané v `accepted`, ne
 * v `rejected`: uložily se, jen ne celé. Zahodit událost kvůli jedné dlouhé
 * hodnotě by byla horší škoda.
 */

export type PropertyLimits = { maxKeys: number; maxDepth: number; maxString: number };

export type Finding = {
  code: string;
  severity: 'warning';
  message: string;
  params?: Record<string, unknown>;
};

export type SanitizeResult = {
  value: Record<string, unknown>;
  findings: Finding[];
};

/** Není konfigurovatelná, souvisí s čitelností klíče ve filtrech rozhraní. */
const MAX_KEY_LENGTH = 64;
const SAMPLE_SIZE = 5;

export function sanitizeProperties(
  input: Record<string, unknown>,
  limits: PropertyLimits,
): SanitizeResult {
  const findings: Finding[] = [];
  const dropped: string[] = [];

  const keptKeys = Object.keys(input)
    .filter((key) => {
      if (key.length > MAX_KEY_LENGTH) {
        dropped.push(key);
        return false;
      }
      return true;
    })
    .sort();

  // Přebytečné klíče se zahazují abecedně od konce, aby byl výsledek deterministický.
  const overflow = keptKeys.slice(limits.maxKeys);
  dropped.push(...overflow);
  const finalKeys = keptKeys.slice(0, limits.maxKeys);

  if (dropped.length > 0) {
    findings.push({
      code: 'tracking_properties_keys_dropped',
      severity: 'warning',
      message: 'Událost měla víc vlastností, než se ukládá.',
      params: {
        dropped: dropped.length,
        limit: limits.maxKeys,
        keys: dropped.slice(0, SAMPLE_SIZE),
      },
    });
  }

  const value: Record<string, unknown> = {};
  for (const key of finalKeys) {
    value[key] = walk(input[key], key, 1, limits, findings);
  }

  return { value, findings };
}

function walk(
  node: unknown,
  path: string,
  depth: number,
  limits: PropertyLimits,
  findings: Finding[],
): unknown {
  if (typeof node === 'string') {
    if (node.length <= limits.maxString) return node;
    findings.push({
      code: 'tracking_properties_value_truncated',
      severity: 'warning',
      message: 'Hodnota vlastnosti byla zkrácena.',
      params: { key: path, limit: limits.maxString, original_length: node.length },
    });
    return node.slice(0, limits.maxString);
  }

  if (node === null || typeof node !== 'object') return node;

  if (depth >= limits.maxDepth) {
    findings.push({
      code: 'tracking_properties_depth_truncated',
      severity: 'warning',
      message: 'Vlastnost je zanořená hlouběji, než se ukládá.',
      params: { key: path, limit: limits.maxDepth },
    });
    return null;
  }

  if (Array.isArray(node)) {
    return node.map((item, index) => walk(item, `${path}.${index}`, depth + 1, limits, findings));
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
    if (key.length > MAX_KEY_LENGTH) continue;
    out[key] = walk(child, `${path}.${key}`, depth + 1, limits, findings);
  }
  return out;
}
