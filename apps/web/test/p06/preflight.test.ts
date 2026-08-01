// @vitest-environment node
//
// Preflight P06: ověření předpokladů E1 až E12 z kapitoly 2.1 plánu
// SPUŠTĚNÍM, ne přečtením.
//
// ODCHYLKA OD PLÁNU, vynucená skutečným stavem repozitáře, ne pohodlím.
// Plán psal `import { app } from '@/lib/api/app'` a volal `app.request(...)`.
// Takový export neexistuje: `apps/web/src/lib/api/app.ts` (vlastní ho P04)
// exportuje továrnu `createApiApp()` BEZ jediné cesty a jednotlivé cesty se
// do ní registrují zvlášť (`registerAuthRoutes` a spol.). Sestavit tady
// "celou aplikaci" by znamenalo uhodnout jména registrátorů, které P04
// souběžně teprve píše, a preflight by měřil můj odhad, ne skutečnost.
//
// Preflight proto mluví HTTP na běžící instanci, tedy přesně tak, jak s API
// mluví serverová obálka `apiFetch` z úkolu 3. Adresa se bere z
// PREFLIGHT_BASE_URL, jinak z vývojového serveru na portu 3100.
//
// Sonda `apiIsMounted` pozná, jestli `/api/v1` vůbec někdo obsluhuje. Dokud
// P04 cesty do Next.js nenamontuje, vrací proxy P05 přesměrování na /login
// a assertovat proti němu by znamenalo měřit přesměrování. V tom případě se
// blok přeskočí a důvod se vypíše; jakmile cesty přibudou, odemkne se sám.
import { beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@mlain/core/errors';

const BASE = process.env['PREFLIGHT_BASE_URL'] ?? 'http://localhost:3100';
const ORIGIN = BASE;

const SETUP = {
  email: 'p06-preflight@example.com',
  password: 'preflight heslo dlouhe dost',
  name: 'Preflight',
  workspace_name: 'Preflight Projekt',
  locale: 'cs',
};

type Json = Record<string, unknown>;

let cookie = '';
let csrfToken = '';
let workspaceId = '';

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(new URL(path, BASE), { ...init, redirect: 'manual' });
}

async function body(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': 'application/json',
    origin: ORIGIN,
    cookie,
    'x-csrf-token': csrfToken,
    'x-workspace-id': workspaceId,
    ...extra,
  };
}

/**
 * Odpověď, kterou vydává API, pozná se podle typu obsahu. Přesměrování 3xx
 * od proxy ani HTML stránka Next.js sem nepatří.
 */
async function apiIsMounted(): Promise<{ mounted: boolean; reason: string }> {
  try {
    const response = await request('/api/v1/auth/me');
    const contentType = response.headers.get('content-type') ?? '';
    if (response.status >= 300 && response.status < 400) {
      return {
        mounted: false,
        reason: `GET /api/v1/auth/me vrátil ${response.status} na ${response.headers.get('location')}, tedy proxy, ne API`,
      };
    }
    if (!contentType.includes('json')) {
      return { mounted: false, reason: `GET /api/v1/auth/me vrátil content-type "${contentType}"` };
    }
    return { mounted: true, reason: '' };
  } catch (cause) {
    return { mounted: false, reason: `instance na ${BASE} neodpovídá: ${String(cause)}` };
  }
}

const probe = await apiIsMounted();

// Důvod přeskočení patří do JMÉNA bloku, ne do console.warn: výpis na
// standardní chybový výstup se v souhrnu ztratí, kdežto jméno přeskočeného
// bloku reportér vypíše. Zelený běh, ze kterého není poznat, že se
// neověřilo nic, je horší než červený.
const PREFLIGHT_TITLE = probe.mounted
  ? 'P06 preflight vůči P04'
  : `P06 preflight vůči P04 [PŘESKOČENO, předpoklad neplatí: ${probe.reason}; cesty /api/v1 vlastní P04, kapitola 2.1]`;

