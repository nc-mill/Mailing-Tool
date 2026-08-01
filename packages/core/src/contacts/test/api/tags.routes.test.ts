import { beforeEach, describe, expect, it, vi } from 'vitest';

const repo = vi.hoisted(() => ({
  listTagsPage: vi.fn(),
  getTag: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  mergeTags: vi.fn(),
  bulkTagContacts: vi.fn(),
}));
const permissions = vi.hoisted(() => ({ assertPermission: vi.fn() }));

vi.mock('../../repo/tags', () => repo);
vi.mock('../../../identity/permissions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...permissions,
}));

const { registerTagRoutes } = await import('../../api/tags.routes');
const { apiHarness, JSON_HEADERS } = await import('./harness');

const TAG_ROW = {
  id: '0198e2c1-6b3f-7c21-9a44-0f3c7a1b2d5e',
  name: 'vip',
  color: '#3366ff',
  contact_count: 12,
  created_at: new Date('2026-07-31T10:15:30Z'),
};

const app = () => apiHarness(registerTagRoutes);

beforeEach(() => {
  vi.clearAllMocks();
  permissions.assertPermission.mockReturnValue(undefined);
  repo.getTag.mockResolvedValue(TAG_ROW);
});

describe('/tags', () => {
  it('seznam vrací kurzorovanou stránku', async () => {
    repo.listTagsPage.mockResolvedValue({ rows: [TAG_ROW], nextCursor: null, hasMore: false });
    const res = await app().request('/tags');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { name: string }[] };
    expect(body.data[0]?.name).toBe('vip');
  });

  it('vytvoření vrací 201', async () => {
    repo.createTag.mockResolvedValue({ id: TAG_ROW.id });
    const res = await app().request('/tags', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'vip' }),
    });
    expect(res.status).toBe(201);
  });

  it('barva mimo hex tvar vrací 422', async () => {
    const res = await app().request('/tags', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'vip', color: 'modrá' }),
    });
    expect(res.status).toBe(422);
  });

  it('smazání vrací 204', async () => {
    repo.deleteTag.mockResolvedValue(true);
    const res = await app().request(`/tags/${TAG_ROW.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
  });

  it('smazání neexistujícího štítku vrací 404', async () => {
    repo.deleteTag.mockResolvedValue(false);
    const res = await app().request(`/tags/${TAG_ROW.id}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

describe('POST /tags/{id}/merge', () => {
  it('sloučí štítek do cílového a vrátí počet přesunutých kontaktů', async () => {
    repo.mergeTags.mockResolvedValue(undefined);
    const res = await app().request(`/tags/${TAG_ROW.id}/merge`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ into_tag_id: '0198e2c2-0000-7c21-9a44-0f3c7a1b2d5e' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ moved: 12 });
  });

  it('sloučení do sebe sama vrací 422', async () => {
    const res = await app().request(`/tags/${TAG_ROW.id}/merge`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ into_tag_id: TAG_ROW.id }),
    });
    expect(res.status).toBe(422);
    expect(repo.mergeTags).not.toHaveBeenCalled();
  });
});

describe('POST /contacts/tags:bulk', () => {
  it('hromadné přiřazení nad limitem vrací 202, protože běží ve frontě', async () => {
    repo.bulkTagContacts.mockResolvedValue({ mode: 'queued' });
    const res = await app().request('/contacts/tags:bulk', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ filter: { contact_ids: [TAG_ROW.id] }, add: [TAG_ROW.id] }),
    });
    expect(res.status).toBe(202);
  });

  it('malý výběr proběhne synchronně a vrátí 200 s počty', async () => {
    repo.bulkTagContacts.mockResolvedValue({ mode: 'sync', tagged: 3, untagged: 0 });
    const res = await app().request('/contacts/tags:bulk', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ filter: { contact_ids: [TAG_ROW.id] }, add: [TAG_ROW.id] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: 'sync', tagged: 3, untagged: 0 });
  });

  it('bez add i remove vrací 422', async () => {
    const res = await app().request('/contacts/tags:bulk', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ filter: { contact_ids: [TAG_ROW.id] }, add: [], remove: [] }),
    });
    expect(res.status).toBe(422);
  });
});
