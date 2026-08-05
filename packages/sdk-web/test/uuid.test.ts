import { describe, expect, it } from 'vitest';
import { uuidv4 } from '../src/uuid';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv4', () => {
  it('vrátí platné UUID verze 4', () => {
    expect(uuidv4()).toMatch(UUID_V4_RE);
  });

  it('tisíc volání dá tisíc různých hodnot', () => {
    const values = new Set(Array.from({ length: 1000 }, () => uuidv4()));
    expect(values.size).toBe(1000);
  });

  it('funguje i bez crypto.randomUUID, jen s getRandomValues', () => {
    const original = globalThis.crypto.randomUUID;
    // @ts-expect-error dočasné odebrání kvůli testu záložní cesty
    globalThis.crypto.randomUUID = undefined;
    expect(uuidv4()).toMatch(UUID_V4_RE);
    globalThis.crypto.randomUUID = original;
  });
});
