import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => ({
  listContacts: vi.fn(),
  countContacts: vi.fn(),
  getContactById: vi.fn(),
  findContactByEmail: vi.fn(),
}));
const write = vi.hoisted(() => ({
  upsertContactFromApi: vi.fn(),
  patchContact: vi.fn(),
  batchUpsertFromApi: vi.fn(),
}));
const repo = vi.hoisted(() => ({
  deleteContact: vi.fn(),
  restoreContact: vi.fn(),
  changeContactEmail: vi.fn(),
}));
const confirm = vi.hoisted(() => ({ confirmContactManually: vi.fn() }));
const gdpr = vi.hoisted(() => ({ createGdprRequest: vi.fn() }));
const permissions = vi.hoisted(() => ({ assertPermission: vi.fn() }));

vi.mock('../../repo/contacts-query', () => query);
vi.mock('../../repo/contacts-api', () => write);
vi.mock('../../repo/contacts', () => repo);
vi.mock('../../repo/contact-confirm', () => confirm);
vi.mock('../../repo/gdpr', () => gdpr);
// Částečný mock: `identity/api/schemas.ts` čte z tohohle modulu i `PERMISSIONS`,
// takže úplná náhrada by shodila import celého route souboru.
vi.mock('../../../identity/permissions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...permissions,
}));

const { registerContactRoutes } = await import('../../api/contacts.routes');
const { apiHarness, JSON_HEADERS } = await import('./harness');

const CONTACT = {
  id: '0198e2c1-6b3f-7c21-9a44-0f3c7a1b2d5e',
  email: 'jan@example.cz',
  status: 'active',
  first_name: 'Jan',
  last_name: 'Novák',
  middle_name: null,
  title_prefix: null,
  title_suffix: null,
  gender: 'male',
  gender_source: 'given_name_dict',
  first_name_vocative: 'Jane',
  last_name_vocative: 'Nováku',
  vocative_confidence: 'high',
  vocative_locked: false,
  greeting: 'Dobrý den, Jane',
  locale: 'cs',
  attributes: {},
  tags: [],
  lists: [],
  consents: [],
  suppression: null,
  processing_restricted: false,
  source: 'api',
  created_at: '2026-07-31T10:15:30.000Z',
  updated_at: '2026-07-31T10:15:30.000Z',
  last_activity_at: null,
};

const app = () => apiHarness(registerContactRoutes);

beforeEach(() => {
  vi.clearAllMocks();
  permissions.assertPermission.mockReturnValue(undefined);
});

describe('GET /contacts', () => {
  it('vrací obálku bez celkového počtu', async () => {
    query.listContacts.mockResolvedValue({
      rows: [CONTACT],
      nextCursor: 'c2',
      prevCursor: null,
      hasMore: true,
    });
    const res = await app().request('/contacts?limit=1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pagination: Record<string, unknown> };
    expect(body.pagination).toEqual({
      next_cursor: 'c2',
      prev_cursor: null,
      has_more: true,
      limit: 1,
    });
    expect(body.pagination).not.toHaveProperty('total');
  });

  it('odmítne řazení podle e-mailu, protože pro něj není index', async () => {
    const res = await app().request('/contacts?order=email.asc');
    expect(res.status).toBe(422);
  });

  it('žádá scope contacts:read', async () => {
    query.listContacts.mockResolvedValue({
      rows: [],
      nextCursor: null,
      prevCursor: null,
      hasMore: false,
    });
    await app().request('/contacts');
    expect(permissions.assertPermission).toHaveBeenCalledWith(expect.anything(), 'contacts:read');
  });
});

describe('GET /contacts/count', () => {
  it('vrací počet, přesnost, čas a příznak zastaralosti', async () => {
    query.countContacts.mockResolvedValue({
      count: 4211,
      precision: 'exact',
      computedAt: new Date('2026-07-31T10:15:30Z'),
      stale: false,
    });
    const res = await app().request('/contacts/count?status=active');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      count: 4211,
      precision: 'exact',
      computed_at: '2026-07-31T10:15:30.000Z',
      stale: false,
    });
  });

  it('cesta count nespadne do parametru {id}', async () => {
    query.countContacts.mockResolvedValue({
      count: 0,
      precision: 'exact',
      computedAt: new Date(),
      stale: false,
    });
    const res = await app().request('/contacts/count');
    expect(res.status).toBe(200);
    expect(query.getContactById).not.toHaveBeenCalled();
  });
});

