import { describe, it, expect } from 'vitest';
import { redactMetadata, diffForAudit, SENSITIVE_KEYS } from './redact';

describe('redakce metadat', () => {
  it('zakryje hodnoty citlivých klíčů', () => {
    const out = redactMetadata({ name: 'Petr', password: 'tajne', api_key: 'ml_live_x' });
    expect(out).toEqual({ name: 'Petr', password: '[redacted]', api_key: '[redacted]' });
  });

  it('funguje i do hloubky', () => {
    const out = redactMetadata({ after: { secret_access_key: 'aws', region: 'eu-central-1' } });
    expect(out).toEqual({ after: { secret_access_key: '[redacted]', region: 'eu-central-1' } });
  });

  it('zakryje i klíč, který citlivé slovo jen obsahuje', () => {
    expect(redactMetadata({ webhook_secret: 'whsec_x' })).toEqual({ webhook_secret: '[redacted]' });
  });

  it('seznam citlivých klíčů odpovídá 3.7 a 4.1', () => {
    expect(SENSITIVE_KEYS).toContain('password');
    expect(SENSITIVE_KEYS).toContain('secret');
    expect(SENSITIVE_KEYS).toContain('token');
    expect(SENSITIVE_KEYS).toContain('api_key');
    expect(SENSITIVE_KEYS).toContain('secret_access_key');
    expect(SENSITIVE_KEYS).toContain('render_data');
  });

  it('pole se prochází taky', () => {
    expect(redactMetadata({ items: [{ token: 't', id: 1 }] })).toEqual({
      items: [{ token: '[redacted]', id: 1 }],
    });
  });
});

describe('diffForAudit', () => {
  it('zapíše jen změněná pole a jejich hodnoty před a po', () => {
    const out = diffForAudit({ name: 'A', locale: 'cs' }, { name: 'B', locale: 'cs' });
    expect(out).toEqual({ changed: ['name'], before: { name: 'A' }, after: { name: 'B' } });
  });

  it('u beze změny vrátí prázdný seznam', () => {
    expect(diffForAudit({ name: 'A' }, { name: 'A' })).toEqual({
      changed: [],
      before: {},
      after: {},
    });
  });

  it('citlivé hodnoty jsou v diffu zakryté', () => {
    const out = diffForAudit({ password: 'a' }, { password: 'b' });
    expect(out.before.password).toBe('[redacted]');
    expect(out.after.password).toBe('[redacted]');
  });

  it('nově přidané pole se počítá jako změna', () => {
    const out = diffForAudit({}, { locale: 'en' });
    expect(out.changed).toEqual(['locale']);
  });
});
