// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { applyHarnessEnv } from '@mlain/core/test-support/pg-harness';
import type {
  buildApp as BuildApp,
  buildOpenApiDocument as BuildDoc,
  registeredPaths as Paths,
} from '../../src/lib/api/openapi';

/**
 * ODCHYLKA OD PLÁNU: aplikace se staví v `beforeAll`, ne na úrovni modulu.
 * Zdůvodnění je v `openapi.test.ts`. Databáze se nespouští, protože každý
 * z těchhle požadavků skončí na autentizaci nebo na chybějící cestě dřív,
 * než by se otevřela transakce.
 */
let app: ReturnType<typeof BuildApp>;
let buildOpenApiDocument: typeof BuildDoc;
let registeredPaths: typeof Paths;

beforeAll(async () => {
  applyHarnessEnv({
    appUrl: 'postgres://mlain_app:x@127.0.0.1:1/mlain',
    migratorUrl: 'postgres://mlain_migrator:x@127.0.0.1:1/mlain',
  });
  const openapi = await import('../../src/lib/api/openapi');
  buildOpenApiDocument = openapi.buildOpenApiDocument;
  registeredPaths = openapi.registeredPaths;
  app = openapi.buildApp();
});

/** Poslední síto: chyby, které projdou všemi ostatními testy jednotlivě. */
describe('průřezová kontrola celé aplikace', () => {
  it('každá chybová odpověď je application/problem+json', async () => {
    const cases = [
      { path: '/api/v1/api-keys', init: {} },
      { path: '/api/v1/neexistuje', init: {} },
      { path: '/api/v1/audit-log', init: {} },
    ];
    for (const testCase of cases) {
      const res = await app.request(testCase.path, testCase.init);
      expect(res.status, testCase.path).toBeGreaterThanOrEqual(400);
      expect(res.headers.get('content-type'), testCase.path).toContain('application/problem+json');
      const body = await res.json();
      expect(body.request_id, testCase.path).toBeTruthy();
      expect(body.code, testCase.path).toBeTruthy();
      expect(body.type, testCase.path).toContain('https://docs.mlain.dev/errors/');
    }
  });

  it('žádná odpověď neobsahuje stack, SQL ani název tabulky', async () => {
    const res = await app.request('/api/v1/audit-log');
    const text = await res.text();
    for (const forbidden of ['at Object.', 'SELECT ', 'FROM ', 'password_hash', 'node_modules']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  /**
   * ODCHYLKA OD PLÁNU: seznam navíc obsahuje `/api/v1/jobs`
   * a `/api/v1/jobs/{kind}/{id}`. Plán je v tomhle výčtu vynechal, přestože
   * je sám zavádí v úkolu 45 a v pořadí provádění výslovně žádá, aby cesty
   * Centra úloh byly v dokumentu. Bez nich by seznam nesouhlasil s počtem
   * 43 operací, který plán čeká o dva testy níž.
   */
  // Kořeny cest, které vlastní část 1. Filtr je tu schválně: router sdílí
  // víc domén a bez něj by test porovnával výčet části 1 se součtem za celý
  // produkt. Dokud byla část 1 jediná zaregistrovaná, rozdíl nebyl vidět.
  const CAST_1_KORENY = [
    'api-keys',
    'audit-log',
    'auth',
    'invitations',
    'jobs',
    'members',
    'setup',
    // Účty instalace: výpis osiřelých a smazání účtu. Doména identity, jen
    // nemluví o projektu, protože účet projektu nepatří.
    'users',
    'webhook-deliveries',
    'webhook-endpoints',
    'workspaces',
    // Dokumentace a její zdroj patří taky části 1, i když nejsou doménou.
    'docs',
    'openapi.json',
  ];
  const patriCasti1 = (path: string): boolean =>
    CAST_1_KORENY.includes(path.replace('/api/v1/', '').split('/')[0]?.split(':')[0] ?? '');

  it('všechny cesty vlastněné částí 1 jsou registrované', () => {
    const paths = registeredPaths(app).filter(patriCasti1).sort();
    expect(paths).toEqual(
      [
        '/api/v1/api-keys',
        '/api/v1/api-keys/{id}',
        '/api/v1/api-keys/{id}/rotate',
        '/api/v1/audit-log',
        '/api/v1/audit-log/count',
        '/api/v1/auth/change-password',
        '/api/v1/auth/login',
        '/api/v1/auth/logout',
        '/api/v1/auth/logout-all',
        '/api/v1/auth/me',
        '/api/v1/auth/password-reset',
        '/api/v1/auth/password-reset/confirm',
        '/api/v1/auth/sessions',
        '/api/v1/auth/sessions/{id}',
        '/api/v1/docs',
        '/api/v1/invitations',
        '/api/v1/invitations/accept',
        '/api/v1/invitations/{id}',
        '/api/v1/jobs',
        '/api/v1/jobs/{kind}/{id}',
        '/api/v1/members',
        '/api/v1/members/{user_id}',
        '/api/v1/openapi.json',
        '/api/v1/setup',
        '/api/v1/users/orphaned',
        '/api/v1/users/{user_id}',
        '/api/v1/webhook-deliveries',
        '/api/v1/webhook-deliveries/count',
        '/api/v1/webhook-deliveries/{id}/retry',
        '/api/v1/webhook-endpoints',
        '/api/v1/webhook-endpoints/{id}',
        '/api/v1/webhook-endpoints/{id}/enable',
        '/api/v1/webhook-endpoints/{id}/test',
        '/api/v1/workspaces',
        '/api/v1/workspaces/{id}',
        '/api/v1/workspaces/{id}/restore',
        '/api/v1/workspaces/{id}/transfer-ownership',
      ].sort(),
    );
  });

  // 43 → 46. Přibyl `POST /api/v1/members` (založení člena rovnou s heslem),
  // `GET /api/v1/users/orphaned` a `DELETE /api/v1/users/{user_id}`. Všechno tři
  // opravy téže mezery: účet šlo jedině založit, ne najít a smazat.
  it('dokument OpenAPI popisuje 46 operací', () => {
    const document = buildOpenApiDocument(app);
    const operations = Object.entries(document.paths ?? {})
      .filter(([path]) => patriCasti1(path))
      .flatMap(([, methods]) => Object.keys(methods as Record<string, unknown>));
    expect(operations).toHaveLength(46);
  });
});
