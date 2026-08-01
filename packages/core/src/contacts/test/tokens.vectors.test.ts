import { describe, expect, it } from 'vitest';

// Testovací SECRET_KEY z 3.10 části 1. Je to zveřejněný testovací klíč, ne tajemství,
// a je to táž hodnota, pod kterou P02 generoval fixtures/token/vectors.json.
process.env['SECRET_KEY'] = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

const { readPublicToken } = await import('../tokens');

const UNSUB =
  't1dQEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2BxggGS86AcLX5DjU5fYHGCk6QBkvOgHC1-RY9gcYKTpLXGamTdgE4PEWHmqWZZuZDCD6L2SMw';
const UNSUB_GLOBAL =
  't1dQEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2BxggGS86AcLX5DjU5fYHGCk6QAAAAAAAAAAAAAAAAAAAAAamTdgLfjJDF8FrY9mr1K2TawYXw';
const OPEN = 't1bwEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2Bxgmpk3YDUjmcTwPYu1Q9cpqmSPs4g';

describe('zmrazené vektory kontraktu 4.10.3', () => {
  it('odhlašovací token na seznam nese list_id seznamu', () => {
    const result = readPublicToken(UNSUB, '/u/**');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.contactId).toBe('0192f3a0-1c2d-7e43-8d4e-5f60718293a4');
    expect(result.data.listId).toBe('0192f3a0-1c2d-7e45-8f60-718293a4b5c6');
  });

  it('globální odhlašovací token vrací listId null', () => {
    const result = readPublicToken(UNSUB_GLOBAL, '/u/**');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.listId).toBeNull();
  });

  it('token pro otevření na odhlašovacím endpointu neprojde', () => {
    expect(readPublicToken(OPEN, '/u/**')).toEqual({ ok: false, code: 'token_type_mismatch' });
  });

  it('token s poškozeným posledním znakem neprojde', () => {
    const broken = `${UNSUB.slice(0, -1)}${UNSUB.endsWith('w') ? 'x' : 'w'}`;
    expect(readPublicToken(broken, '/u/**').ok).toBe(false);
  });
});
