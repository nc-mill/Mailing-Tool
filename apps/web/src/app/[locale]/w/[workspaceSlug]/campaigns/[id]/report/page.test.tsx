import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Brána nad tím, že report NEEXISTUJÍCÍ kampaně vrátí 404, a zároveň nad tím,
 * že NEDOČTENÁ kampaň 404 nedostane.
 *
 * Stránka dřív `notFound()` nevolala vůbec: data si tahal až klientský
 * `CampaignReport`, takže vymyšlené `id` vrátilo 200 a rozbitou obrazovku.
 * Opačný extrém je stejně špatný: kdyby se na každé selhání čtení posílala
 * 404, četl by uživatel z vypršení požadavku, že mu kampaň někdo smazal.
 *
 * Test tedy nekontroluje vzhled, ale ROZHODNUTÍ. Je to týž tvar jako
 * `../page.test.tsx` u nastavení kampaně.
 */

const getWorkspaceAccess = vi.fn();
const apiFetch = vi.fn();
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

/** Problem, se kterým se chybový blok naposledy vykreslil. */
let problemProps: Record<string, unknown> | null = null;

vi.mock('@/lib/identity/workspace-access', () => ({
  getWorkspaceAccess: (slug: string) => getWorkspaceAccess(slug),
}));
vi.mock('@/lib/api-client/fetch', () => ({
  apiFetch: (path: string, options: unknown) => apiFetch(path, options),
}));
vi.mock('next/navigation', () => ({ notFound: () => notFound() }));
// Pruh o nedosažitelné měřicí doméně na rozhodnutí nemá vliv, ale `loadConfig`
// by v testu sáhl po konfiguraci celé instalace, kterou tu nikdo nemá.
vi.mock('@mlain/core/config', () => ({ loadConfig: () => ({ TRACKING_DOMAIN: 'mlain.example' }) }));
vi.mock('@mlain/core/tracking', () => ({
  classifyTrackingDomain: () => ({ kind: 'public', host: 'mlain.example' }),
}));
vi.mock('@/features/reports/report/campaign-report', () => ({ CampaignReport: () => null }));
vi.mock('@/features/tracking/unreachable-domain-alert', () => ({
  UnreachableDomainAlert: () => null,
}));
vi.mock('@/features/campaigns/campaign-load-problem', () => ({
  CampaignLoadProblem: (props: Record<string, unknown>) => {
    problemProps = props;
    return null;
  },
}));

const { default: CampaignReportPage } = await import('./page');

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
  return CampaignReportPage({
    params: Promise.resolve({ workspaceSlug: 'eshop-kolo', id: CAMPAIGN_ID }),
  });
}

/**
 * Props chybového bloku. Serverová komponenta vrací element klientské
 * komponenty; zavoláním jeho typu se props zapíšou do `problemProps`, aniž by
 * se montoval celý strom.
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

beforeEach(() => {
  vi.clearAllMocks();
  problemProps = null;
  getWorkspaceAccess.mockResolvedValue({
    ok: true,
    data: { workspace: WORKSPACE, role: 'owner', permissions: [], userName: 'Petr' },
  });
  apiFetch.mockResolvedValue({ ok: true, data: { id: CAMPAIGN_ID } });
});

describe('report kampaně: 404 jen z opravdové 404', () => {
  it('vymyšlené id kampaně dostane 404, ne prázdný report', async () => {
    apiFetch.mockResolvedValue({ ok: false, problem: problem(404, 'not_found') });

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('vypršení požadavku ukáže chybový blok, ne stránku nenalezena', async () => {
    apiFetch.mockResolvedValue({ ok: false, problem: problem(504, 'dependency_timeout') });

    const props = await renderProblem();

    expect(notFound).not.toHaveBeenCalled();
    expect(props['problem']).toMatchObject({ code: 'dependency_timeout' });
  });

  it('nedostupné API ukáže chybový blok, ne stránku nenalezena', async () => {
    apiFetch.mockResolvedValue({ ok: false, problem: problem(503, 'service_unavailable') });

    const props = await renderProblem();

    expect(notFound).not.toHaveBeenCalled();
    expect(props['problem']).toMatchObject({ code: 'service_unavailable' });
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

  it('existující kampaň se vykreslí, kampaň se čte v kontextu projektu', async () => {
    const element = await renderPage();

    expect(notFound).not.toHaveBeenCalled();
    expect(element).not.toBeNull();
    expect(apiFetch).toHaveBeenCalledWith(`/api/v1/campaigns/${CAMPAIGN_ID}`, {
      workspaceId: WORKSPACE.id,
    });
  });
});
