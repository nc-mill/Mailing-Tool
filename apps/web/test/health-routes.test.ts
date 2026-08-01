import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/runtime', () => ({
  getConfig: () => ({
    MODE: 'web',
    IMAGE_VERSION: '1.2.3',
    DATA_DIR: process.cwd(),
    DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none',
    DATABASE_STATEMENT_TIMEOUT_MS: 2000,
  }),
  getLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
  EXPECTED_SCHEMA_VERSION: 0,
}));

describe('GET /api/health', () => {
  it('vrátí 200 se stavem, režimem a neprázdnou verzí (kritérium 7e)', async () => {
    const { GET } = await import('../src/app/api/health/route');
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ status: 'ok', mode: 'web', version: '1.2.3' });
    expect(String(body['version']).length).toBeGreaterThan(0);
  });
});

describe('konfigurace testů apps/web', () => {
  // Tenhle test leží ve `test/`, tedy uvnitř STARÉHO vzoru, schválně: musí se
  // spustit i tehdy, když se kvůli špatnému `include` nespustí nic jiného.
  // Je to jediná pojistka proti zeleně nepravdivé sérii, protože všechny
  // ostatní testy apps/web píšou P05, P06 a P12 vedle zdroje.
  //
  // Neptá se plánu ani zdrojáku, ale ŽIVÉ konfigurace: naimportuje ji a ověří
  // fakta, na kterých běh stojí.
  it('vzor souborů zahrnuje testy vedle zdroje, ne jen adresář test/', async () => {
    const config = (await import('../vitest.config')).default;
    const include = config.test?.include ?? [];
    expect(
      include.some((pattern: string) => pattern.startsWith('src/')),
      'bez src/ ve vzoru se testy P05, P06 a P12 nespustí a série přesto skončí nulou',
    ).toBe(true);
    for (const pattern of include) {
      expect(pattern, 'vzor musí brát i .tsx, jinak vypadnou komponenty').toMatch(/tsx?/);
    }
  });

  it('běží v jsdom a má plugin React, jinak render() nemá kde renderovat', async () => {
    const config = (await import('../vitest.config')).default;
    expect(config.test?.environment).toBe('jsdom');
    expect(config.plugins?.length ?? 0).toBeGreaterThan(0);
  });

  it('setupFiles registruje úklid po každém testu', async () => {
    const config = (await import('../vitest.config')).default;
    const setupFiles = config.test?.setupFiles ?? [];
    expect(setupFiles.length, 'bez setupFiles zůstane render z předchozího testu').toBeGreaterThan(
      0,
    );
    // Prázdný setup soubor je stejná vada jako žádný: úklid se registruje sám
    // jen při globals: true. Bez cleanup() padne každý druhý render na
    // "Found multiple elements with the role".
    const setup = fs.readFileSync(path.join(import.meta.dirname, '../vitest.setup.ts'), 'utf8');
    expect(setup).toContain('cleanup');
    expect(setup).toContain('afterEach');
  });
});

describe('GET /api/health/ready', () => {
  it('vrátí 503 a seznam kontrol, když databáze neodpovídá', async () => {
    const { GET } = await import('../src/app/api/health/ready/route');
    const response = await GET();
    expect(response.status).toBe(503);
    const body = (await response.json()) as { checks: { name: string; status: string }[] };
    expect(body.checks.map((check) => check.name)).toContain('database');
    expect(body.checks.find((check) => check.name === 'database')?.status).toBe('fail');
  });

  it('nikdy necachuje odpověď', async () => {
    const module = await import('../src/app/api/health/ready/route');
    expect(module.dynamic).toBe('force-dynamic');
    expect(module.runtime).toBe('nodejs');
  });
});
