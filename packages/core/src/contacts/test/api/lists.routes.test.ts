import { beforeEach, describe, expect, it, vi } from 'vitest';

const repo = vi.hoisted(() => ({
  create: vi.fn(),
  byId: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  setDefault: vi.fn(),
  stats: vi.fn(),
}));
const service = vi.hoisted(() => ({ subscribeToList: vi.fn(), resendConfirmation: vi.fn() }));
const unsub = vi.hoisted(() => ({
  unsubscribe: vi.fn(),
  snooze: vi.fn(),
  bulkUnsubscribeFromList: vi.fn(),
}));
const query = vi.hoisted(() => ({ findContactByEmail: vi.fn() }));
const permissions = vi.hoisted(() => ({ assertPermission: vi.fn() }));

vi.mock('../../repo/lists', () => repo);
vi.mock('../../lists/subscribe-service', () => service);
vi.mock('../../lists/unsubscribe', () => unsub);
vi.mock('../../repo/contacts-query', () => query);
vi.mock('../../../identity/permissions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...permissions,
}));

const { registerListRoutes } = await import('../../api/lists.routes');
const { apiHarness, JSON_HEADERS } = await import('./harness');

const LIST_ID = '0198e2c1-6b3f-7c21-9a44-0f3c7a1b2d5e';
const CONTACT_ID = '0198e2c2-0000-7c21-9a44-0f3c7a1b2d5e';

const LIST_ROW = {
  id: LIST_ID,
  workspaceId: '0198e2c0-0000-7000-8000-000000000001',
  name: 'Newsletter',
  description: null,
  optIn: 'double' as const,
  confirmationMode: 'one_step' as const,
  confirmationTtlHours: 168,
  confirmationTemplateId: null,
  welcomeTemplateId: null,
  sendWelcome: false,
  confirmationMaxResends: 3,
  isDefault: false,
  deletedAt: null,
  createdAt: new Date('2026-07-31T10:15:30Z'),
  updatedAt: new Date('2026-07-31T10:15:30Z'),
};

const app = () => apiHarness(registerListRoutes);

beforeEach(() => {
  vi.clearAllMocks();
  permissions.assertPermission.mockReturnValue(undefined);
  repo.byId.mockResolvedValue(LIST_ROW);
});

describe('GET /lists', () => {
  it('vrátí seznamy projektu', async () => {
    repo.list.mockResolvedValue([LIST_ROW]);
    const res = await app().request('/lists');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { name: string }[] };
    expect(body.data[0]?.name).toBe('Newsletter');
  });
});

describe('POST /lists', () => {
  it('nový seznam dostane jednokrokové potvrzení jako výchozí', async () => {
    repo.create.mockResolvedValue(LIST_ROW);
    const res = await app().request('/lists', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'Newsletter' }),
    });
    expect(res.status).toBe(201);
    // Rozhodnutí zadavatele: varianta s vyšší konverzí, ale potvrzuje vždy POST.
    expect(repo.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ confirmationMode: 'one_step' }),
    );
  });

  it('odmítne neznámý klíč v těle', async () => {
    const res = await app().request('/lists', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'Newsletter', nope: 1 }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('validation_failed');
  });
});

describe('POST /lists/{id}/subscribe', () => {
  it('přihlásí a vrátí stav pending u dvojího potvrzení', async () => {
    service.subscribeToList.mockResolvedValue({
      response: 'accepted',
      outcome: 'confirmation_sent',
      contactId: CONTACT_ID,
      subscriptionStatus: 'pending',
    });
    const res = await app().request(`/lists/${LIST_ID}/subscribe`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: 'j@x.cz' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('pending');
  });

  it('adresa se stížností skončí 409 se subscribe_blocked_complaint', async () => {
    service.subscribeToList.mockResolvedValue({
      response: 'accepted',
      outcome: 'blocked_complaint',
      contactId: null,
      subscriptionStatus: null,
    });
    const res = await app().request(`/lists/${LIST_ID}/subscribe`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: 'complained@x.cz' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { params: { detail: string } };
    expect(body.params.detail).toBe('subscribe_blocked_complaint');
  });

  it('skip_confirmation vyžaduje prohlášení o doloženém souhlasu', async () => {
    const res = await app().request(`/lists/${LIST_ID}/subscribe`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: 'j@x.cz', skip_confirmation: true }),
    });
    expect(res.status).toBe(422);
    expect(service.subscribeToList).not.toHaveBeenCalled();
  });

  it('skip_confirmation s prohlášením projde', async () => {
    service.subscribeToList.mockResolvedValue({
      response: 'accepted',
      outcome: 'confirmed',
      contactId: CONTACT_ID,
      subscriptionStatus: 'confirmed',
    });
    const res = await app().request(`/lists/${LIST_ID}/subscribe`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: 'j@x.cz', skip_confirmation: true, declaration: true }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('confirmed');
  });
});

