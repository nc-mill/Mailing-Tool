import { beforeEach, describe, expect, it, vi } from 'vitest';

const suppressions = vi.hoisted(() => ({
  listSuppressionsPage: vi.fn(),
  getSuppression: vi.fn(),
  removeSuppression: vi.fn(),
  addSuppression: vi.fn(),
}));
const gdpr = vi.hoisted(() => ({
  listGdprRequests: vi.fn(),
  findGdprRequest: vi.fn(),
  createGdprRequest: vi.fn(),
  extendGdprRequest: vi.fn(),
  rejectGdprRequest: vi.fn(),
  verifyGdprRequest: vi.fn(),
  processGdprRequest: vi.fn(),
}));
const retention = vi.hoisted(() => ({
  listRetentionPolicies: vi.fn(),
  saveRetentionPolicies: vi.fn(),
  estimateRetentionImpact: vi.fn(),
}));
const contactsQuery = vi.hoisted(() => ({
  getContactById: vi.fn(),
  listContacts: vi.fn(),
  countContacts: vi.fn(),
  findContactByEmail: vi.fn(),
}));
const permissions = vi.hoisted(() => ({ assertPermission: vi.fn() }));

vi.mock('../../repo/suppressions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...suppressions,
}));
vi.mock('../../repo/gdpr', () => gdpr);
vi.mock('../../repo/retention', () => retention);
vi.mock('../../repo/contacts-query', () => contactsQuery);
vi.mock('../../../identity/permissions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...permissions,
}));

const { registerSuppressionRoutes } = await import('../../api/suppressions.routes');
const { registerGdprRoutes } = await import('../../api/gdpr.routes');
const { registerRetentionRoutes } = await import('../../api/retention.routes');
const { apiHarness, JSON_HEADERS } = await import('./harness');
const { ApiError } = await import('../../../errors/api-error');

const ID = '0198e2c1-6b3f-7c21-9a44-0f3c7a1b2d5e';
const DAY = 86_400_000;

function suppression(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    email: 'jan.novak@example.cz',
    reason: 'manual',
    source: 'api',
    detail: null,
    metadata: {},
    removable: true,
    created_at: new Date(Date.now() - 100 * DAY),
    ...overrides,
  };
}

const GDPR_ROW = {
  id: ID,
  contact_id: null,
  type: 'erasure' as const,
  mode: 'anonymize' as const,
  status: 'verifying',
  channel: 'api',
  requested_at: new Date('2026-07-31T10:15:30Z'),
  due_at: new Date('2026-08-31T10:15:30Z'),
  extended_until: null,
  completed_at: null,
  rejection_reason: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  permissions.assertPermission.mockReturnValue(undefined);
  contactsQuery.getContactById.mockResolvedValue(null);
});

describe('GET /suppressions', () => {
  const app = () => apiHarness(registerSuppressionRoutes);

  it('maskuje adresy v odpovědi', async () => {
    suppressions.listSuppressionsPage.mockResolvedValue({
      rows: [suppression()],
      nextCursor: null,
      hasMore: false,
    });
    const res = await app().request('/suppressions');
    const body = (await res.json()) as { data: Record<string, unknown>[] };
    expect(body.data[0]).toHaveProperty('masked_email');
    expect(body.data[0]).not.toHaveProperty('email');
    expect(body.data[0]?.['masked_email']).not.toContain('jan.novak');
  });

  it('filtruje podle důvodu', async () => {
    suppressions.listSuppressionsPage.mockResolvedValue({
      rows: [],
      nextCursor: null,
      hasMore: false,
    });
    const res = await app().request('/suppressions?reason=complaint');
    expect(res.status).toBe(200);
    expect(suppressions.listSuppressionsPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: 'complaint' }),
    );
  });
});

