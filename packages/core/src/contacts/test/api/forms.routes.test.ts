import { beforeEach, describe, expect, it, vi } from 'vitest';

const repo = vi.hoisted(() => ({
  createForm: vi.fn(),
  updateForm: vi.fn(),
  deleteForm: vi.fn(),
  findFormById: vi.fn(),
  listForms: vi.fn(),
  listSubmissions: vi.fn(),
  formSubmissionStats: vi.fn(),
  acceptedCounts30d: vi.fn(),
  publicFormRef: vi.fn(),
}));
const fields = vi.hoisted(() => ({ listContactFields: vi.fn() }));
const lists = vi.hoisted(() => ({ byId: vi.fn() }));
const permissions = vi.hoisted(() => ({ assertPermission: vi.fn() }));
const config = vi.hoisted(() => ({ loadConfig: vi.fn() }));

vi.mock('../../repo/forms', () => repo);
vi.mock('../../repo/contact-fields', () => fields);
vi.mock('../../repo/lists', () => lists);
vi.mock('../../../config/index', () => config);
vi.mock('../../../identity/permissions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...permissions,
}));

const { registerFormRoutes } = await import('../../api/forms.routes');
const { apiHarness, JSON_HEADERS } = await import('./harness');

const FORM_ID = '0198e2c3-1111-7c21-9a44-0f3c7a1b2d5e';
const LIST_ID = '0198e2c3-2222-7c21-9a44-0f3c7a1b2d5e';
const REF = 'AAAAAAAAAAAAAAAAAAAAAAAA';

const FORM_ROW = {
  id: FORM_ID,
  workspaceId: '0198e2c0-0000-7000-8000-000000000001',
  name: 'Newsletter',
  slug: 'abcdef0123456789abcdef01',
  fields: [{ target: 'email' as const, label: { en: 'Email' }, required: true, type: 'email' }],
  customCss: null,
  listIds: [LIST_ID],
  tagIds: [],
  doubleOptIn: true,
  consentText: null,
  consentRequired: true,
  legalBasis: 'consent' as const,
  honeypotField: 'website',
  minFillSeconds: 2,
  allowedOrigins: [],
  captchaProvider: 'none' as const,
  redirectUrl: null,
  successMessage: {},
  active: true,
  submissionCount: 3,
  createdAt: '2026-07-31T10:15:30.000Z',
  updatedAt: '2026-07-31T10:15:30.000Z',
};

const app = () => apiHarness(registerFormRoutes);

beforeEach(() => {
  vi.clearAllMocks();
  permissions.assertPermission.mockReturnValue(undefined);
  config.loadConfig.mockReturnValue({ APP_URL: 'https://mail.example.cz' });
  repo.publicFormRef.mockReturnValue(REF);
  repo.findFormById.mockResolvedValue(FORM_ROW);
  repo.acceptedCounts30d.mockResolvedValue(new Map([[FORM_ID, 7]]));
  repo.formSubmissionStats.mockResolvedValue({
    firstAcceptedAt: '2026-07-31T12:20:00.000Z',
    lastAcceptedAt: '2026-08-01T12:20:00.000Z',
    accepted30d: 7,
  });
  fields.listContactFields.mockResolvedValue([]);
  lists.byId.mockResolvedValue({ id: LIST_ID });
});

describe('GET /forms', () => {
  it('vrátí formuláře i s počtem přihlášení za 30 dní', async () => {
    repo.listForms.mockResolvedValue([FORM_ROW]);
    const res = await app().request('/forms');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { name: string; accepted_30d: number }[] };
    expect(body.data[0]?.name).toBe('Newsletter');
    expect(body.data[0]?.accepted_30d).toBe(7);
  });

  it('vydává VEŘEJNÝ identifikátor, ne holý slug z databáze', async () => {
    repo.listForms.mockResolvedValue([FORM_ROW]);
    const body = (await (await app().request('/forms')).json()) as {
      data: { slug: string; hosted_url: string }[];
    };
    // Holý slug by na `/f/**` skončil stránkou „odkaz neplatí": veřejné adresy
    // nesou projekt v sobě.
    expect(body.data[0]?.slug).toBe(REF);
    expect(body.data[0]?.hosted_url).toBe(`https://mail.example.cz/f/${REF}`);
  });
});