describe('POST /contacts', () => {
  it('neznámý klíč v těle vrací 422 s unknown_field_key', async () => {
    const res = await app().request('/contacts', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: 'jan@example.cz', nope: 1 }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: { path: string; code: string }[] };
    expect(body.errors).toContainEqual(
      expect.objectContaining({ path: 'nope', code: 'unknown_field_key' }),
    );
  });

  it('vytvořený kontakt vrací 201, hlavičku Location a normalizovanou adresu', async () => {
    write.upsertContactFromApi.mockResolvedValue({
      contact: CONTACT,
      created: true,
      warnings: [],
    });
    const res = await app().request('/contacts', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: '  JAN@Example.CZ ' }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('Location')).toBe(`/api/v1/contacts/${CONTACT.id}`);
    expect(write.upsertContactFromApi).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: 'jan@example.cz' }),
    );
  });

  it('aktualizovaný kontakt vrací 200', async () => {
    write.upsertContactFromApi.mockResolvedValue({
      contact: CONTACT,
      created: false,
      warnings: [],
    });
    const res = await app().request('/contacts', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: 'jan@example.cz' }),
    });
    expect(res.status).toBe(200);
    // Bez přeskoku se pole varování v těle vůbec neobjeví. Prázdné pole v každé odpovědi
    // by klienty naučilo ho ignorovat, a přesně tohle pole ignorovat nemají.
    expect(await res.json()).not.toHaveProperty('warnings');
  });

  it('přeskočený seznam se ohlásí v těle, ne mlčením', async () => {
    write.upsertContactFromApi.mockResolvedValue({
      contact: CONTACT,
      created: false,
      warnings: ['suppressed_skipped'],
    });
    const res = await app().request('/contacts', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: 'jan@example.cz' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).warnings).toEqual(['suppressed_skipped']);
  });

  it('neplatná adresa vrací 422 s kódem invalid_email', async () => {
    const res = await app().request('/contacts', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: 'jan@' }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: { code: string }[] };
    expect(body.errors[0]?.code).toBe('invalid_email');
  });
});

describe('GET /contacts/{id}', () => {
  it('cizí nebo neexistující ID vrací 404, nikdy 403', async () => {
    query.getContactById.mockResolvedValue(null);
    const res = await app().request(`/contacts/${CONTACT.id}`);
    expect(res.status).toBe(404);
  });

  it('vadné UUID v cestě vrací 422 s invalid_uuid', async () => {
    const res = await app().request('/contacts/nejsem-uuid');
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: { code: string }[] };
    expect(body.errors[0]?.code).toBe('invalid_uuid');
  });
});