describe.skipIf(!probe.mounted)(PREFLIGHT_TITLE, () => {
  beforeAll(async () => {
    const setup = await request('/api/v1/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify(SETUP),
    });
    expect([201, 409]).toContain(setup.status);

    const login = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email: SETUP.email, password: SETUP.password }),
    });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    cookie = setCookie!.split(';')[0]!;

    const me = await request('/api/v1/auth/me', { headers: { cookie } });
    const mine = await body(me);
    csrfToken = String(mine['csrf_token'] ?? '');
    const memberships = mine['memberships'] as Array<Json>;
    workspaceId = String(memberships[0]!['workspace_id']);
  });

  it('E1: /auth/me vrací uživatele, členství se slugem a csrf_token', async () => {
    const response = await request('/api/v1/auth/me', { headers: { cookie } });
    expect(response.status).toBe(200);
    const payload = await body(response);
    expect(payload['user']).toMatchObject({
      id: expect.any(String),
      email: expect.any(String),
      name: expect.any(String),
      locale: expect.any(String),
      timezone: expect.any(String),
    });
    // Požadavek P06→P04.1. Dnes schéma odpovědi P04 tohle pole nemá, takže
    // tenhle řádek je červený schválně: bez tokenu nemá Server Action co
    // poslat v hlavičce X-CSRF-Token a sekundární obrana z 3.2 části 1
    // by existovala jen na papíře. Neopravuj to tady, patří to P04.
    expect(payload['csrf_token']).toEqual(expect.any(String));
    const memberships = payload['memberships'] as Array<Json>;
    // MembershipSchema v P04 zní { workspace_id, name, slug, role }.
    expect(memberships[0]).toMatchObject({
      workspace_id: expect.any(String),
      name: expect.any(String),
      slug: expect.any(String),
      role: expect.any(String),
    });
  });

  it('E2: /workspaces vrací slug, locale, timezone a address_form', async () => {
    const response = await request('/api/v1/workspaces', { headers: { cookie } });
    const payload = await body(response);
    const rows = payload['data'] as Array<Json>;
    expect(rows[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      slug: expect.any(String),
      locale: expect.any(String),
      timezone: expect.any(String),
      address_form: expect.stringMatching(/^(formal|informal)$/),
    });
  });

  it('E3: /auth/sessions vrací příznak current', async () => {
    const response = await request('/api/v1/auth/sessions', { headers: { cookie } });
    const payload = await body(response);
    const rows = payload['data'] as Array<Json>;
    expect(rows.some((row) => row['current'] === true)).toBe(true);
  });

  it('E4 a E5: detail webhooku a endpointy na počty existují', async () => {
    const detail = await request('/api/v1/webhook-endpoints/00000000-0000-7000-8000-000000000000', {
      headers: authHeaders(),
    });
    // 405 by znamenalo, že cesta existuje, ale GET na ní není. 404 je v pořádku:
    // endpoint existuje a jen ten konkrétní webhook ne.
    expect(detail.status).not.toBe(405);
    expect([200, 404]).toContain(detail.status);

    const auditCount = await request('/api/v1/audit-log/count', { headers: authHeaders() });
    expect(auditCount.status).toBe(200);
    expect(await body(auditCount)).toMatchObject({ count: expect.any(Number) });

    const deliveryCount = await request('/api/v1/webhook-deliveries/count', {
      headers: authHeaders(),
    });
    expect(deliveryCount.status).toBe(200);
  });

  it('E6: vytvoření klíče vrátí sekret a výpis už ne', async () => {
    const created = await request('/api/v1/api-keys', {
      method: 'POST',
      headers: authHeaders({ 'idempotency-key': 'preflight-key-0001' }),
      body: JSON.stringify({ name: 'Preflight', scopes: ['contacts:read'] }),
    });
    expect(created.status).toBe(201);
    const key = await body(created);
    expect(String(key['secret'])).toMatch(/^ml_live_[a-z2-7]{8}_[A-Za-z0-9_-]{43}$/);

    const list = await request('/api/v1/api-keys', { headers: authHeaders() });
    expect(JSON.stringify(await body(list))).not.toContain(String(key['secret']));
  });

  it('E10: smazání projektu vyžaduje confirm_name', async () => {
    const response = await request(`/api/v1/workspaces/${workspaceId}`, {
      method: 'DELETE',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(422);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
  });

  it('E11: neplatný kurzor vrací validation_failed s path cursor', async () => {
    const response = await request('/api/v1/audit-log?cursor=nonsense', {
      headers: authHeaders(),
    });
    expect(response.status).toBe(422);
    const problem = await body(response);
    expect(problem['code']).toBe('validation_failed');
    const errors = problem['errors'] as Array<Json>;
    expect(errors.some((entry) => entry['path'] === 'cursor')).toBe(true);
  });

  it('E12: endpointy Centra úloh existují a detail nese druh v cestě', async () => {
    const list = await request('/api/v1/jobs?limit=20', { headers: authHeaders() });
    expect(list.status).toBe(200);
    const payload = await body(list);
    expect(Array.isArray(payload['data'])).toBe(true);
    expect(payload['running_count']).toEqual(expect.any(Number));

    // Registr zdrojů je po vlně 0 prázdný, takže se čeká 404, ne 405 ani 500.
    // 405 by znamenalo, že cesta má jiný tvar, než na jaký P06 staví odkaz.
    const detail = await request('/api/v1/jobs/import/00000000-0000-7000-8000-000000000000', {
      headers: authHeaders(),
    });
    expect(detail.status).not.toBe(405);
    expect([200, 404]).toContain(detail.status);
  });

  it('E8: chyba forbidden nese, kdo oprávnění udělit může', async () => {
    // Vlastník má všechno, takže se 403 vyvolá cizím projektem: členství chybí.
    const foreign = '00000000-0000-7000-8000-0000000000ff';
    const response = await request('/api/v1/audit-log', {
      headers: authHeaders({ 'x-workspace-id': foreign }),
    });
    expect([403, 404]).toContain(response.status);
    if (response.status !== 403) return;
    const problem = await body(response);
    const params = (problem['params'] ?? {}) as Json;
    expect(params).toMatchObject({
      requiredPermission: expect.any(String),
      currentRole: expect.anything(),
    });
    expect(Array.isArray(params['grantedByRoles'])).toBe(true);
    expect(Array.isArray(params['contactableMembers'])).toBe(true);
  });
});

// Registr chybových kódů žádnou běžící instanci nepotřebuje, takže se
// kontroluje vždy. Je to jediná část předpokladů, kterou vlastní P01.
describe('registr chybových kódů P01', () => {
  it('zná všechny kódy, které P06 zobrazuje', () => {
    const used = [
      'unauthenticated',
      'invalid_credentials',
      'session_expired',
      'forbidden',
      'insufficient_scope',
      'origin_not_allowed',
      'csrf_token_invalid',
      'not_found',
      'conflict',
      'already_exists',
      'idempotency_key_reuse',
      'idempotency_request_in_progress',
      'last_owner_cannot_be_removed',
      'setup_already_completed',
      'validation_failed',
      'account_locked',
      'rate_limited',
      'internal_error',
      'service_unavailable',
      'dependency_timeout',
    ];
    for (const code of used) {
      expect(ERROR_CODES, `chybí kód ${code}`).toHaveProperty(code);
    }
  });

  it('zná i kódy z mapy settings, které plán jmenuje zvlášť', () => {
    for (const code of ['already_member', 'webhook_endpoint_disabled', 'too_many_items', 'gone']) {
      expect(ERROR_CODES, `chybí kód ${code}`).toHaveProperty(code);
    }
  });
});
