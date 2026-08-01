import { createHmac, timingSafeEqual } from 'node:crypto';

export type SignatureMode = 'none' | 'hmac_sha256' | 'shared_secret' | 'basic';

export type SignatureInput = {
  mode: SignatureMode;
  config: Record<string, unknown>;
  secret: string | null;
  /** Syrové tělo, bajt na bajt. Podpis se ověřuje nad ním, ne nad znovu serializovaným JSON. */
  body: Buffer;
  slug: string;
  headers: Record<string, string>;
};

export type SignatureResult =
  { ok: true } | { ok: false; reason: 'bad_signature' | 'stale_timestamp' | 'missing_secret' };

/**
 * Šablona pro HMAC je řetězec s placeholdery, například {timestamp}.{body} nebo {body}.
 * Podporované placeholdery jsou přesně tři a nic víc: žádné výrazy, žádná aritmetika.
 *
 * Odmítnuta byla varianta „malý skriptovací jazyk". Cokoliv spustitelného v payloadu
 * z internetu je zbytečné bezpečnostní riziko.
 */
export function renderTemplate(
  template: string,
  values: { body: Buffer; timestamp: string; slug: string },
): string {
  return template
    .replace('{body}', values.body.toString('utf8'))
    .replace('{timestamp}', values.timestamp)
    .replace('{slug}', values.slug);
}

/** Porovnání v konstantním čase. Délky se musí shodovat, jinak timingSafeEqual hodí výjimku. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function verifySignature(input: SignatureInput): SignatureResult {
  if (input.mode === 'none') return { ok: true };
  if (input.secret === null) return { ok: false, reason: 'missing_secret' };

  if (input.mode === 'shared_secret') {
    const header = String(input.config['header'] ?? '').toLowerCase();
    const provided = input.headers[header] ?? '';
    return safeEqual(provided, input.secret)
      ? { ok: true }
      : { ok: false, reason: 'bad_signature' };
  }

  if (input.mode === 'basic') {
    const auth = input.headers['authorization'] ?? '';
    if (!auth.startsWith('Basic ')) return { ok: false, reason: 'bad_signature' };
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    const expected = `${String(input.config['username'] ?? '')}:${input.secret}`;
    return safeEqual(decoded, expected) ? { ok: true } : { ok: false, reason: 'bad_signature' };
  }

  // hmac_sha256
  const header = String(input.config['header'] ?? '').toLowerCase();
  const provided = input.headers[header];
  if (provided === undefined) return { ok: false, reason: 'bad_signature' };

  const timestampHeader = String(input.config['timestampHeader'] ?? '').toLowerCase();
  const timestamp = timestampHeader === '' ? '' : (input.headers[timestampHeader] ?? '');

  // Ochrana proti přehrání: požadavek se odmítne, když se jeho časové razítko liší
  // o víc než tolerance. Dedup podle external_id je druhá, nezávislá vrstva.
  if (timestampHeader !== '') {
    const tolerance = Number(input.config['toleranceSeconds'] ?? 300);
    const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
    if (!Number.isFinite(age) || age > tolerance) return { ok: false, reason: 'stale_timestamp' };
  }

  const payload = renderTemplate(String(input.config['template'] ?? '{body}'), {
    body: input.body,
    timestamp,
    slug: input.slug,
  });
  const encoding = input.config['encoding'] === 'base64' ? 'base64' : 'hex';
  const expected = createHmac('sha256', input.secret).update(payload, 'utf8').digest(encoding);

  return safeEqual(provided, expected) ? { ok: true } : { ok: false, reason: 'bad_signature' };
}
