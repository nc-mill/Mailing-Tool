import { beforeEach, describe, expect, it, vi } from 'vitest';

const repo = vi.hoisted(() => ({
  listContactFields: vi.fn(),
  getFieldLimits: vi.fn(),
  createContactField: vi.fn(),
  getContactField: vi.fn(),
  updateContactField: vi.fn(),
  archiveContactField: vi.fn(),
  deleteContactField: vi.fn(),
  requestFieldIndex: vi.fn(),
  getFieldImpact: vi.fn(),
}));
const permissions = vi.hoisted(() => ({ assertPermission: vi.fn() }));

vi.mock('../../repo/contact-fields', () => repo);
vi.mock('../../../identity/permissions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...permissions,
}));

const { registerContactFieldRoutes } = await import('../../api/contact-fields.routes');
const { apiHarness, JSON_HEADERS } = await import('./harness');

const FIELD = {
  id: '0198e2c1-6b3f-7c21-9a44-0f3c7a1b2d5e',
  key: 'city',
  label: { cs: 'Město', en: 'City' },
  description: {},
  type: 'text' as const,
  options: {},
  required: false,
  subjectEditable: true,
  indexed: false,
  indexState: 'none' as const,
  position: 1,
  archivedAt: null,
  createdAt: new Date('2026-07-31T10:15:30Z'),
  updatedAt: new Date('2026-07-31T10:15:30Z'),
};

const app = () => apiHarness(registerContactFieldRoutes);

beforeEach(() => {
  vi.clearAllMocks();
  permissions.assertPermission.mockReturnValue(undefined);
  repo.getFieldLimits.mockResolvedValue({ used: 1, limit: 100, indexedUsed: 0, indexedLimit: 8 });
  repo.getContactField.mockResolvedValue(FIELD);
});

describe('GET /contact-fields', () => {
  it('vrací pole i s využitím limitů', async () => {
    repo.listContactFields.mockResolvedValue([FIELD]);
    const res = await app().request('/contact-fields');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { key: string }[]; limits: { limit: number } };
    expect(body.data[0]?.key).toBe('city');
    expect(body.limits.limit).toBe(100);
  });
});

describe('POST /contact-fields', () => {
  it('vytvoří pole a vrátí 201', async () => {
    repo.createContactField.mockResolvedValue({ id: FIELD.id });
    const res = await app().request('/contact-fields', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ key: 'city', label: { en: 'City' }, type: 'text' }),
    });
    expect(res.status).toBe(201);
  });

  it('label bez povinného klíče en vrací 422', async () => {
    const res = await app().request('/contact-fields', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ key: 'city', label: { cs: 'Město' }, type: 'text' }),
    });
    expect(res.status).toBe(422);
  });

  it('klíč mimo lower_snake_case vrací 422', async () => {
    const res = await app().request('/contact-fields', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ key: 'City Name', label: { en: 'City' }, type: 'text' }),
    });
    expect(res.status).toBe(422);
  });

  it('typ mimo výčet DDL vrací 422, ne chybu databáze', async () => {
    const res = await app().request('/contact-fields', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ key: 'city', label: { en: 'City' }, type: 'select' }),
    });
    expect(res.status).toBe(422);
  });
});

describe('PATCH /contact-fields/{id}', () => {
  it('typ v těle vůbec nejde poslat, schéma ho nezná', async () => {
    const res = await app().request(`/contact-fields/${FIELD.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ type: 'number' }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: { path: string; code: string }[] };
    expect(body.errors).toContainEqual(
      expect.objectContaining({ path: 'type', code: 'unknown_field_key' }),
    );
  });
});

describe('DELETE /contact-fields/{id}', () => {
  it('vrací 204 bez těla', async () => {
    repo.deleteContactField.mockResolvedValue(undefined);
    const res = await app().request(`/contact-fields/${FIELD.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
  });

  it('žádá scope contacts:write', async () => {
    repo.deleteContactField.mockResolvedValue(undefined);
    await app().request(`/contact-fields/${FIELD.id}`, { method: 'DELETE' });
    expect(permissions.assertPermission).toHaveBeenCalledWith(expect.anything(), 'contacts:write');
  });
});

describe('POST /contact-fields/{id}/index', () => {
  it('vrací 202 a stav indexace, protože prověrka běží na pozadí', async () => {
    repo.requestFieldIndex.mockResolvedValue(undefined);
    repo.getContactField.mockResolvedValue({ ...FIELD, indexState: 'building' });
    const res = await app().request(`/contact-fields/${FIELD.id}/index`, { method: 'POST' });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ index_state: 'building' });
  });
});

describe('POST /contact-fields/{id}/archive', () => {
  it('vrací archivované pole', async () => {
    repo.archiveContactField.mockResolvedValue(undefined);
    repo.getContactField.mockResolvedValue({
      ...FIELD,
      archivedAt: new Date('2026-07-31T11:00:00Z'),
    });
    const res = await app().request(`/contact-fields/${FIELD.id}/archive`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { archived_at: string } };
    expect(body.data.archived_at).toBe('2026-07-31T11:00:00.000Z');
  });
});
