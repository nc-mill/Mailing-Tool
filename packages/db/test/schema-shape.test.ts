import { describe, expect, it } from 'vitest';
import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../src/schema/index';
import * as identity from '../src/schema/identity';
import * as platform from '../src/schema/platform';
import * as contactsSchema from '../src/schema/contacts';
import * as content from '../src/schema/content';
import * as campaignsSchema from '../src/schema/campaigns';
import * as tracking from '../src/schema/tracking';
import * as partitioned from '../src/schema/partitioned';
import * as rootExport from '../src/index';

function tablesOf(mod: Record<string, unknown>): PgTable[] {
  return Object.values(mod).filter((value): value is PgTable => is(value, PgTable));
}
function namesOf(mod: Record<string, unknown>): string[] {
  return tablesOf(mod)
    .map((table) => getTableConfig(table).name)
    .sort();
}

describe('tvar schématu', () => {
  it('schéma obsahuje přesně 75 tabulek', () => {
    expect(tablesOf(schema)).toHaveLength(75);
  });

  it('každý název tabulky je snake_case', () => {
    for (const table of tablesOf(schema)) {
      const name = getTableConfig(table).name;
      expect(name, `tabulka ${name} porušuje snake_case`).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('rozdělení tabulek po doménách odpovídá registru v plánu', () => {
    expect(namesOf(identity)).toEqual([
      'api_keys',
      'invitations',
      'memberships',
      'password_reset_tokens',
      'sessions',
      'users',
      'workspaces',
    ]);
    expect(namesOf(platform)).toEqual([
      'idempotency_keys',
      'rate_limits',
      'secret_key_generations',
      'system_settings',
      'webhook_endpoints',
    ]);
    expect(namesOf(contactsSchema)).toHaveLength(23);
    expect(namesOf(content)).toHaveLength(12);
    expect(namesOf(campaignsSchema)).toHaveLength(8);
    expect(namesOf(tracking)).toHaveLength(11);
    expect(namesOf(partitioned)).toEqual([
      'audit_log',
      'inbound_deliveries',
      'message_engagement',
      'message_events',
      'messages',
      'provider_event_receipts',
      'web_events',
      'webhook_deliveries',
      'webhook_events',
    ]);
  });

  it('žádná tabulka se nejmenuje campaign_conversion_stats (MVP 2, nezakládá se)', () => {
    expect(namesOf(schema)).not.toContain('campaign_conversion_stats');
  });
});

describe('kořenový export balíčku', () => {
  it('nevystavuje unsafeWorkspaceContext', () => {
    expect(
      Object.keys(rootExport),
      'unsafeWorkspaceContext patří výhradně do @mlain/db/unsafe-context',
    ).not.toContain('unsafeWorkspaceContext');
  });

  it('vystavuje všechny čtyři transakční obálky, pgErrorCode a kontrolu předpokladů', () => {
    // withoutContext tu MUSÍ být: bez něj si každý volající, který nemá
    // aktéra (přihlášení, rate limiting, start aplikace), vyrobí vlastní
    // obcházku a ta nebude mít ani úklid rozbitého spojení.
    for (const name of [
      'withWorkspace',
      'withUser',
      'withReadOnly',
      'withoutContext',
      'pgErrorCode',
      'checkIsolationPrerequisites',
    ]) {
      expect(Object.keys(rootExport)).toContain(name);
    }
  });

  it('nereexportuje schema, to jde výhradně podcestou @mlain/db/schema', () => {
    // Rozhodnutí R37. Dvě rovnocenné cesty k témuž znamenají, že si každý plán
    // vybere jinou, a „jeden zjevný způsob" přestane platit v okamžiku,
    // kdy vznikne druhý.
    expect(
      Object.keys(rootExport),
      'schema patří výhradně do podcesty @mlain/db/schema',
    ).not.toContain('schema');
  });
});
