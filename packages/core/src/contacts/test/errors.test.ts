import { describe, expect, it } from 'vitest';
import { CONTACTS_ERROR_CODES, CONTACTS_FIELD_ERROR_CODES } from '../errors';
import { CONTACTS_AUDIT_ACTIONS } from '../audit';

describe('registr chybových kódů domény kontaktů', () => {
  it('každý kód je lower_snake_case', () => {
    for (const code of Object.keys(CONTACTS_ERROR_CODES)) {
      expect(code).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('žádný kód se neopakuje mezi kořenovými a polními kódy', () => {
    const root = new Set<string>(Object.keys(CONTACTS_ERROR_CODES));
    const overlap = CONTACTS_FIELD_ERROR_CODES.filter((c) => root.has(c));
    expect(overlap).toEqual([]);
  });

  it('každý kořenový kód má HTTP status a příznak opakovatelnosti', () => {
    for (const [code, meta] of Object.entries(CONTACTS_ERROR_CODES)) {
      expect(meta.status, code).toBeGreaterThanOrEqual(400);
      expect(typeof meta.retryable, code).toBe('boolean');
      expect(meta.title, code).toMatch(/^[A-Z]/);
    }
  });

  it('obsahuje kódy, na kterých stojí doménová pravidla', () => {
    expect(CONTACTS_ERROR_CODES).toHaveProperty('subscribe_blocked_complaint');
    expect(CONTACTS_ERROR_CODES).toHaveProperty('suppression_not_removable');
    expect(CONTACTS_ERROR_CODES).toHaveProperty('suppression_too_recent');
    expect(CONTACTS_ERROR_CODES).toHaveProperty('gdpr_not_verified');
    expect(CONTACTS_ERROR_CODES).toHaveProperty('field_type_immutable');
  });
});

describe('registr auditních akcí domény kontaktů', () => {
  it('každá akce má tvar entita.sloveso_v_minulem_case', () => {
    for (const action of CONTACTS_AUDIT_ACTIONS) {
      expect(action).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it('obsahuje akce vyjmenované v kapitole 7.5 části 2', () => {
    for (const expected of [
      'contact.created',
      'contact.anonymized',
      'contact.vocative_lock_released',
      'suppression.reason_promoted',
      'gdpr.request_completed',
      'name_override.created',
    ]) {
      expect(CONTACTS_AUDIT_ACTIONS).toContain(expected);
    }
  });

  it('žádná akce se neopakuje', () => {
    expect(new Set(CONTACTS_AUDIT_ACTIONS).size).toBe(CONTACTS_AUDIT_ACTIONS.length);
  });
});
