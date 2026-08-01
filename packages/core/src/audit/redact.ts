/**
 * 3.7: do metadata se nesmí dostat hesla, tokeny, sekrety klíčů, obsah e-mailů
 * ani celé seznamy kontaktů. Zapisují se rozdíly u konfiguračních změn s redakcí
 * podle seznamu citlivých klíčů.
 */
export const SENSITIVE_KEYS = [
  'password',
  'password_hash',
  'secret',
  'secret_hash',
  'secret_access_key',
  'access_key_id',
  'token',
  'token_hash',
  'api_key',
  'credentials',
  'config_encrypted',
  'secret_encrypted',
  'render_data',
  'authorization',
  'cookie',
] as const;

export const REDACTED = '[redacted]';

function isSensitive(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some((s) => lower.includes(s));
}

export function redactMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactMetadata);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitive(key) ? REDACTED : redactMetadata(inner);
  }
  return out;
}

export type AuditDiff = {
  changed: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

/**
 * Jedno pole projde stejnou redakcí jako celý objekt. Musí se to dělat přes
 * jednoprvkový objekt, protože o redakci rozhoduje JMÉNO klíče, ne hodnota:
 * `redactMetadata('tajne')` sama o sobě neví, že jde o heslo.
 */
function redactField(key: string, value: unknown): unknown {
  return (redactMetadata({ [key]: value }) as Record<string, unknown>)[key];
}

/** Tvar z 3.7: { changed: [...], before: {...}, after: {...} }. */
export function diffForAudit(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): AuditDiff {
  const changed: string[] = [];
  const beforeOut: Record<string, unknown> = {};
  const afterOut: Record<string, unknown> = {};

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    changed.push(key);
    beforeOut[key] = redactField(key, before[key]);
    afterOut[key] = redactField(key, after[key]);
  }

  changed.sort();
  return { changed, before: beforeOut, after: afterOut };
}
