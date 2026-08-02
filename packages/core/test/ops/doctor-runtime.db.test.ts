import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from '../support/db';
import { runtimeChecks } from '../../src/ops/doctor/checks-runtime';
import { workspaceChecks } from '../../src/ops/doctor/checks-workspace';
import { runDoctor } from '../../src/ops/doctor/run';
import type { DoctorContext, DoctorFinding } from '../../src/ops/doctor/types';

const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
let pg: TestPostgres;

const ctx = (over: Partial<DoctorContext> = {}): DoctorContext => ({
  appUrl: pg.urlForRole('mlain_app'),
  adminUrl: pg.ownerUrl,
  dataDir: '/tmp',
  backupDir: '/tmp',
  uploadsDir: '/tmp',
  secretKey: KEY,
  secretKeyPrevious: '',
  imageVersion: '1.0.0',
  now: new Date('2026-07-31T12:00:00.000Z'),
  ...over,
});

const run = async (
  checks: readonly ((c: DoctorContext) => Promise<DoctorFinding[]>)[],
  context: DoctorContext = ctx(),
): Promise<DoctorFinding[]> => (await Promise.all(checks.map((c) => c(context)))).flat();

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.seedMinimalInstallation({ contacts: 2 });
}, 180_000);

beforeEach(async () => {
  await pg.sql(`UPDATE workspaces SET settings = '{}'::jsonb`);
});

afterAll(async () => {
  await pg?.stop();
});

describe('runtimeChecks', () => {
  it('schema_version vyšší, než image zná, je kritické', async () => {
    await pg.sql('UPDATE system_settings SET schema_version = 999999');
    const findings = await run(runtimeChecks);
    const f = findings.find((x) => x.id === 'schema_version_ahead');
    expect(f?.severity).toBe('critical');
    await pg.sql('UPDATE system_settings SET schema_version = 1');
  });

  it('shodná verze schématu nic nehlásí', async () => {
    const findings = await run(runtimeChecks);
    expect(findings.find((x) => x.id === 'schema_version_ahead')).toBeUndefined();
  });

  it('při dostatečném max_connections rozpočet spojení nehlásí', async () => {
    // ODCHYLKA OD PLÁNU. Plán tu měl opačný případ přes
    // `ALTER SYSTEM SET max_connections = 20`. Ten příkaz smí jen superuživatel
    // a hlavně se projeví až po restartu serveru, takže by `current_setting`
    // uvnitř téhož běhu vrátil pořád starou hodnotu a test by nikdy nespadl
    // z toho důvodu, ze kterého by měl. Sdílený server má max_connections 200
    // a součet poolů je 28, takže se ověřuje strana, kterou ověřit jde.
    const findings = await run(runtimeChecks);
    expect(findings.find((x) => x.id === 'connection_pool_over_budget')).toBeUndefined();
  });

  it('pod mlain_app nehlásí, že by izolace neplatila', async () => {
    // mlain_app schéma nevlastní a nemá BYPASSRLS, takže je všechno v pořádku.
    const findings = await run(runtimeChecks);
    expect(findings.find((x) => x.id === 'isolation_prerequisites_missing')).toBeUndefined();
  });

  it('pod migrátorem hlásí, že projekty NEJSOU izolované', async () => {
    // Migrátor vlastní schéma, takže se na něj RLS neuplatní. Kdyby někdo
    // nastavil DATABASE_URL na migrátora (u managed databáze s jedinou rolí
    // je to nejsnazší cesta k rozchození), aplikace by se rozeběhla úplně
    // normálně a projekty by přestaly být oddělené, aniž by cokoli selhalo.
    const findings = await run(runtimeChecks, ctx({ appUrl: pg.ownerUrl }));
    const f = findings.find((x) => x.id === 'isolation_prerequisites_missing');
    expect(f?.severity).toBe('critical');
    expect(f?.detail).toContain('vlastní schéma');
  });
});

describe('workspaceChecks', () => {
  it('zapnutý zkušební režim hlásí jako informaci', async () => {
    await pg.sql(`UPDATE workspaces SET settings = '{"trialMode":{"enabled":true}}'::jsonb`);
    const findings = await run(workspaceChecks);
    const f = findings.find((x) => x.id === 'trial_mode_enabled');
    expect(f?.severity).toBe('info');
  });

  it('přítomnost ukázkových dat hlásí jako informaci', async () => {
    await pg.sql(
      `UPDATE workspaces SET settings = '{"demoData":{"version":1,"contactIds":["a"]}}'::jsonb`,
    );
    const findings = await run(workspaceChecks);
    expect(findings.find((x) => x.id === 'demo_data_present')?.severity).toBe('info');
  });

  it('čistý projekt nehlásí nic', async () => {
    expect(await run(workspaceChecks)).toEqual([]);
  });

  it('nehlásí čistý projekt, když jen nemá jak se zeptat', async () => {
    // Bez migrátora vrací loadWorkspaces prázdno, což vypadá stejně jako
    // „žádný projekt nemá ukázková data". Rozdíl musí být ve výstupu vidět.
    const findings = await run(workspaceChecks, ctx({ adminUrl: null }));
    expect(findings.find((x) => x.id === 'check_failed')).toBeDefined();
  });
});

describe('runDoctor', () => {
  it('spojí všechny kontroly a nikdy nespadne na jedné selhané', async () => {
    const report = await runDoctor(
      ctx({ dataDir: '/cesta/ktera/neexistuje', backupDir: '/cesta/ktera/neexistuje' }),
    );
    expect(Array.isArray(report.findings)).toBe(true);
  });

  it('selhání jedné kontroly hlásí jako vlastní nález, ne jako pád příkazu', async () => {
    const report = await runDoctor(
      ctx({ appUrl: 'postgres://nikdo:nic@127.0.0.1:1/nic', adminUrl: null }),
    );
    expect(report.findings.some((f) => f.id === 'check_failed')).toBe(true);
  });
});
