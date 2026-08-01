import { beforeEach, describe, expect, it, vi } from 'vitest';

const repo = vi.hoisted(() => ({
  listReviewGroups: vi.fn(),
  countReviewTotals: vi.fn(),
  countGroup: vi.fn(),
}));
const actions = vi.hoisted(() => ({ applyGroupAction: vi.fn() }));
const overrides = vi.hoisted(() => ({
  listNameOverrides: vi.fn(),
  upsertNameOverride: vi.fn(),
  deleteNameOverride: vi.fn(),
}));
const permissions = vi.hoisted(() => ({ assertPermission: vi.fn() }));

vi.mock('../../repo/vocative-review', () => repo);
vi.mock('../../vocative-review/actions', () => actions);
vi.mock('../../repo/name-overrides', () => overrides);
vi.mock('../../../identity/permissions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...permissions,
}));

const { registerVocativeReviewRoutes } = await import('../../api/vocative-review.routes');
const { registerNameOverrideRoutes } = await import('../../api/name-overrides.routes');
const { apiHarness, JSON_HEADERS } = await import('./harness');

const ID = '0198e2c1-6b3f-7c21-9a44-0f3c7a1b2d5e';

const GROUP = {
  name_key: 'nikola',
  kind: 'first' as const,
  gender: 'unknown' as const,
  gender_source: 'given_name_dict',
  suggested_vocative: null,
  contact_count: 2,
  sample_surnames: ['Krátká', 'Krátký'],
  sample_contact_id: ID,
  reasons: ['gender_unknown', 'ambiguous_given_name'],
};

beforeEach(() => {
  vi.clearAllMocks();
  permissions.assertPermission.mockReturnValue(undefined);
  repo.countReviewTotals.mockResolvedValue({ groups: 1, contacts: 2, ratio: 0.02 });
});

describe('GET /vocative-review', () => {
  const app = () => apiHarness(registerVocativeReviewRoutes);

  it('vrací skupiny i celkové počty', async () => {
    repo.listReviewGroups.mockResolvedValue([GROUP]);
    const res = await app().request('/vocative-review');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { name_key: string }[];
      total_groups: number;
      soft_limit_exceeded: boolean;
    };
    expect(body.data[0]?.name_key).toBe('nikola');
    expect(body.total_groups).toBe(1);
    expect(body.soft_limit_exceeded).toBe(false);
  });

  it('nad stropem ruční práce nastaví soft_limit_exceeded', async () => {
    repo.listReviewGroups.mockResolvedValue([]);
    repo.countReviewTotals.mockResolvedValue({ groups: 101, contacts: 400, ratio: 0.4 });
    const res = await app().request('/vocative-review');
    expect(((await res.json()) as { soft_limit_exceeded: boolean }).soft_limit_exceeded).toBe(true);
  });

  it('fronta jde omezit na jeden import', async () => {
    repo.listReviewGroups.mockResolvedValue([]);
    await app().request('/vocative-review?import_id=import-1&kind=last');
    expect(repo.listReviewGroups).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ importId: 'import-1', kind: 'last' }),
    );
  });

  it('cesta count nespadne do výpisu skupin', async () => {
    const res = await app().request('/vocative-review/count');
    expect(res.status).toBe(200);
    expect(repo.listReviewGroups).not.toHaveBeenCalled();
  });
});

describe('POST /vocative-review/confirm', () => {
  const app = () => apiHarness(registerVocativeReviewRoutes);

  it('provede akci nad skupinou a vrátí režim i počet', async () => {
    actions.applyGroupAction.mockResolvedValue({ mode: 'sync', affected: 2 });
    const res = await app().request('/vocative-review/confirm', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ groups: [{ name_key: 'nikola', action: 'confirm' }] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [{ name_key: 'nikola', mode: 'sync', affected: 2 }],
    });
  });

  it('výchozí save_override je true, jinak se fronta nikdy nevyprázdní', async () => {
    actions.applyGroupAction.mockResolvedValue({ mode: 'sync', affected: 1 });
    await app().request('/vocative-review/confirm', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ groups: [{ name_key: 'nikola', action: 'confirm' }] }),
    });
    expect(actions.applyGroupAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ saveOverride: true, kind: 'first' }),
    );
  });

  it('ROZHODNUTÍ R15: akce defer se odmítne, endpoint ji neumí provést', async () => {
    const res = await app().request('/vocative-review/confirm', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ groups: [{ name_key: 'nikola', action: 'defer' }] }),
    });
    expect(res.status).toBe(422);
    expect(actions.applyGroupAction).not.toHaveBeenCalled();
  });
});

describe('/name-overrides', () => {
  const app = () => apiHarness(registerNameOverrideRoutes);

  it('seznam vrací přepisy projektu', async () => {
    overrides.listNameOverrides.mockResolvedValue([
      {
        id: ID,
        kind: 'first',
        name_key: 'nikola',
        gender: 'female',
        vocative: 'Nikolo',
        note: null,
        created_at: new Date('2026-07-31T10:15:30Z'),
      },
    ]);
    const res = await app().request('/name-overrides');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { name_key: string }[] };
    expect(body.data[0]?.name_key).toBe('nikola');
  });

  it('založení vrací 201', async () => {
    overrides.upsertNameOverride.mockResolvedValue(ID);
    const res = await app().request('/name-overrides', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'Nikola', gender: 'female' }),
    });
    expect(res.status).toBe(201);
  });

  it('smazání neexistujícího přepisu vrací 404', async () => {
    overrides.deleteNameOverride.mockResolvedValue(false);
    const res = await app().request(`/name-overrides/${ID}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