describe('DELETE /contacts/{id}', () => {
  it('mode=soft vrací 204 bez těla', async () => {
    repo.deleteContact.mockResolvedValue(undefined);
    const res = await app().request(`/contacts/${CONTACT.id}?mode=soft`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('bez parametru mode se chová jako soft', async () => {
    repo.deleteContact.mockResolvedValue(undefined);
    const res = await app().request(`/contacts/${CONTACT.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(repo.deleteContact).toHaveBeenCalledWith(expect.anything(), CONTACT.id, 'soft');
  });

  it('mode=anonymize vrací 202 a žádá scope gdpr:erase', async () => {
    query.getContactById.mockResolvedValue(CONTACT);
    gdpr.createGdprRequest.mockResolvedValue({ id: 'req-1', status: 'verifying' });
    const res = await app().request(`/contacts/${CONTACT.id}?mode=anonymize`, { method: 'DELETE' });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ request_id: 'req-1' });
    expect(permissions.assertPermission).toHaveBeenCalledWith(expect.anything(), 'gdpr:erase');
  });

  it('mode=purge žádá navíc scope contacts:delete', async () => {
    query.getContactById.mockResolvedValue(CONTACT);
    gdpr.createGdprRequest.mockResolvedValue({ id: 'req-2', status: 'verifying' });
    await app().request(`/contacts/${CONTACT.id}?mode=purge`, { method: 'DELETE' });
    expect(permissions.assertPermission).toHaveBeenCalledWith(expect.anything(), 'contacts:delete');
  });

  it('neznámý mode vrací 422', async () => {
    const res = await app().request(`/contacts/${CONTACT.id}?mode=shred`, { method: 'DELETE' });
    expect(res.status).toBe(422);
  });
});

describe('POST /contacts/lookup', () => {
  it('je POST, takže adresa není v cestě', async () => {
    query.findContactByEmail.mockResolvedValue(CONTACT);
    const res = await app().request('/contacts/lookup', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: 'Jan@Example.cz' }),
    });
    expect(res.status).toBe(200);
    expect(query.findContactByEmail).toHaveBeenCalledWith(expect.anything(), 'jan@example.cz');
  });

  it('neznámou adresu vrací jako data: null, ne jako 404', async () => {
    query.findContactByEmail.mockResolvedValue(null);
    const res = await app().request('/contacts/lookup', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: 'nikdo@example.cz' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { data: unknown }).toEqual({ data: null });
  });
});

describe('POST /contacts/batch', () => {
  it('nad 1000 položek vrací 422 s too_many_items', async () => {
    const items = Array.from({ length: 1001 }, (_, i) => ({ email: `a${i}@example.cz` }));
    const res = await app().request('/contacts/batch', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ items }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: { path: string; code: string }[] };
    expect(body.errors).toContainEqual(
      expect.objectContaining({ path: 'items', code: 'too_many_items' }),
    );
  });

  it('vrací výsledek po položkách včetně indexu', async () => {
    write.batchUpsertFromApi.mockResolvedValue({
      results: [
        { index: 0, status: 'created', id: CONTACT.id },
        { index: 1, status: 'error', error: { code: 'invalid_email' } },
      ],
    });
    const res = await app().request('/contacts/batch', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ items: [{ email: 'a@example.cz' }, { email: 'b@example.cz' }] }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { results: unknown[] }).results).toHaveLength(2);
  });
});

describe('POST /contacts/{id}/change-email a /restore', () => {
  it('change-email normalizuje novou adresu', async () => {
    repo.changeContactEmail.mockResolvedValue(undefined);
    query.getContactById.mockResolvedValue(CONTACT);
    await app().request(`/contacts/${CONTACT.id}/change-email`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: ' NOVA@Example.CZ ' }),
    });
    expect(repo.changeContactEmail).toHaveBeenCalledWith(
      expect.anything(),
      CONTACT.id,
      'nova@example.cz',
    );
  });

  it('restore vrací obnovený kontakt', async () => {
    repo.restoreContact.mockResolvedValue(undefined);
    query.getContactById.mockResolvedValue(CONTACT);
    const res = await app().request(`/contacts/${CONTACT.id}/restore`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { id: string } }).data.id).toBe(CONTACT.id);
  });
});

/**
 * Ruční povýšení na potvrzený. Endpoint existuje právě proto, že `PATCH` se stavem
 * `active` by u odhlášeného kontaktu odpověděl 200 a nezměnil nic.
 */
describe('POST /contacts/{id}/confirm', () => {
  function outcome(overrides: Record<string, unknown> = {}) {
    return {
      contactId: CONTACT.id,
      fromStatus: 'unsubscribed',
      changed: true,
      listsConfirmed: 2,
      suppressionRemoved: ['global_unsubscribe'],
      suppressionBlocking: null,
      ...overrides,
    };
  }

  it('vrátí kontakt i souhrn toho, co se stalo', async () => {
    confirm.confirmContactManually.mockResolvedValue(outcome());
    query.getContactById.mockResolvedValue(CONTACT);

    const res = await app().request(`/contacts/${CONTACT.id}/confirm`, { method: 'POST' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string };
      confirm: Record<string, unknown>;
    };
    expect(body.data.id).toBe(CONTACT.id);
    expect(body.confirm).toEqual({
      from_status: 'unsubscribed',
      changed: true,
      lists_confirmed: 2,
      suppression_removed: ['global_unsubscribe'],
      suppression_blocking: null,
    });
    expect(confirm.confirmContactManually).toHaveBeenCalledWith(expect.anything(), CONTACT.id);
  });

  it('zůstávající blokaci adresy vrací v těle, ne mlčí o ní', async () => {
    // Bez tohohle pole by klient ohlásil úspěch u kontaktu, kterému odesílací cesta
    // stejně nic nedoručí, protože suppression je vrstva NAD stavem kontaktu.
    confirm.confirmContactManually.mockResolvedValue(
      outcome({
        fromStatus: 'complained',
        suppressionRemoved: [],
        suppressionBlocking: 'complaint',
      }),
    );
    query.getContactById.mockResolvedValue(CONTACT);

    const res = await app().request(`/contacts/${CONTACT.id}/confirm`, { method: 'POST' });

    const body = (await res.json()) as { confirm: { suppression_blocking: string | null } };
    expect(body.confirm.suppression_blocking).toBe('complaint');
  });
});
