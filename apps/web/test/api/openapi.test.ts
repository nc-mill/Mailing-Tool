// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyHarnessEnv } from '@mlain/core/test-support/pg-harness';
import type {
  buildApp as BuildApp,
  buildOpenApiDocument as BuildDoc,
  registeredPaths as Paths,
} from '../../src/lib/api/openapi';

const COMMITTED = fileURLToPath(
  new URL('../../../../packages/contracts/openapi.json', import.meta.url),
);

/**
 * ODCHYLKA OD PLÁNU: aplikace se staví v `beforeAll`, ne na úrovni modulu.
 * `createApiApp()` čte konfiguraci a ta v okamžiku importu testu neexistuje.
 * Databáze se nespouští: žádný z těchhle testů se na ni nedostane, protože
 * autentizace odmítne požadavek dřív, a `applyHarnessEnv` jen doplní proměnné,
 * které `loadConfig()` vyžaduje.
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

describe('kritérium 35: každá registrovaná cesta je v dokumentu', () => {
  it('seznam cest routeru se rovná seznamu cest v OpenAPI', () => {
    const document = buildOpenApiDocument(app);
    const inDocument = new Set(Object.keys(document.paths ?? {}));
    // `/api/v1/docs` a `/api/v1/openapi.json` jsou registrované obyčejným
    // `app.get`, ne `app.openapi`, takže v dokumentu záměrně nejsou: dokument
    // popisuje API, ne sám sebe.
    const missing = registeredPaths(app)
      .filter((p) => p !== '/api/v1/docs' && p !== '/api/v1/openapi.json')
      .filter((p) => !inDocument.has(p));
    expect(missing).toEqual([]);
  });

  it('dokument je OpenAPI 3.1', () => {
    expect(buildOpenApiDocument(app).openapi.startsWith('3.1')).toBe(true);
  });

  /**
   * Bez definice schématu je celý dokument plný `security: [{ bearerAuth }]`,
   * které odkazuje do prázdna. Generátory klientů z toho udělají klienta BEZ
   * autorizace a zákazník to zjistí až tím, že mu každé volání vrací 401.
   */
  it('components.securitySchemes definuje bearerAuth, na které se security odkazuje', () => {
    const document = buildOpenApiDocument(app);
    const schemes = (document.components ?? {})['securitySchemes'] as
      Record<string, { type?: string; scheme?: string }> | undefined;
    expect(schemes?.['bearerAuth']).toMatchObject({ type: 'http', scheme: 'bearer' });

    // Každé jméno použité v `security` musí být definované, jinak je to odkaz
    // do prázdna i u jednotlivé operace.
    const used = new Set<string>();
    for (const methods of Object.values(document.paths ?? {})) {
      for (const operation of Object.values(methods)) {
        for (const requirement of (operation as { security?: Array<Record<string, unknown>> })
          .security ?? []) {
          for (const name of Object.keys(requirement)) used.add(name);
        }
      }
    }
    expect([...used].filter((name) => !(name in (schemes ?? {})))).toEqual([]);
  });

  it('každý endpoint pod /api/v1 má aspoň jednu chybovou odpověď se schématem Problem', () => {
    const document = buildOpenApiDocument(app);
    const offenders: string[] = [];
    for (const [path, methods] of Object.entries(document.paths ?? {})) {
      for (const [method, operation] of Object.entries(methods as Record<string, unknown>)) {
        const responses = (operation as { responses?: Record<string, unknown> }).responses ?? {};
        const hasProblem = Object.entries(responses).some(
          ([status, value]) =>
            Number(status) >= 400 && JSON.stringify(value).includes('application/problem+json'),
        );
        if (!hasProblem) offenders.push(`${method.toUpperCase()} ${path}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // Kořeny cest, které vlastní část 1. Výčet je tu schválně: dokument sdílí
  // víc domén a bez filtru by tenhle test měřil součet za celý produkt.
  // Do doplnění domény kontaktů jich bylo v dokumentu 43 celkem, takže rozdíl
  // nebyl vidět a test se tvářil, že hlídá část 1, přestože počítal všechno.
  const CAST_1_KORENY = [
    'api-keys',
    'audit-log',
    'auth',
    'invitations',
    'jobs',
    'members',
    'setup',
    // Účty instalace: výpis osiřelých a smazání účtu.
    'users',
    'webhook-deliveries',
    'webhook-endpoints',
    'workspaces',
  ];

  // 43 → 46: `POST /api/v1/members`, `GET /api/v1/users/orphaned`
  // a `DELETE /api/v1/users/{user_id}`.
  it('dokument obsahuje 46 operací vlastněných částí 1', () => {
    const document = buildOpenApiDocument(app);
    const operations = Object.entries(document.paths ?? {})
      .filter(([path]) => {
        const koren = path.replace('/api/v1/', '').split('/')[0]?.split(':')[0] ?? '';
        return CAST_1_KORENY.includes(koren);
      })
      .flatMap(([, methods]) => Object.keys(methods as Record<string, unknown>));
    expect(operations.length).toBe(46);
  });
});

describe('kritérium 34: servírovaný dokument je ten commitnutý', () => {
  it('GET /api/v1/openapi.json vrací bajt po bajtu shodný soubor', async () => {
    const res = await app.request('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(readFileSync(COMMITTED, 'utf8'));
  });

  it('vygenerovaný dokument se shoduje s commitnutým souborem', () => {
    const generated = `${JSON.stringify(buildOpenApiDocument(app), null, 2)}\n`;
    expect(generated).toBe(readFileSync(COMMITTED, 'utf8'));
  });
});

describe('GET /api/v1/docs', () => {
  it('vrací soběstačné HTML bez jediného externího zdroje', async () => {
    const res = await app.request('/api/v1/docs');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).not.toMatch(/src="https?:\/\//);
    expect(html).not.toMatch(/href="https?:\/\/(?!docs\.mlain\.dev)/);
    expect(html).toContain('/api/v1/openapi.json');
  });

  it('vypisuje cesty z dokumentu', async () => {
    const html = await (await app.request('/api/v1/docs')).text();
    expect(html).toContain('/api/v1/auth/login');
    expect(html).toContain('/api/v1/webhook-endpoints');
  });
});
