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
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@mlain/core/errors';

const BASE = process.env['PREFLIGHT_BASE_URL'] ?? 'http://localhost:3100';
const ORIGIN = BASE;

/** Prázdná proměnná prostředí je totéž co nenastavená, ne platná hodnota. */
function fromEnv(name: string): string | undefined {
  const value = process.env[name];
  return value !== undefined && value !== '' ? value : undefined;
}

const SETUP = {
  email: 'p06-preflight@example.com',
  password: 'preflight heslo dlouhe dost',
  name: 'Preflight',
  workspace_name: 'Preflight Projekt',
  locale: 'cs',
};

/**
 * Účet, pod kterým preflight mluví s API.
 *
 * Na ČERSTVÉ instanci si ho založí sám přes `/api/v1/setup`. Jenže setup je
 * jednorázový: na instanci, která už nastavená je, vrátí 409 a účet
 * `p06-preflight@example.com` nevznikne nikdy. Původní verze přesto
 * bezpodmínečně vyžadovala 200 z přihlášení, takže proti běžícímu vývojovému
 * serveru padala vždycky a z `pnpm run test:unit` dělala běh závislý na tom,
 * jestli někdo instalaci mezitím dokončil. `expect([201, 409])` tolerovalo dvě
 * výchozí situace, ale zbytek testu se podle nich nezachoval.
 *
 * Oprava má dvě části. Údaje jdou předat prostředím (`PREFLIGHT_EMAIL`
 * a `PREFLIGHT_PASSWORD`, případně `E2E_EMAIL` a `E2E_PASSWORD`, které se
 * v repozitáři k témuž účelu už používají), takže proti nastavené instanci se
 * preflight pustí pod existujícím účtem. A když se přihlásit nedaří, blok se
 * PŘESKOČÍ s důvodem v NÁZVU, stejně jako u sondy `apiIsMounted`. Nic se
 * netoleruje mlčky: zelený běh, ze kterého není poznat, že se neověřilo nic,
 * je horší než červený.
 *
 * Preflight ZAPISUJE (E6 zakládá API klíč), takže patří proti vývojové
 * instanci, ne proti ostrému provozu.
 */
const CREDENTIALS = {
  email: fromEnv('PREFLIGHT_EMAIL') ?? fromEnv('E2E_EMAIL') ?? SETUP.email,
  password: fromEnv('PREFLIGHT_PASSWORD') ?? fromEnv('E2E_PASSWORD') ?? SETUP.password,
};

/** Bez údajů z prostředí jede preflight na účtu, který si zakládá sám. */
const OWN_ACCOUNT = CREDENTIALS.email === SETUP.email;

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

type Session =
  | { ready: true; cookie: string; csrfToken: string; workspaceId: string }
  | { ready: false; reason: string };

/**
 * Přihlásí preflight a zjistí, do kterého projektu míří. Každý neúspěch nese
 * důvod, protože z něj vzniká jméno přeskočeného bloku.
 */
async function openSession(): Promise<Session> {
  try {
    if (OWN_ACCOUNT) {
      const setup = await request('/api/v1/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify(SETUP),
      });
      // 201 = instalace byla čerstvá a účet právě vznikl, 409 = instalace už
      // je nastavená a účet preflightu neexistuje. Cokoli jiného znamená, že
      // se setup chová jinak, než P06 čeká, a to se nesmí zamlčet.
      if (setup.status !== 201 && setup.status !== 409) {
        return {
          ready: false,
          reason: `POST /api/v1/setup vrátil ${setup.status}, čeká se 201 (čerstvá instalace) nebo 409 (už nastavená)`,
        };
      }
    }

    const login = await request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email: CREDENTIALS.email, password: CREDENTIALS.password }),
    });
    if (login.status !== 200) {
      const hint = OWN_ACCOUNT
        ? `; instalace na ${BASE} už je nastavená, takže se účet preflightu nezaložil. Předej existující účet v PREFLIGHT_EMAIL a PREFLIGHT_PASSWORD (nebo E2E_EMAIL a E2E_PASSWORD), nebo pusť preflight proti čerstvé instanci`
        : '';
      return {
        ready: false,
        reason: `přihlášení účtu ${CREDENTIALS.email} vrátilo ${login.status}${hint}`,
      };
    }

    const setCookie = login.headers.get('set-cookie');
    if (setCookie === null) {
      return { ready: false, reason: 'přihlášení vrátilo 200 bez hlavičky set-cookie' };
    }
    const cookie = setCookie.split(';')[0]!;

    const me = await request('/api/v1/auth/me', { headers: { cookie } });
    if (me.status !== 200) {
      return { ready: false, reason: `GET /api/v1/auth/me po přihlášení vrátil ${me.status}` };
    }
    const mine = await body(me);
    const memberships = (mine['memberships'] ?? []) as Array<Json>;
    const first = memberships[0];
    if (first === undefined) {
      return {
        ready: false,
        reason: `účet ${CREDENTIALS.email} nemá členství v žádném projektu, takže preflight nemá kam mířit`,
      };
    }

    return {
      ready: true,
      cookie,
      // csrf_token dnes v odpovědi P04 chybí, což je nález testu E1. Session
      // se na tom nezastaví, jinak by se místo červeného E1 přeskočilo všechno.
      csrfToken: String(mine['csrf_token'] ?? ''),
      workspaceId: String(first['workspace_id']),
    };
  } catch (cause) {
    return { ready: false, reason: `příprava relace selhala: ${String(cause)}` };
  }
}

const probe = await apiIsMounted();
const session: Session = probe.mounted
  ? await openSession()
  : { ready: false, reason: `${probe.reason}; cesty /api/v1 vlastní P04, kapitola 2.1` };

if (session.ready) {
  cookie = session.cookie;
  csrfToken = session.csrfToken;
  workspaceId = session.workspaceId;
}

// Důvod přeskočení patří do JMÉNA bloku, ne do console.warn: výpis na
// standardní chybový výstup se v souhrnu ztratí, kdežto jméno přeskočeného
// bloku reportér vypíše. Zelený běh, ze kterého není poznat, že se
// neověřilo nic, je horší než červený.
const PREFLIGHT_TITLE = session.ready
  ? 'P06 preflight vůči P04'
  : `P06 preflight vůči P04 [PŘESKOČENO, předpoklad neplatí: ${session.reason}]`;

describe.skipIf(!session.ready)(PREFLIGHT_TITLE, () => {
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
