import { describe, it, expect } from 'vitest';
import { generateWebhookSecret, signPayload, signatureHeader, secretToBytes } from './signature';

/** Závazný vektor ze 3.8, přepočítaný spuštěním 2026-07-31. */
const SECRET = 'whsec_AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qhqK-2vcTL0tk';
const TIMESTAMP = 1785000000;
const BODY =
  '{"id":"0192f3a0-1c2d-7e50-9a1b-2c3d4e5f6071","type":"contact.created","api_version":"v1","occurred_at":"2026-08-01T12:40:00.000Z","workspace_id":"0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071","data":{"contact_id":"0192f3a0-1c2d-7e43-8d4e-5f60718293a4"}}';
const EXPECTED = '70a890fe48498351df6249763e7c2fb36f2220fc7af3501281501963b23ddeeb';

describe('kritérium 38: podpis odpovídá vektoru bajt na bajt', () => {
  it('secret se dekóduje na 32 bajtů', () => {
    const bytes = secretToBytes(SECRET);
    expect(bytes).toHaveLength(32);
    expect(bytes.toString('hex')).toBe(
      '00070e151c232a31383f464d545b626970777e858c939aa1a8afb6bdc4cbd2d9',
    );
  });

  it('v1 se rovná hodnotě z vektoru', () => {
    expect(signPayload(SECRET, TIMESTAMP, BODY)).toBe(EXPECTED);
  });

  it('hlavička má tvar t=<unix>,v1=<hex>', () => {
    expect(signatureHeader(SECRET, TIMESTAMP, BODY)).toBe(`t=${TIMESTAMP},v1=${EXPECTED}`);
  });

  it('změna jednoho znaku v těle změní podpis', () => {
    expect(
      signPayload(SECRET, TIMESTAMP, BODY.replace('contact.created', 'contact.updated')),
    ).not.toBe(EXPECTED);
  });

  it('změna timestampu změní podpis, takže ho útočník nemůže přepsat', () => {
    expect(signPayload(SECRET, TIMESTAMP + 1, BODY)).not.toBe(EXPECTED);
  });

  it('přeházení klíčů v těle dá jiný podpis', () => {
    const reordered = JSON.stringify(JSON.parse(BODY), ['type', 'id', 'api_version']);
    expect(signPayload(SECRET, TIMESTAMP, reordered)).not.toBe(EXPECTED);
  });
});

describe('generování tajemství', () => {
  it('má prefix whsec_ a 43 znaků base64url', () => {
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(secretToBytes(secret)).toHaveLength(32);
  });

  it('dvě tajemství nejsou stejná', () => {
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });
});