describe('DELETE /suppressions/{id}', () => {
  const app = () => apiHarness(registerSuppressionRoutes);

  it('KRITÉRIUM 61: stížnost vrátí 403 se suppression_not_removable', async () => {
    suppressions.getSuppression.mockResolvedValue(suppression({ reason: 'complaint' }));
    const res = await app().request(`/suppressions/${ID}`, {
      method: 'DELETE',
      headers: JSON_HEADERS,
      body: JSON.stringify({ note: 'omyl' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { params: { detail: string } };
    expect(body.params.detail).toBe('suppression_not_removable');
  });

  it('KRITÉRIUM 62: čerstvý tvrdý odraz vrátí 409 se suppression_too_recent', async () => {
    suppressions.getSuppression.mockResolvedValue(
      suppression({ reason: 'hard_bounce', created_at: new Date(Date.now() - 2 * DAY) }),
    );
    const res = await app().request(`/suppressions/${ID}`, {
      method: 'DELETE',
      headers: JSON_HEADERS,
      body: JSON.stringify({ note: 'zkusme to' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { params: Record<string, unknown> };
    expect(body.params['detail']).toBe('suppression_too_recent');
    // Uživatel musí vidět, kolik dní zbývá, ne jen že to nejde.
    expect(body.params).toHaveProperty('days_remaining');
    expect(body.params['days_remaining']).toBe(28);
  });

  it('poznámka je povinná, odebrání se musí dát vysvětlit', async () => {
    suppressions.getSuppression.mockResolvedValue(suppression());
    const res = await app().request(`/suppressions/${ID}`, {
      method: 'DELETE',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });

  it('starý tvrdý odraz se poznámkou projde', async () => {
    suppressions.getSuppression.mockResolvedValue(suppression({ reason: 'hard_bounce' }));
    suppressions.removeSuppression.mockResolvedValue(undefined);
    const res = await app().request(`/suppressions/${ID}`, {
      method: 'DELETE',
      headers: JSON_HEADERS,
      body: JSON.stringify({ note: 'adresa opravena' }),
    });
    expect(res.status).toBe(204);
  });
});

describe('POST /gdpr-requests', () => {
  const app = () => apiHarness(registerGdprRoutes);

  it('vyžaduje scope gdpr:erase u výmazu', async () => {
    permissions.assertPermission.mockImplementation((_ctx: unknown, permission: string) => {
      if (permission === 'gdpr:erase') {
        throw new ApiError('insufficient_scope', { params: { permission } });
      }
    });
    const res = await app().request('/gdpr-requests', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: 'j@x.cz', type: 'erasure' }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('insufficient_scope');
  });

  it('vrátí 202 a stav žádosti', async () => {
    gdpr.createGdprRequest.mockResolvedValue({ id: ID, status: 'verifying' });
    gdpr.findGdprRequest.mockResolvedValue(GDPR_ROW);
    const res = await app().request('/gdpr-requests', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: 'j@x.cz', type: 'erasure', mode: 'anonymize' }),
    });
    expect(res.status).toBe(202);
    expect(((await res.json()) as { status: string }).status).toBe('verifying');
  });

  it('v odpovědi nikdy není plaintext adresy', async () => {
    gdpr.createGdprRequest.mockResolvedValue({ id: ID, status: 'verifying' });
    gdpr.findGdprRequest.mockResolvedValue({ ...GDPR_ROW, type: 'access', mode: null });
    const res = await app().request('/gdpr-requests', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: 'j@x.cz', type: 'access' }),
    });
    expect(JSON.stringify(await res.json())).not.toContain('j@x.cz');
  });
});

describe('POST /gdpr-requests/{id}/extend', () => {
  const app = () => apiHarness(registerGdprRoutes);

  it('vyžaduje důvod', async () => {
    const res = await app().request(`/gdpr-requests/${ID}/extend`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });

  it('KRITÉRIUM 66: prodlouží lhůtu o dva měsíce', async () => {
    gdpr.extendGdprRequest.mockResolvedValue(undefined);
    gdpr.findGdprRequest.mockResolvedValue({
      ...GDPR_ROW,
      extended_until: new Date('2026-10-31T10:15:30Z'),
    });
    const res = await app().request(`/gdpr-requests/${ID}/extend`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ reason: 'složitost žádosti' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { extended_until: string }).extended_until).toBeDefined();
  });
});

describe('PUT /retention-policies', () => {
  const owner = () => apiHarness(registerRetentionRoutes);
  const admin = () =>
    apiHarness(registerRetentionRoutes, {
      ctx: { actor: { type: 'user', userId: ID, role: 'admin' } },
    });

  it('smí jen vlastník projektu', async () => {
    const res = await admin().request('/retention-policies', {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ policies: [] }),
    });
    expect(res.status).toBe(403);
  });

  it('odmítne retenci pod minimem', async () => {
    const res = await owner().request('/retention-policies', {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        policies: [
          { target: 'form_submissions', retain_days: 0, action: 'anonymize', enabled: true },
        ],
      }),
    });
    expect(res.status).toBe(422);
    expect(retention.saveRetentionPolicies).not.toHaveBeenCalled();
  });

  it('při smazání víc než desetiny řádků vyžaduje potvrzení', async () => {
    retention.estimateRetentionImpact.mockResolvedValue({ rows: 500, total: 1000, ratio: 0.5 });
    const res = await owner().request('/retention-policies', {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        policies: [{ target: 'form_submissions', retain_days: 1, action: 'delete', enabled: true }],
      }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { params: Record<string, unknown> }).toHaveProperty(
      'params.affected_rows',
    );
    expect(retention.saveRetentionPolicies).not.toHaveBeenCalled();
  });

  it('s potvrzením se uloží', async () => {
    retention.estimateRetentionImpact.mockResolvedValue({ rows: 500, total: 1000, ratio: 0.5 });
    retention.saveRetentionPolicies.mockResolvedValue(undefined);
    retention.listRetentionPolicies.mockResolvedValue([]);
    const res = await owner().request('/retention-policies', {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        policies: [{ target: 'form_submissions', retain_days: 1, action: 'delete', enabled: true }],
        confirm_large_deletion: true,
      }),
    });
    expect(res.status).toBe(200);
    expect(retention.saveRetentionPolicies).toHaveBeenCalled();
  });
});