describe('DELETE /lists/{id}/subscribe', () => {
  it('odhlásí ze seznamu a vrátí 204', async () => {
    query.findContactByEmail.mockResolvedValue({ id: CONTACT_ID });
    unsub.unsubscribe.mockResolvedValue({ scope: 'list' });
    const res = await app().request(`/lists/${LIST_ID}/subscribe`, {
      method: 'DELETE',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: 'j@x.cz' }),
    });
    expect(res.status).toBe(204);
    expect(unsub.unsubscribe).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ contactId: CONTACT_ID, listId: LIST_ID }),
    );
  });

  it('neznámá adresa vrátí také 204, aby endpoint neprozradil obsah databáze', async () => {
    query.findContactByEmail.mockResolvedValue(null);
    const res = await app().request(`/lists/${LIST_ID}/subscribe`, {
      method: 'DELETE',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: 'nikdo@x.cz' }),
    });
    expect(res.status).toBe(204);
    expect(unsub.unsubscribe).not.toHaveBeenCalled();
  });
});

describe('POST /lists/{id}/subscribe:bulk', () => {
  it('odmítne víc než tisíc adres', async () => {
    const res = await app().request(`/lists/${LIST_ID}/subscribe:bulk`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        subscribers: Array.from({ length: 1001 }, (_, i) => ({ email: `u${i}@x.cz` })),
      }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: { code: string }[] };
    expect(body.errors[0]?.code).toBe('too_many_items');
  });
});

describe('DELETE /lists/{id}/subscribe:bulk', () => {
  it('odhlásí dávku a vrátí výsledek po položkách', async () => {
    unsub.bulkUnsubscribeFromList.mockResolvedValue([
      { index: 0, outcome: 'unsubscribed', contactId: CONTACT_ID },
      { index: 1, outcome: 'unchanged', contactId: CONTACT_ID },
      { index: 2, outcome: 'unknown_contact', contactId: null },
    ]);
    const res = await app().request(`/lists/${LIST_ID}/subscribe:bulk`, {
      method: 'DELETE',
      headers: JSON_HEADERS,
      body: JSON.stringify({ emails: ['a@x.cz', 'b@x.cz', 'nikdo@x.cz'] }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { outcome: string }[] };
    // Kontakt mimo seznam se nezamlčí ani nespadne: má vlastní výsledek.
    expect(body.results.map((item) => item.outcome)).toEqual([
      'unsubscribed',
      'unchanged',
      'unknown_contact',
    ]);
    expect(unsub.bulkUnsubscribeFromList).toHaveBeenCalledWith(
      expect.anything(),
      // `manual`, ne `api`: hromadné odhlášení je rozhodnutí správce a do souhlasu
      // se má zapsat jako `admin`, ne jako by o něj požádal sám příjemce.
      expect.objectContaining({ listId: LIST_ID, reason: 'manual' }),
    );
  });

  it('odmítne víc než tisíc adres stejným kódem jako hromadné přihlášení', async () => {
    const res = await app().request(`/lists/${LIST_ID}/subscribe:bulk`, {
      method: 'DELETE',
      headers: JSON_HEADERS,
      body: JSON.stringify({ emails: Array.from({ length: 1001 }, (_, i) => `u${i}@x.cz`) }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: { code: string }[] };
    expect(body.errors[0]?.code).toBe('too_many_items');
  });

  it('neexistující seznam vrací 404, ne prázdnou práci', async () => {
    repo.byId.mockResolvedValue(null);
    const res = await app().request(`/lists/${LIST_ID}/subscribe:bulk`, {
      method: 'DELETE',
      headers: JSON_HEADERS,
      body: JSON.stringify({ emails: ['a@x.cz'] }),
    });
    expect(res.status).toBe(404);
    expect(unsub.bulkUnsubscribeFromList).not.toHaveBeenCalled();
  });
});

describe('POST /lists/{id}/resend-confirmation', () => {
  it('limit odeslání se vrací jako outcome, ne jako chyba integrace', async () => {
    service.resendConfirmation.mockResolvedValue({
      response: 'accepted',
      outcome: 'resend_throttled',
      contactId: CONTACT_ID,
      subscriptionStatus: 'pending',
    });
    const res = await app().request(`/lists/${LIST_ID}/resend-confirmation`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ contact_id: CONTACT_ID }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: 'resend_throttled' });
  });
});

describe('GET /lists/{id}/stats', () => {
  it('vrátí počty podle stavu', async () => {
    repo.stats.mockResolvedValue({
      pending: 1,
      confirmed: 2,
      unsubscribed: 3,
      bounced: 4,
      complained: 5,
      total: 15,
    });
    const res = await app().request(`/lists/${LIST_ID}/stats`);
    expect(await res.json()).toMatchObject({
      confirmed: expect.any(Number),
      pending: expect.any(Number),
      unsubscribed: expect.any(Number),
      bounced: expect.any(Number),
    });
  });

  it('neexistující seznam vrací 404', async () => {
    repo.byId.mockResolvedValue(null);
    const res = await app().request(`/lists/${LIST_ID}/stats`);
    expect(res.status).toBe(404);
  });
});
