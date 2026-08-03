import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  RETENTION_DEFAULTS,
  RETENTION_TARGETS,
  getHandler,
  registerHandler,
  unregisterHandler,
} from '../../retention/registry';
import { NEVER_DELETED_TABLES } from '../../retention/handlers';

describe('registr retenčních cílů', () => {
  it('sedm cílů podle tabulky ve 4.15', () => {
    expect(RETENTION_TARGETS).toEqual([
      'import_files',
      'import_errors',
      'form_submissions',
      'inbound_deliveries',
      'unconfirmed_subscriptions',
      'inactive_contacts',
      'exports',
    ]);
  });

  it('výchozí hodnoty odpovídají tabulce', () => {
    expect(RETENTION_DEFAULTS.import_files).toEqual({ days: 30, action: 'delete', enabled: true });
    expect(RETENTION_DEFAULTS.import_errors).toEqual({ days: 90, action: 'delete', enabled: true });
    expect(RETENTION_DEFAULTS.form_submissions).toEqual({
      days: 180,
      action: 'anonymize',
      enabled: true,
    });
    expect(RETENTION_DEFAULTS.inbound_deliveries).toEqual({
      days: 30,
      action: 'delete',
      enabled: true,
    });
    expect(RETENTION_DEFAULTS.unconfirmed_subscriptions).toEqual({
      days: 30,
      action: 'delete',
      enabled: true,
    });
    expect(RETENTION_DEFAULTS.exports).toEqual({ days: 7, action: 'delete', enabled: true });
    // Anonymizace neaktivních kontaktů je ve výchozím stavu VYPNUTÁ: je to
    // nevratná operace nad daty, která uživatel roky sbíral.
    expect(RETENTION_DEFAULTS.inactive_contacts.enabled).toBe(false);
  });

  it('handler pro šest cílů této domény existuje', () => {
    for (const target of [
      'import_errors',
      'form_submissions',
      'inbound_deliveries',
      'unconfirmed_subscriptions',
      'inactive_contacts',
      // Přibyl s úložištěm exportů: maže soubor archivu i řádek v `exports`.
      'exports',
    ] as const) {
      expect(getHandler(target)).toBeDefined();
    }
  });

  it('cíl import_files handler zatím nemá', () => {
    expect(getHandler('import_files')).toBeUndefined();
  });

  it('registrace doplní handler bez zásahu do registru', () => {
    const handler = async () => ({ scanned: 0, affected: 0 });
    registerHandler('import_files', handler);
    expect(getHandler('import_files')).toBe(handler);
    unregisterHandler('import_files');
    expect(getHandler('import_files')).toBeUndefined();
  });
});

describe('pojistky', () => {
  it('KRITÉRIUM 71: consents a suppressions retence nikdy nemaže', () => {
    expect(NEVER_DELETED_TABLES).toContain('consents');
    expect(NEVER_DELETED_TABLES).toContain('suppressions');
  });

  it('žádný handler nesahá na chráněné tabulky', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../retention/handlers.ts', import.meta.url)),
      'utf8',
    );
    for (const table of NEVER_DELETED_TABLES) {
      expect(source).not.toMatch(new RegExp(`DELETE\\s+FROM\\s+${table}`, 'i'));
      expect(source).not.toMatch(new RegExp(`UPDATE\\s+${table}`, 'i'));
    }
  });

  it('handlery dostávají kontext projektu, ne holý handle', () => {
    // Bez kontextu by politika ws_isolation odřízla každý DELETE a job by tiše
    // hlásil úspěch nad nula smazanými řádky.
    const source = readFileSync(
      fileURLToPath(new URL('../../retention/handlers.ts', import.meta.url)),
      'utf8',
    );
    expect(source).toContain('withWorkspace');
    expect(source).toMatch(/ctx\.workspaceId/);
  });
});
