import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from '../support/db';
import { keyringChecks } from '../../src/ops/doctor/checks-keyring';
import type { DoctorContext } from '../../src/ops/doctor/types';

const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
let pg: TestPostgres;

const ctx = (over: Partial<DoctorContext> = {}): DoctorContext => ({
  // Pozor na obě URL. `appUrl` je aplikační role, `adminUrl` migrátor.
  // Kdyby kontroly četly data z appUrl, vracely by nula řádků a celý tenhle
  // soubor by svítil zeleně nad instalací, které chybí klíč. Test
  // „pod aplikační rolí nemlčí" níž na to je.
  appUrl: pg.urlForRole('mlain_app'),
  adminUrl: pg.ownerUrl,
  dataDir: '/data',
  backupDir: '/data/backups',
  uploadsDir: '/data/uploads',
  secretKey: KEY,
  secretKeyPrevious: '',
  imageVersion: '1.0.0',
  now: new Date('2026-07-31T12:00:00.000Z'),
  ...over,
});

const runAll = async (c: DoctorContext) =>
  (await Promise.all(keyringChecks.map((check) => check(c)))).flat();

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.seedMinimalInstallation({ contacts: 3 });
}, 180_000);

beforeEach(async () => {
  await pg.sql('DELETE FROM suppressions');
  await pg.sql('DELETE FROM gdpr_requests');
  await pg.sql(`UPDATE system_settings SET secret_key_fingerprint = 'VXGoNjoPSBY'`);
});

afterAll(async () => {
  await pg?.stop();
});

const addSuppression = (keyId: number) =>
  pg.sql(
    `INSERT INTO suppressions (workspace_id, email, reason, source, fingerprint, fingerprint_key_id)
     SELECT id, 'x${keyId}@example.com', 'hard_bounce', 'ses_event',
            decode(repeat('ab', 16), 'hex'), ${keyId}
       FROM workspaces LIMIT 1`,
  );

/** Druhý zdroj pokolení v datech. Otisk subjektu u žádosti podle GDPR. */
const addGdprRequest = (keyId: number) =>
  pg.sql(
    `INSERT INTO gdpr_requests (workspace_id, subject_email_fingerprint,
                                subject_email_fingerprint_key_id, type, status, channel,
                                requested_at, due_at)
     SELECT id, decode(repeat('cd', 16), 'hex'), ${keyId}, 'erasure', 'completed', 'admin',
            now(), now() + interval '1 month'
       FROM workspaces LIMIT 1`,
  );

describe('kontrola chybějících pokolení klíče', () => {
  it('u prázdného suppression listu nic nehlásí', async () => {
    const findings = await runAll(ctx());
    expect(findings.filter((f) => f.severity === 'critical')).toEqual([]);
  });

  it('chybějící staré pokolení hlásí jako KRITICKÉ, ne jako doporučení', async () => {
    await addSuppression(1);
    await addSuppression(2);
    const findings = await runAll(ctx({ secretKey: `3:${KEY}`, secretKeyPrevious: `2:${KEY}` }));
    const f = findings.find((x) => x.id === 'missing_key_generations');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('critical');
    expect(f!.title).toContain('1');
  });

  it('nehlásí nic, když instalace zná všechna pokolení z dat', async () => {
    await addSuppression(1);
    await addSuppression(2);
    const findings = await runAll(ctx({ secretKey: `2:${KEY}`, secretKeyPrevious: `1:${KEY}` }));
    expect(findings.find((x) => x.id === 'missing_key_generations')).toBeUndefined();
  });

  it('prázdné SECRET_KEY_PREVIOUS při neprázdném suppression listu je KRITICKÉ', async () => {
    await addSuppression(1);
    const findings = await runAll(ctx({ secretKey: `2:${KEY}`, secretKeyPrevious: '' }));
    const f = findings.find((x) => x.id === 'secret_key_previous_empty');
    expect(f?.severity).toBe('critical');
  });

  it('neshodu otisku proti system_settings hlásí jako KRITICKÉ', async () => {
    await pg.sql(`UPDATE system_settings SET secret_key_fingerprint = 'jinyOtisk1'`);
    const findings = await runAll(ctx());
    const f = findings.find((x) => x.id === 'secret_key_fingerprint_mismatch');
    expect(f?.severity).toBe('critical');
    expect(f?.action).toContain('SECRET_KEY');
  });

  it('blížící se strop pokolení hlásí jako varování od hodnoty 200', async () => {
    const previous = Array.from({ length: 5 }, (_, i) => `${195 + i}:${KEY}`).join(',');
    const findings = await runAll(ctx({ secretKey: `200:${KEY}`, secretKeyPrevious: previous }));
    expect(findings.find((x) => x.id === 'key_id_ceiling_near')?.severity).toBe('warning');
  });

  it('hláška o chybějícím pokolení říká, že otisky nejdou přepočítat', async () => {
    await addSuppression(1);
    const findings = await runAll(ctx({ secretKey: `2:${KEY}`, secretKeyPrevious: '' }));
    const text = findings.map((f) => `${f.detail} ${f.action}`).join(' ');
    expect(text).toMatch(/nejdou přepočítat|nelze přepočítat/i);
  });

  it('najde pokolení, které je JEN v gdpr_requests', async () => {
    // Druhý a poslední zdroj pokolení v datech. Instalace, která ztratila klíč
    // použitý výhradně u výmazů podle GDPR, by jinak prošla jako zdravá,
    // přestože nedokáže ověřit ani jeden vymazaný subjekt.
    await addGdprRequest(4);
    const findings = await runAll(ctx({ secretKey: `5:${KEY}`, secretKeyPrevious: '' }));
    const f = findings.find((x) => x.id === 'missing_key_generations');
    expect(f?.severity).toBe('critical');
    expect(f!.title).toContain('4');
  });
});

describe('kontrola se nesmí tvářit, že je vše v pořádku, když se nezeptala', () => {
  // Tenhle blok je obrana proti nejtišší vadě celého plánu. Obě situace
  // vypadají ve výstupu úplně stejně jako zdravá instalace.

  it('pod aplikační rolí NEMLČÍ, i když by dotaz vrátil nula řádků', async () => {
    // Ověřeno spuštěním: pod mlain_app bez kontextu projektu vrací
    // SELECT nad suppressions nula řádků, exit 0 a žádnou chybu.
    // Kdyby kontrola tuhle roli přijala, ohlásila by „žádné chybějící
    // pokolení" u instalace, které chybí klíč.
    await addSuppression(1);
    const findings = await runAll(
      ctx({ adminUrl: pg.urlForRole('mlain_app'), secretKey: `2:${KEY}`, secretKeyPrevious: '' }),
    );
    expect(findings.find((x) => x.id === 'check_failed')).toBeDefined();
    expect(findings.find((x) => x.id === 'missing_key_generations')).toBeUndefined();
  });

  it('bez DATABASE_URL_MIGRATOR vrátí check_failed, ne prázdný seznam', async () => {
    const findings = await runAll(ctx({ adminUrl: null }));
    const f = findings.find((x) => x.id === 'check_failed');
    expect(f?.severity).toBe('warning');
    expect(f?.detail).toContain('nezjištěno');
  });
});
