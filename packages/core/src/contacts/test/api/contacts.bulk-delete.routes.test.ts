import { beforeEach, describe, expect, it, vi } from 'vitest';

const repo = vi.hoisted(() => ({
  bulkDeleteContacts: vi.fn(),
  deleteContact: vi.fn(),
  restoreContact: vi.fn(),
  changeContactEmail: vi.fn(),
}));
const permissions = vi.hoisted(() => ({ assertPermission: vi.fn() }));

vi.mock('../../repo/contacts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...repo,
}));
vi.mock('../../../identity/permissions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...permissions,
}));

const { registerContactRoutes } = await import('../../api/contacts.routes');
const { apiHarness, JSON_HEADERS } = await import('./harness');

const app = () => apiHarness(registerContactRoutes);

const ID_A = '0198e2c1-6b3f-7c21-9a44-0f3c7a1b2d5e';
const ID_B = '0198e2c1-6b3f-7c21-9a44-0f3c7a1b2d5f';

async function post(body: unknown): Promise<Response> {
  return app().request('/contacts/bulk-delete', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  permissions.assertPermission.mockReturnValue(undefined);
  repo.bulkDeleteContacts.mockResolvedValue({ mode: 'queued' });
});

describe('POST /contacts/bulk-delete', () => {
  it('výčet id vrací 202 a zařadí mazání', async () => {
    const res = await post({ ids: [ID_A, ID_B] });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ mode: 'queued' });
    expect(repo.bulkDeleteContacts).toHaveBeenCalledWith(expect.anything(), {
      mode: 'ids',
      ids: [ID_A, ID_B],
    });
  });

  it('filtr se předává doménové funkci beze změny', async () => {
    const res = await post({ filter: { status: 'bounced', tag_id: ID_A } });

    expect(res.status).toBe(202);
    expect(repo.bulkDeleteContacts).toHaveBeenCalledWith(expect.anything(), {
      mode: 'filter',
      filter: { status: 'bounced', tag_id: ID_A },
    });
  });

  it('prázdný filtr znamená celý projekt a projde', async () => {
    // Volba "označit vše" bez zapnutého filtru. Potvrzuje ji dialog úrovně N3,
    // ne odmítnutí na serveru.
    const res = await post({ filter: {} });

    expect(res.status).toBe(202);
    expect(repo.bulkDeleteContacts).toHaveBeenCalledWith(expect.anything(), {
      mode: 'filter',
      filter: {},
    });
  });

  it('tělo bez rozsahu vrací 422 a nic nezařadí', async () => {
    const res = await post({});

    expect(res.status).toBe(422);
    expect(repo.bulkDeleteContacts).not.toHaveBeenCalled();
  });

  it('id i filtr naráz vrací 422', async () => {
    const res = await post({ ids: [ID_A], filter: { status: 'bounced' } });

    expect(res.status).toBe(422);
    expect(repo.bulkDeleteContacts).not.toHaveBeenCalled();
  });

  it('prázdný výčet id vrací 422', async () => {
    const res = await post({ ids: [] });

    expect(res.status).toBe(422);
    expect(repo.bulkDeleteContacts).not.toHaveBeenCalled();
  });

  it('id, které není UUID, vrací 422', async () => {
    const res = await post({ ids: ['smaz-vsechno'] });

    expect(res.status).toBe(422);
    expect(repo.bulkDeleteContacts).not.toHaveBeenCalled();
  });

  it('neznámý klíč ve filtru vrací 422, ne tiché ignorování', async () => {
    // Překlep v názvu filtru by jinak znamenal, že se smaže širší množina,
    // než jakou uživatel viděl.
    const res = await post({ filter: { statuss: 'bounced' } });

    expect(res.status).toBe(422);
    expect(repo.bulkDeleteContacts).not.toHaveBeenCalled();
  });

  it('bez oprávnění contacts:write se nemaže', async () => {
    const { ApiError } = await import('../../../errors/api-error');
    permissions.assertPermission.mockImplementation(() => {
      throw new ApiError('forbidden');
    });

    const res = await post({ ids: [ID_A] });

    expect(res.status).toBe(403);
    expect(repo.bulkDeleteContacts).not.toHaveBeenCalled();
  });

  it('cesta se nedostane do /contacts/{id}', async () => {
    // Kdyby se `bulk-delete` zaregistrovalo až za `/contacts/{id}`, router by ho
    // poslal do parametru a klient by dostal chybu o neplatném UUID místo 202.
    const res = await post({ ids: [ID_A] });
    const body = (await res.json()) as { mode?: string; code?: string };

    expect(body.mode).toBe('queued');
    expect(body.code).toBeUndefined();
  });
});
