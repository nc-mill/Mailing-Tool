import { describe, expect, it } from 'vitest';
import {
  ALL_REGISTERED_CODES,
  ERROR_CODES,
  ERROR_REGISTRY,
  FINDING_CODES,
  IMPORT_ROW_CODES,
  MESSAGE_CODES,
  OPERATIONAL_CODES,
  PROBLEM_CODES,
  REJECTED_CODES,
  VALIDATION_CODES,
  isRegisteredCode,
  operationalCode,
  problemCode,
  registryKey,
  typeUri,
} from '../../src/errors/registry';

describe('registr chybových kódů', () => {
  it('nemá duplicitu uvnitř žádného druhu', () => {
    for (const [kind, entries] of Object.entries(ERROR_REGISTRY)) {
      const keys = entries.map(registryKey);
      const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
      expect(duplicates, `duplicitní kódy v druhu ${kind}`).toEqual([]);
    }
  });

  it('má šest druhů, ani o jeden víc (rozhodnutí R5)', () => {
    expect(Object.keys(ERROR_REGISTRY).sort()).toEqual([
      'finding',
      'import_row',
      'message',
      'operational',
      'problem',
      'validation',
    ]);
  });

  it('má přesné počty položek v každém druhu (registr je uzavřený, uzávěr S7)', () => {
    // Exaktní čísla jsou záměr. Doménový plán kód nezakládá, takže každá změna
    // musí projít změnou plánu P01, ne commitem z jiné větve. Test zároveň
    // chrání proti opačné chybě: proti tichému ubrání kódu při refaktoru.
    expect(PROBLEM_CODES).toHaveLength(123);
    expect(FINDING_CODES).toHaveLength(18);
    expect(VALIDATION_CODES).toHaveLength(94);
    expect(MESSAGE_CODES).toHaveLength(34);
    expect(IMPORT_ROW_CODES).toHaveLength(32);
    expect(OPERATIONAL_CODES).toHaveLength(23);
    expect(ALL_REGISTERED_CODES.size).toBe(301);
  });

  it('používá lower_snake_case bez výjimky (konvence 3.11)', () => {
    for (const entries of Object.values(ERROR_REGISTRY)) {
      for (const entry of entries) {
        expect(entry.code, `${entry.code} není lower_snake_case`).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    }
  });

  it('každý problem kód má platný HTTP status a anglický title', () => {
    for (const entry of PROBLEM_CODES) {
      expect(entry.status, `${entry.code}`).toBeGreaterThanOrEqual(400);
      expect(entry.status, `${entry.code}`).toBeLessThan(600);
      expect(entry.title.length, `${entry.code} nemá title`).toBeGreaterThan(0);
      expect(entry.title, `${entry.code} má title s diakritikou`).toMatch(/^[\x20-\x7E]+$/);
    }
  });

  it('platformní kódy z části 1, kapitoly 4.2 sedí na status i opakovatelnost', () => {
    expect(problemCode('unauthenticated')).toMatchObject({ status: 401, retryable: false });
    expect(problemCode('insufficient_scope')).toMatchObject({ status: 403, retryable: false });
    expect(problemCode('idempotency_key_reuse')).toMatchObject({ status: 409, retryable: false });
    expect(problemCode('idempotency_request_in_progress')).toMatchObject({
      status: 409,
      retryable: true,
    });
    expect(problemCode('account_locked')).toMatchObject({ status: 423, retryable: true });
    expect(problemCode('rate_limited')).toMatchObject({ status: 429, retryable: true });
    expect(problemCode('migration_failed')).toMatchObject({ status: 503, retryable: false });
    expect(problemCode('dependency_timeout')).toMatchObject({ status: 504, retryable: true });
    expect(problemCode('not_implemented')).toMatchObject({ status: 501, retryable: false });
  });

  it('campaign_not_compiled je opakovatelné, protože klient spustí kompilaci a zopakuje', () => {
    expect(problemCode('campaign_not_compiled')).toMatchObject({ status: 422, retryable: true });
  });

  it('domain_* nesou retryAfterSeconds 300 kvůli DNS propagaci', () => {
    for (const code of ['domain_dkim_missing', 'domain_spf_missing', 'domain_dmarc_missing']) {
      expect(problemCode(code)).toMatchObject({ retryable: true, retryAfterSeconds: 300 });
    }
  });

  it('opakovatelný kód smí nést retry_after, neopakovatelný nikdy', () => {
    for (const entry of PROBLEM_CODES) {
      if (!entry.retryable) {
        expect(entry.retryAfterSeconds, `${entry.code} není opakovatelný`).toBeUndefined();
      }
    }
  });

  it('žádný kód, který specifikace výslovně zamítla, v registru není', () => {
    for (const rejected of REJECTED_CODES) {
      expect(
        isRegisteredCode(rejected.code),
        `${rejected.code} je zamítnutý: ${rejected.reason}`,
      ).toBe(false);
    }
  });

  it('type URI se dogeneruje podle vzorce, nikde se nevyplňuje ručně', () => {
    expect(typeUri('validation_failed')).toBe('https://docs.mlain.dev/errors/validation_failed');
  });

  it('kódy senderu mají klasifikační třídu z části 4b, kapitoly 4.2', () => {
    const byCode = new Map(MESSAGE_CODES.map((entry) => [entry.code, entry]));
    expect(byCode.get('rate_limited')?.class).toBe('retryable');
    expect(byCode.get('credentials_undecryptable')?.class).toBe('fatal');
    expect(byCode.get('message_rejected')?.class).toBe('permanent');
    expect(byCode.get('ambiguous_dispatch')?.class).toBe('contract');
  });

  it('řádkové kódy importu rozlišují chybu a varování', () => {
    const byCode = new Map(IMPORT_ROW_CODES.map((entry) => [entry.code, entry]));
    expect(byCode.get('email_invalid')?.severity).toBe('error');
    expect(byCode.get('vocative_low_confidence')?.severity).toBe('warning');
    expect(byCode.get('suppressed_skipped')?.severity).toBe('warning');
  });

  it('každá doména ze sedmi částí je v registru zastoupená', () => {
    const domains = new Set(PROBLEM_CODES.map((entry) => entry.domain));
    expect([...domains].sort()).toEqual([
      'campaigns',
      'contacts',
      'content',
      'platform',
      'sender',
      'tracking',
    ]);
  });

  it('validation kódy nekolidují s problem kódy', () => {
    const problems = new Set(PROBLEM_CODES.map((entry) => entry.code));
    const collisions = VALIDATION_CODES.map((entry) => entry.code).filter((code) =>
      problems.has(code),
    );
    expect(collisions).toEqual([]);
  });

  it('zná kódy, které si vyžádaly plány P06, P11 a P13', () => {
    for (const code of [
      // P06, test `mapa kódů na klíče`
      'already_member',
      'webhook_endpoint_disabled',
      // P13, seznam REQUIRED_ERROR_CODES
      'provider_smtp_starttls_unsupported',
      'provider_smtp_greeting_invalid',
      'contract_mismatch',
      // P11, seznamy IMPORT_ERROR_CODES a SEGMENT_ERROR_CODES
      'no_email_column_mapped',
      'file_too_large',
      'too_many_rows',
      'too_many_columns',
      'empty_file',
      'unsupported_encoding',
      'malformed_csv',
      'storage_unavailable',
      'audience_empty',
    ]) {
      expect(isRegisteredCode(code), `${code} chybí v registru`).toBe(true);
    }
  });

  it('ERROR_CODES nese jen kořenové kódy a každý má status i title', () => {
    expect(Object.keys(ERROR_CODES)).toHaveLength(PROBLEM_CODES.length);
    for (const [code, entry] of Object.entries(ERROR_CODES)) {
      expect(entry.code).toBe(code);
      expect(entry.status).toBeGreaterThanOrEqual(400);
      expect(entry.title.length).toBeGreaterThan(0);
    }
    // Validační kód nemá HTTP status, takže do téhle mapy nepatří.
    expect(ERROR_CODES['segment_cycle']).toBeUndefined();
    expect(ALL_REGISTERED_CODES.has('segment_cycle')).toBe(true);
  });
});

describe('šestý jmenný prostor, provozní a migrační kódy', () => {
  it('každý kód scope cli má exit kód a žádnou závažnost', () => {
    for (const entry of OPERATIONAL_CODES.filter((item) => item.scope === 'cli')) {
      expect(entry.exitCode, `${entry.code} nemá exit kód`).toBeTypeOf('number');
      expect(entry.severity, `${entry.code} má závažnost, což u cli nedává smysl`).toBeUndefined();
    }
  });

  it('každý nález doktoru má závažnost a žádný exit kód', () => {
    for (const entry of OPERATIONAL_CODES.filter((item) => item.scope === 'doctor')) {
      expect(['critical', 'warning', 'info'], `${entry.code} má neplatnou závažnost`).toContain(
        entry.severity,
      );
      expect(
        entry.exitCode,
        `${entry.code} má exit kód, což u nálezu nedává smysl`,
      ).toBeUndefined();
    }
  });

  it('drží exit kódy, které fixuje část 1, kapitola 3.13', () => {
    expect(operationalCode('cli', 'migration_failed').exitCode).toBe(3);
    expect(operationalCode('cli', 'major_version_skipped').exitCode).toBe(4);
    expect(operationalCode('cli', 'schema_version_ahead').exitCode).toBe(5);
    expect(operationalCode('cli', 'migration_lock_timeout').exitCode).toBe(75);
    expect(operationalCode('cli', 'config_invalid').exitCode).toBe(78);
  });

  it('zná všech čtrnáct nálezů mlain doctor a jednu izolační kontrolu', () => {
    const doctor = OPERATIONAL_CODES.filter((item) => item.scope === 'doctor').map((i) => i.code);
    for (const code of [
      'missing_key_generations',
      'secret_key_previous_empty',
      'secret_key_fingerprint_mismatch',
      'key_id_ceiling_near',
      'data_volume_empty',
      'no_backup_yet',
      'backup_stale',
      'backup_binary_missing',
      'backup_binary_version_mismatch',
      'schema_version_ahead',
      'connection_pool_over_budget',
      'trial_mode_enabled',
      'demo_data_present',
      'check_failed',
      'isolation_prerequisites_missing',
    ]) {
      expect(doctor, `nález ${code} chybí`).toContain(code);
    }
    expect(doctor).toHaveLength(15);
  });

  it('tentýž kód smí být ve víc prostorech, když má v každém význam', () => {
    // schema_version_ahead: exit kód CLI 5 a zároveň kritický nález doktoru.
    expect(operationalCode('cli', 'schema_version_ahead').exitCode).toBe(5);
    expect(operationalCode('doctor', 'schema_version_ahead').severity).toBe('critical');
    // contract_mismatch: stav zprávy pro sender i HTTP kód pro API.
    expect(MESSAGE_CODES.some((entry) => entry.code === 'contract_mismatch')).toBe(true);
    expect(problemCode('contract_mismatch').status).toBe(422);
  });
});
