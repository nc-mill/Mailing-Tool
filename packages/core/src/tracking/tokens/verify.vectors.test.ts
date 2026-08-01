import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildTrackingKeyring } from './keyring';
import { verifyTrackingToken } from './verify';
import type { TokenErrorCode, TrackingTokenType } from '../types';

type PositiveVector = {
  id: string;
  type: TrackingTokenType;
  key_id: number;
  expected_token: string;
};
type NegativeVector = {
  id: string;
  token: string;
  endpoint_type: TrackingTokenType;
  expected_error: TokenErrorCode;
  /** Unixové sekundy. Jen u vektorů, které se vyhodnocují proti času. */
  now?: number;
  nonce_used?: boolean;
};

// Cesta jde přes exportní mapu balíčku, ne relativně: relativní cesta do cizího
// balíčku přežije přesun adresáře a přestane odpovídat tomu, co se publikuje.
const vectors = JSON.parse(
  readFileSync(
    fileURLToPath(import.meta.resolve('@mlain/contracts/fixtures/token/vectors.json')),
    'utf8',
  ),
) as { positive: PositiveVector[]; negative: NegativeVector[] };

const ring = buildTrackingKeyring({
  secretKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
  secretKeyPrevious: '',
});
const DEFAULT_NOW = new Date('2026-07-25T16:00:00Z');

/** Jediný kód, který tahle funkce vracet nesmí, protože ho řeší databáze. */
const HANDLED_ELSEWHERE: readonly TokenErrorCode[] = ['token_already_used'];

describe('token vectors from packages/contracts', () => {
  it('fixture existuje a není prázdná', () => {
    expect(vectors.positive.length).toBeGreaterThan(0);
    expect(vectors.negative.length).toBeGreaterThan(0);
  });

  it.each(vectors.positive)('pozitivní vektor $id projde', (vector) => {
    const result = verifyTrackingToken(vector.expected_token, [vector.type], {
      keyring: ring,
      now: DEFAULT_NOW,
    });
    expect(result.ok).toBe(true);
  });

  it.each(vectors.negative.filter((v) => !HANDLED_ELSEWHERE.includes(v.expected_error)))(
    'negativní vektor $id skončí kódem $expected_error',
    (vector) => {
      const result = verifyTrackingToken(vector.token, [vector.endpoint_type], {
        keyring: ring,
        now: vector.now === undefined ? DEFAULT_NOW : new Date(vector.now * 1000),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe(vector.expected_error);
    },
  );

  it('vynechává se právě jeden vektor a je to ten o jednorázovosti', () => {
    // Bez tohohle testu by filtr mohl tiše narůst a s ním by zmizelo pokrytí.
    const skipped = vectors.negative.filter((v) => HANDLED_ELSEWHERE.includes(v.expected_error));
    expect(skipped.map((v) => v.id)).toEqual(['TK-N7']);
  });
});
