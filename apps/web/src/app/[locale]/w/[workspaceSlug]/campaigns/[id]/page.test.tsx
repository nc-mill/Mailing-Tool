import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Brána nad tím, že NEDOČTENÁ kampaň není totéž co NEEXISTUJÍCÍ kampaň.
 *
 * Obrazovka nastavení kampaně volala `notFound()` na každé selhání čtení, takže
 * uživateli nad živou kampaní vyskočilo „stránka nenalezena". Přesně tak vypadá
 * hlášení „kampaň vrací 404", které se pak nedá zopakovat: příčinou bývá
 * vypršení požadavku (`apiFetch` má desetisekundový limit) nebo nedostupné API,
 * a to obojí do minuty pomine.
 *
 * Test tedy nekontroluje vzhled, ale ROZHODNUTÍ: kdy se ještě smí říct 404
 * a kdy se musí ukázat chybový blok. Volá se serverová komponenta stránky,
 * ne formulář pod ní.
 */

const getWorkspaceAccess = vi.fn();
const apiFetch = vi.fn();
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
const redirect = vi.fn((_to: string): never => {
  throw new Error('NEXT_REDIRECT');
});

/** Problem, se kterým se chybový blok naposledy vykreslil. */
let problemProps: Record<string, unknown> | null = null;

vi.mock('@/lib/identity/workspace-access', () => ({
  getWorkspaceAccess: (slug: string) => getWorkspaceAccess(slug),
}));
vi.mock('@/lib/api-client/fetch', () => ({
  apiFetch: (path: string, options: unknown) => apiFetch(path, options),
}));
vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
  redirect: (to: string) => redirect(to),
}));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock('@/features/campaigns/actions', () => ({ updateCampaignSettingsAction: vi.fn() }));
vi.mock('@/features/campaigns/settings-form', () => ({
  CampaignSettingsForm: () => null,
}));
vi.mock('@/features/campaigns/campaign-load-problem', () => ({
  CampaignLoadProblem: (props: Record<string, unknown>) => {
    problemProps = props;
    return null;
  },
}));

const { default: CampaignSettingsPage } = await import('./page');

const WORKSPACE = {
  id: '018f2b1c-0000-7000-8000-000000000001',
  name: 'E-shop Kolo',
  slug: 'eshop-kolo',
};

const CAMPAIGN_ID = '018f2b1c-0000-7000-8000-0000000000aa';

function problem(status: number, code: string) {
  return {
    type: `https://docs.mlain.dev/errors/${code}`,
    title: code,
    status,
    detail: '',
    instance: `/api/v1/campaigns/${CAMPAIGN_ID}`,
    code,
    request_id: 'req-1',
  };
}

function renderPage() {
  return CampaignSettingsPage({
    params: Promise.resolve({ locale: 'cs', workspaceSlug: 'eshop-kolo', id: CAMPAIGN_ID }),
    searchParams: Promise.resolve({}),
  });
}

/**
 * Props chybového bloku. Serverová komponenta vrací element klientské
 * komponenty; zavoláním jeho typu se props zapíšou do `problemProps`, aniž by
 * se montoval celý strom. Tentýž postup má test skořápky projektu.
 */
async function renderProblem(): Promise<Record<string, unknown>> {
  problemProps = null;
  const element = (await renderPage()) as {
    type: (props: Record<string, unknown>) => unknown;
    props: Record<string, unknown>;
  };
  element.type(element.props);
  return problemProps ?? {};
}

/** Zbylá čtení stránky (seznamy, segmenty, šablony…) na rozhodnutí nemají vliv. */
function emptyList() {
  return { ok: true as const, data: { data: [], items: [] } };
}

beforeEach(() => {
  vi.clearAllMocks();
  problemProps = null;
  getWorkspaceAccess.mockResolvedValue({
    ok: true,
    data: { workspace: WORKSPACE, role: 'owner', permissions: [], userName: 'Petr' },
  });
  apiFetch.mockImplementation(async () => emptyList());
});

describe('nastavení kampaně: 404 jen z opravdové 404', () => {
  it('vypršení požadavku na kampaň ukáže chybový blok, ne stránku nenalezena', async () => {
    apiFetch.mockImplementation(async (path: string) =>
      path === `/api/v1/campaigns/${CAMPAIGN_ID}`
        ? { ok: false, problem: problem(504, 'dependency_timeout') }
        : emptyList(),
    );

    const props = await renderProblem();

    expect(notFound).not.toHaveBeenCalled();
    expect(props['problem']).toMatchObject({ code: 'dependency_timeout' });
  });

  it('nedostupné API ukáže chybový blok, ne stránku nenalezena', async () => {
    apiFetch.mockImplementation(async (path: string) =>
      path === `/api/v1/campaigns/${CAMPAIGN_ID}`
        ? { ok: false, problem: problem(503, 'service_unavailable') }
        : emptyList(),
    );

    const props = await renderProblem();

    expect(notFound).not.toHaveBeenCalled();
    expect(props['problem']).toMatchObject({ code: 'service_unavailable' });
  });

  it('smazaná nebo cizí kampaň dál dostane 404', async () => {
    apiFetch.mockImplementation(async (path: string) =>
      path === `/api/v1/campaigns/${CAMPAIGN_ID}`
        ? { ok: false, problem: problem(404, 'not_found') }
        : emptyList(),
    );

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('nedočtený projekt ukáže chybový blok, nečlen dál dostane 404', async () => {
    getWorkspaceAccess.mockResolvedValue({
      ok: false,
      problem: problem(504, 'dependency_timeout'),
    });
    const props = await renderProblem();
    expect(notFound).not.toHaveBeenCalled();
    expect(props['problem']).toMatchObject({ code: 'dependency_timeout' });

    vi.clearAllMocks();
    getWorkspaceAccess.mockResolvedValue({ ok: false, problem: problem(404, 'not_found') });
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('odeslaná kampaň pořád padá na svůj report', async () => {
    apiFetch.mockImplementation(async (path: string) =>
      path === `/api/v1/campaigns/${CAMPAIGN_ID}`
        ? { ok: true, data: { id: CAMPAIGN_ID, status: 'sent', template_id: null } }
        : emptyList(),
    );

    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(`/cs/w/eshop-kolo/campaigns/${CAMPAIGN_ID}/report`);
    expect(notFound).not.toHaveBeenCalled();
  });
});
