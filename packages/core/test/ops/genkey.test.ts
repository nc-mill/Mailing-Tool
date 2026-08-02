import { describe, expect, it } from 'vitest';
import { generateSecretKey, rotationRunbook } from '../../src/ops/genkey';

describe('generateSecretKey', () => {
  it('vyrobí base64url bez paddingu, který se dekóduje na 32 bajtů', () => {
    const key = generateSecretKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(key, 'base64url')).toHaveLength(32);
  });

  it('dva klíče po sobě nejsou stejné', () => {
    expect(generateSecretKey()).not.toBe(generateSecretKey());
  });
});

describe('rotationRunbook', () => {
  const text = rotationRunbook(2, 'NOVYKLIC');

  it('má krok restartu VŠECH procesů před přešifrováním', () => {
    expect(text.indexOf('docker compose up -d')).toBeLessThan(
      text.indexOf('mlain rotate-credentials'),
    );
  });

  it('výslovně říká, že SECRET_KEY_PREVIOUS se neodebírá', () => {
    expect(text).toMatch(/SECRET_KEY_PREVIOUS se (nikdy )?neodebír/i);
  });

  it('obsahuje nový klíč s uvedeným key_id', () => {
    expect(text).toContain('SECRET_KEY=2:NOVYKLIC');
  });

  it('vysvětluje, proč nejde prohodit pořadí kroků 2 a 3', () => {
    expect(text).toMatch(/sender/i);
    expect(text).toMatch(/dešifrov/i);
  });
});
