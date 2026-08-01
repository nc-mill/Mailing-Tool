import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@mlain/core/errors';
import { AUTH_ERROR_KEYS, SETTINGS_ERROR_KEYS, errorTextKeys } from './error-keys';

describe('mapa kódů na klíče', () => {
  it('neobsahuje kód, který registr P01 nezná', () => {
    const registered = new Set(Object.keys(ERROR_CODES));
    for (const code of [...Object.keys(AUTH_ERROR_KEYS), ...Object.keys(SETTINGS_ERROR_KEYS)]) {
      expect(registered.has(code), `kód ${code} není v registru`).toBe(true);
    }
  });

  it('každý záznam má klíč nadpisu i těla a oba jsou literály', () => {
    for (const entry of [
      ...Object.values(AUTH_ERROR_KEYS),
      ...Object.values(SETTINGS_ERROR_KEYS),
    ]) {
      expect(entry.title).toMatch(/^errors\.[a-zA-Z]+\.title$/);
      expect(entry.body).toMatch(/^errors\.[a-zA-Z]+\.body$/);
    }
  });

  it('pokrývá tři kódy části 1 z mapování 10.2 části 6', () => {
    expect(SETTINGS_ERROR_KEYS).toHaveProperty('forbidden');
    expect(SETTINGS_ERROR_KEYS).toHaveProperty('session_expired');
    expect(SETTINGS_ERROR_KEYS).toHaveProperty('webhook_endpoint_disabled');
  });

  it('u známého kódu vrátí klíče', () => {
    expect(errorTextKeys(AUTH_ERROR_KEYS, 'invalid_credentials')).toEqual({
      title: 'errors.invalidCredentials.title',
      body: 'errors.invalidCredentials.body',
    });
  });

  it('u neznámého kódu vrátí undefined, aby se použil detail ze serveru', () => {
    expect(errorTextKeys(AUTH_ERROR_KEYS, 'segment_too_complex')).toBeUndefined();
  });
});
