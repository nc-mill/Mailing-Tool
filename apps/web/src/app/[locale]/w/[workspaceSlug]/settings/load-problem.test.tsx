import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Brána nad pravidlem „404 jen z opravdové 404" na obrazovkách odesílání.
 *
 * Tři stránky v Nastavení volaly `notFound()` na jakékoli selhání čtení, takže
 * se na „stránka nenalezena" překlopilo i vypršení požadavku. `apiFetch` má
 * desetisekundový limit (`lib/api-client/fetch.ts`) a na vytíženém stroji ho
 * překročí i zdravé čtení; uživatel pak dostane větu, že obrazovka neexistuje,
 * a hlášení se za minutu nedá zopakovat, protože příčina pominula.
 *
 * Test nekontroluje vzhled, ale ROZHODNUTÍ, a drží ho na všech třech stránkách
 * naráz: kdyby se pravidlo opravilo jen na jedné, spadne to tady. Přesně tenhle
 * rozchod obrazovek se v projektu už jednou stal, viz `preflight-problem.tsx`.
 */

const getWorkspaceAccess = vi.fn();
const apiFetch = vi.fn();
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

/** Props, se kterými se chybový blok naposledy vykreslil. */
let problemProps: Record<string, unknown> | null = null;

vi.mock('@/lib/identity/workspace-access', () => ({
  getWorkspaceAccess: (slug: string) => getWorkspaceAccess(slug),
}));
vi.mock('@/lib/api-client/fetch', () => ({
  apiFetch: (path: string, options: unknown) => apiFetch(path, options),
}));
vi.mock('next/navigation', () => ({ notFound: () => notFound() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock('@/features/settings/settings-problem', () => ({
  SettingsProblem: (props: Record<string, unknown>) => {
    problemProps = props;
    return null;
  },
}));
vi.mock('@/features/senders/senders-screen', () => ({ SendersScreen: () => null }));
vi.mock('@/features/sending/sending-screen', () => ({ SendingScreen: () => null }));
vi.mock('@/features/sending/domain-screen', () => ({ DomainScreen: () => null }));

const { default: SendersPage } = await import('./senders/page');
const { default: SendingPage } = await import('./sending/page');
const { default: DomainPage } = await import('./sending/domains/[id]/page');

const WORKSPACE = {
  id: '018f2b1c-0000-7000-8000-000000000001',
  name: 'E-shop Kolo',
  slug: 'eshop-kolo',
};

const DOMAIN_ID = '018f2b1c-0000-7000-8000-0000000000bb';

function problem(status: number, code: string) {
  return {
    type: `https://docs.mlain.dev/errors/${code}`,
    title: code,
    status,
    detail: '',
    instance: '/api/v1/domains',
    code,
    request_id: 'req-1',
  };
}

/** Odpověď, se kterou každá ze tří stránek dojde až k vykreslení obrazovky. */
function payload() {
  return {
    ok: true as const,
    data: {
      data: [],
      settings: {},
      limits: {},
      domain: { id: DOMAIN_ID, domain: 'kolo.cz', checked_at: null, verified_at: null },
      records: [],
      checks: {},
    },
  };
}

const PAGES = [
  {
    name: 'předvolby odesílatele',
    render: () =>
      SendersPage({ params: Promise.resolve({ locale: 'cs', workspaceSlug: 'eshop-kolo' }) }),
  },
  {
    name: 'odesílání',
    render: () =>
      SendingPage({ params: Promise.resolve({ locale: 'cs', workspaceSlug: 'eshop-kolo' }) }),
  },
  {
    name: 'detail domény',
    render: () =>
      DomainPage({
        params: Promise.resolve({ locale: 'cs', workspaceSlug: 'eshop-kolo', id: DOMAIN_ID }),
      }),
  },
];

/**
 * Props chybového bloku. Serverová komponenta vrací element klientské
 * komponenty; zavoláním jeho typu se props zapíšou, aniž by se montoval
 * celý strom. Tentýž postup má test skořápky projektu.
 */
async function renderProblem(render: () => Promise<unknown>): Promise<Record<string, unknown>> {
  problemProps = null;
  const element = (await render()) as {
    type: (props: Record<string, unknown>) => unknown;
    props: Record<string, unknown>;
  };
  element.type(element.props);
  return problemProps ?? {};
}

beforeEach(() => {
  vi.clearAllMocks();
  problemProps = null;
  getWorkspaceAccess.mockResolvedValue({
    ok: true,
    data: { workspace: WORKSPACE, role: 'owner', permissions: [], userName: 'Petr' },
  });
  apiFetch.mockImplementation(async () => payload());
});

describe.each(PAGES)('$name: 404 jen z opravdové 404', ({ render }) => {
  it('nedočtený projekt ukáže chybový blok, ne stránku nenalezena', async () => {
    getWorkspaceAccess.mockResolvedValue({
      ok: false,
      problem: problem(504, 'dependency_timeout'),
    });

    const props = await renderProblem(render);

    expect(notFound).not.toHaveBeenCalled();
    expect(props['problem']).toMatchObject({ code: 'dependency_timeout' });
  });

  it('nečlen projektu dál dostane 404', async () => {
    getWorkspaceAccess.mockResolvedValue({ ok: false, problem: problem(404, 'not_found') });

    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });
});

describe('povinná čtení pod projektem', () => {
  it('odesílání: vypršení prahů doručitelnosti ukáže chybový blok', async () => {
    apiFetch.mockImplementation(async (path: string) =>
      path.startsWith('/api/v1/settings/deliverability')
        ? { ok: false, problem: problem(504, 'dependency_timeout') }
        : payload(),
    );

    const props = await renderProblem(() =>
      SendingPage({ params: Promise.resolve({ locale: 'cs', workspaceSlug: 'eshop-kolo' }) }),
    );

    expect(notFound).not.toHaveBeenCalled();
    expect(props['problem']).toMatchObject({ code: 'dependency_timeout' });
  });

  it('detail domény: vypršení ukáže blok, ale neexistující doména dál 404', async () => {
    apiFetch.mockImplementation(async () => ({
      ok: false,
      problem: problem(504, 'dependency_timeout'),
    }));
    const props = await renderProblem(() =>
      DomainPage({
        params: Promise.resolve({ locale: 'cs', workspaceSlug: 'eshop-kolo', id: DOMAIN_ID }),
      }),
    );
    expect(notFound).not.toHaveBeenCalled();
    expect(props['problem']).toMatchObject({ code: 'dependency_timeout' });

    vi.clearAllMocks();
    apiFetch.mockImplementation(async () => ({ ok: false, problem: problem(404, 'not_found') }));
    await expect(
      DomainPage({
        params: Promise.resolve({ locale: 'cs', workspaceSlug: 'eshop-kolo', id: DOMAIN_ID }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });
});
