import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTION_KEYS, auditActionKey, isKnownAuditAction } from './audit-actions';

const MESSAGES_DIR = path.resolve(import.meta.dirname, '../../../../../packages/i18n/messages');

function catalog(locale: 'cs' | 'en'): Record<string, unknown> {
  const parsed: unknown = JSON.parse(
    readFileSync(path.join(MESSAGES_DIR, locale, 'settings.json'), 'utf8'),
  );
  return (parsed as { audit: { actions: Record<string, unknown> } }).audit.actions;
}

describe('mapa auditních akcí', () => {
  // Dvacet osm, ne dvacet šest: přibyla `member.created` (člen založený správcem
  // rovnou s heslem, bez pozvánky e-mailem) a `user.deleted` (smazání účtu
  // z rozhraní, které dřív neexistovalo vůbec).
  it('pokrývá všech dvacet osm akcí části 1 z tabulky 3.7', () => {
    expect(Object.keys(AUDIT_ACTION_KEYS)).toHaveLength(28);
  });

  it('každá akce má text v obou jazycích', () => {
    const cs = catalog('cs');
    const en = catalog('en');
    for (const action of Object.keys(AUDIT_ACTION_KEYS)) {
      expect(cs, `cs postrádá ${action}`).toHaveProperty(action);
      expect(en, `en postrádá ${action}`).toHaveProperty(action);
    }
  });

  it('u známé akce vrátí klíč, u cizí undefined', () => {
    expect(auditActionKey('api_key.created')).toBe('audit.actions.api_key.created');
    expect(auditActionKey('contacts.imported')).toBeUndefined();
    expect(isKnownAuditAction('member.invited')).toBe(true);
    expect(isKnownAuditAction('campaign.sent')).toBe(false);
  });

  it('názvy akcí odpovídají konvenci entita.sloveso v minulém čase', () => {
    for (const action of Object.keys(AUDIT_ACTION_KEYS)) {
      expect(action).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });
});