describe('POST /forms', () => {
  it('nový formulář má ve výchozím stavu ZAPNUTÉ potvrzování e-mailem', async () => {
    repo.createForm.mockResolvedValue(FORM_ROW);
    const res = await app().request('/forms', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'Newsletter' }),
    });
    expect(res.status).toBe(201);
    // Výchozí hodnotu vlastní `FormDefinitionSchema`, takže tělo požadavku ji neuvádí
    // a route ji nepodstrkává. Ověřuje se tedy, že ji nepřebíjí.
    expect(repo.createForm.mock.calls[0]?.[1]).not.toHaveProperty('double_opt_in');
  });

  it('formulář bez uvedených polí dostane pole pro e-mail', async () => {
    repo.createForm.mockResolvedValue(FORM_ROW);
    await app().request('/forms', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'Newsletter' }),
    });
    const input = repo.createForm.mock.calls[0]?.[1] as { fields: { target: string }[] };
    expect(input.fields).toHaveLength(1);
    expect(input.fields[0]?.target).toBe('email');
  });

  it('prostý popisek pole se převede na mapu jazyků s klíčem en', async () => {
    repo.createForm.mockResolvedValue(FORM_ROW);
    await app().request('/forms', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        name: 'Newsletter',
        fields: [{ target: 'email', label: 'E-mail', type: 'email', required: true }],
      }),
    });
    const input = repo.createForm.mock.calls[0]?.[1] as { fields: { label: unknown }[] };
    expect(input.fields[0]?.label).toEqual({ en: 'E-mail' });
  });

  it('seznam, který neexistuje, skončí na 422 a formulář nevznikne', async () => {
    lists.byId.mockResolvedValue(null);
    const res = await app().request('/forms', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'Newsletter', list_ids: [LIST_ID] }),
    });
    expect(res.status).toBe(422);
    expect(repo.createForm).not.toHaveBeenCalled();
  });

  it('pole mířící na neexistující vlastní pole skončí na 422', async () => {
    const res = await app().request('/forms', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        name: 'Newsletter',
        fields: [
          { target: { attribute: 'neexistuje' }, label: 'Firma', type: 'text', required: false },
        ],
      }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: { code: string }[] };
    expect(body.errors[0]?.code).toBe('unknown_field_key');
    expect(repo.createForm).not.toHaveBeenCalled();
  });

  it('neznámý klíč v těle skončí na 422, ne tichým zahozením', async () => {
    const res = await app().request('/forms', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'Newsletter', preklep: true }),
    });
    expect(res.status).toBe(422);
  });
});

describe('PATCH /forms/{id}', () => {
  it('pozastavení je úprava, ne mazání', async () => {
    repo.updateForm.mockResolvedValue({ ...FORM_ROW, active: false });
    const res = await app().request(`/forms/${FORM_ID}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ active: false }),
    });
    expect(res.status).toBe(200);
    expect(repo.updateForm.mock.calls[0]?.[2]).toEqual({ active: false });
    expect(repo.deleteForm).not.toHaveBeenCalled();
  });

  it('vypnutí dvojího potvrzení projde, rozhodnutí je na uživateli', async () => {
    repo.updateForm.mockResolvedValue({ ...FORM_ROW, doubleOptIn: false });
    const res = await app().request(`/forms/${FORM_ID}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ double_opt_in: false }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { double_opt_in: boolean } };
    expect(body.data.double_opt_in).toBe(false);
  });
});

describe('DELETE /forms/{id}', () => {
  it('smaže a vrátí 204', async () => {
    repo.deleteForm.mockResolvedValue(undefined);
    const res = await app().request(`/forms/${FORM_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(repo.deleteForm).toHaveBeenCalledWith(expect.anything(), FORM_ID);
  });
});

describe('GET /forms/{id}/embed', () => {
  /**
   * DVĚ VARIANTY, NE TŘI, a název testu se změnil spolu s nimi.
   *
   * Třetí bývala „čistě HTML formulář" a zmizela záměrně, protože tiše
   * zahazovala data: statický kód zkopírovaný na cizí web nemá jak získat
   * nonce, takže odeslání skončilo jako `dropped / missing_nonce`, zatímco
   * návštěvník viděl děkovací stránku. Důvod i naměřený průběh jsou u
   * `buildEmbedSnippets` v `contacts/forms/embed.ts`.
   *
   * Test proto hlídá, že se ta varianta NEVRÁTILA. Kdyby ji někdo doplnil
   * zpátky, spadne to tady a bude si muset přečíst, proč zmizela.
   */
  it('vydá obě varianty vložení a adresu hotové stránky', async () => {
    const res = await app().request(`/forms/${FORM_ID}/embed`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      script: string;
      iframe: string;
      hosted_url: string;
      first_submission_at: string | null;
    };
    expect(body.script).toContain(`data-ml-form="${REF}"`);
    expect(body.iframe).toContain('<iframe');
    expect(body).not.toHaveProperty('html');
    expect(body.hosted_url).toBe(`https://mail.example.cz/f/${REF}`);
    expect(body.first_submission_at).toBe('2026-07-31T12:20:00.000Z');
  });

  it('neznámý formulář vrátí 404', async () => {
    repo.findFormById.mockResolvedValue(null);
    const res = await app().request(`/forms/${FORM_ID}/embed`);
    expect(res.status).toBe(404);
  });
});

describe('GET /forms/{id}/submissions', () => {
  it('vrátí odeslání, nejnovější první', async () => {
    repo.listSubmissions.mockResolvedValue([
      {
        id: '0198e2c3-3333-7c21-9a44-0f3c7a1b2d5e',
        status: 'accepted',
        errorCode: null,
        contactId: null,
        pageUrl: null,
        createdAt: '2026-08-01T12:20:00.000Z',
      },
    ]);
    const res = await app().request(`/forms/${FORM_ID}/submissions?limit=5`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string }[] };
    expect(body.data[0]?.status).toBe('accepted');
    expect(repo.listSubmissions.mock.calls[0]?.[2]).toEqual({ limit: 5 });
  });

  it('neznámý formulář vrátí 404, ne prázdný seznam', async () => {
    repo.findFormById.mockResolvedValue(null);
    const res = await app().request(`/forms/${FORM_ID}/submissions`);
    expect(res.status).toBe(404);
  });
});
