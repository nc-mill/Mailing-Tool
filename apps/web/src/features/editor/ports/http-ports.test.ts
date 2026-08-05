import { describe, expect, it, vi } from 'vitest';
import { createHttpPorts } from './http-ports';
import type { EditorPorts } from './types';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const WORKSPACE_ID = '019fbf52-d8b9-7b0d-b67e-528e8026a383';

describe('http ports', () => {
  /**
   * Bez `X-Workspace-Id` vrací middleware 404 dřív, než se handler spustí,
   * takže z prohlížeče nešlo šablonu ani založit, ani uložit. Naměřeno na
   * produkční image:
   *   {"route":"/api/v1/templates","status":404,"workspace_id":null}
   */
  /**
   * VŠECHNY porty naráz, ne jen jeden.
   *
   * Předchozí znění téhle kontroly volalo `createTemplate` a z toho usuzovalo
   * na zbytek. Neplatilo to: `uploadAsset` šel přes holý `fetch` bez jediné
   * hlavičky, protože tělo je `FormData` a `content-type` se u něj nastavovat
   * NESMÍ (prohlížeč by nedoplnil `boundary`). Autor tedy obešel společnou
   * funkci `call` a s ní i `X-Workspace-Id`, a test to nezachytil, protože se
   * na ten port nikdy nezeptal.
   *
   * Je to počtvrté, co tahle vada v repozitáři vznikla. Vzor je proto opsaný
   * z `features/contacts/actions.test.ts`: výčet se kontroluje proti
   * SKUTEČNÉMU seznamu portů, takže kdo přidá desátý port a zapomene na
   * hlavičku, shodí test tady, ne až na produkční image.
   */
  const CALLS: Record<string, (ports: EditorPorts) => Promise<unknown>> = {
    createTemplate: (p) => p.createTemplate({ name: 'N', document: { blocks: [] } as never }),
    save: (p) => p.save({ templateId: 't1', document: { blocks: [] } as never, ifDesignHash: 'a' }),
    rename: (p) => p.rename({ templateId: 't1', name: 'Nové jméno' }),
    preview: (p) => p.preview({ templateId: 't1', previewData: { type: 'sample' } }),
    validate: (p) => p.validate({ templateId: 't1' }),
    testSend: (p) =>
      p.testSend({
        templateId: 't1',
        recipients: ['a@b.cz'],
        previewData: { type: 'sample' },
      }),
    applyToCampaign: (p) => p.applyToCampaign({ campaignId: 'c1', templateId: 't1' }),
    searchContacts: (p) => p.searchContacts('novak'),
    randomContact: (p) => p.randomContact(),
    listAssets: (p) => p.listAssets(''),
    uploadAsset: (p) => p.uploadAsset(new File([new Uint8Array([1, 2, 3])], 'a.png')),
  };

  it('výčet v testu pokrývá všechny porty editoru', () => {
    const ports = createHttpPorts({ workspaceId: WORKSPACE_ID, fetch: vi.fn() });
    const actual = Object.entries(ports)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort();
    expect(actual).toEqual(Object.keys(CALLS).sort());
  });

  for (const [name, call] of Object.entries(CALLS)) {
    it(`${name} posílá X-Workspace-Id`, async () => {
      // Odpověď musí projít každým portem: `data` pro seznamy, `findings` pro
      // kontrolu, `id` a `design_hash` pro zápisy. Jedno tělo pro všechny je
      // tu proto, aby test měřil hlavičku, ne tvar odpovědi.
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          json(
            { id: 't1', design_hash: 'a', updated_at: '', data: [], findings: [], url: '' },
            200,
          ),
        );
      const ports = createHttpPorts({
        workspaceId: WORKSPACE_ID,
        baseUrl: '/api/v1',
        fetch: fetchMock,
      });

      await call(ports);

      expect(fetchMock.mock.calls.length, `${name} nezavolal fetch`).toBeGreaterThan(0);
      for (const [url, init] of fetchMock.mock.calls) {
        const headers = (init as RequestInit | undefined)?.headers as
          Record<string, string> | undefined;
        expect(
          headers?.['X-Workspace-Id'],
          `${name} volá ${String(url)} bez X-Workspace-Id, takže middleware vrátí 404 před handlerem`,
        ).toBe(WORKSPACE_ID);
      }
    });
  }

  /**
   * Zrcadlo k předchozímu: `uploadAsset` hlavičku posílat MUSÍ, ale
   * `content-type` posílat NESMÍ. Kdyby ho nastavil, prohlížeč nedoplní
   * `boundary=` a server multipart nerozebere, tedy vada opačným směrem.
   */
  it('uploadAsset nechá content-type na prohlížeči, jinak se ztratí boundary', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ id: 'a1', url: '' }, 201));
    const ports = createHttpPorts({
      workspaceId: WORKSPACE_ID,
      baseUrl: '/api/v1',
      fetch: fetchMock,
    });

    await ports.uploadAsset(new File([new Uint8Array([1, 2, 3])], 'a.png'));

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('content-type');
  });

  it('uloží dokument s optimistickým zámkem', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ design_hash: 'h2', updated_at: '2026-07-31T12:00:00Z' }));
    const ports = createHttpPorts({
      workspaceId: WORKSPACE_ID,
      baseUrl: '/api/v1',
      fetch: fetchMock,
    });
    const result = await ports.save({
      templateId: 't1',
      document: { blocks: [] } as never,
      ifDesignHash: 'h1',
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/templates/t1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toMatchObject({ if_design_hash: 'h1' });
    expect(result).toEqual({ ok: true, designHash: 'h2', updatedAt: '2026-07-31T12:00:00Z' });
  });

  it('z odpovědi 412 udělá konflikt s cizí verzí', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        json({ code: 'precondition_failed', design: { blocks: [] }, design_hash: 'h9' }, 412),
      );
    const ports = createHttpPorts({
      workspaceId: WORKSPACE_ID,
      baseUrl: '/api/v1',
      fetch: fetchMock,
    });
    const result = await ports.save({
      templateId: 't1',
      document: { blocks: [] } as never,
      ifDesignHash: 'h1',
    });
    expect(result).toEqual({
      ok: false,
      conflict: true,
      document: { blocks: [] },
      designHash: 'h9',
    });
  });

  it('když 412 aktuální verzi nenese, dotáhne ji, místo aby vrátila prázdno', async () => {
    // Dnešní obálka chyby je RFC 9457 bez `design`. Kdyby se port spolehl na to,
    // že tam je, konflikt by nesl `undefined` a tlačítko „Načíst novou verzi"
    // by uživateli šablonu vymazalo. Požadavek P08-R3 to má doplnit; do té doby
    // se aktuální stav dotáhne samostatným GET.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ code: 'precondition_failed', detail: 'changed' }, 412))
      .mockResolvedValueOnce(json({ design: { blocks: ['cizi'] }, design_hash: 'h9' }, 200));
    const ports = createHttpPorts({
      workspaceId: WORKSPACE_ID,
      baseUrl: '/api/v1',
      fetch: fetchMock,
    });
    const result = await ports.save({
      templateId: 't1',
      document: { blocks: [] } as never,
      ifDesignHash: 'h1',
    });
    expect(fetchMock.mock.calls[1]![1].method).toBe('GET');
    expect(result).toEqual({
      ok: false,
      conflict: true,
      document: { blocks: ['cizi'] },
      designHash: 'h9',
    });
  });

  it('vytvoření šablony pošle jméno i dokument a vrátí id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ id: 'tmpl-9', name: 'Nová šablona' }, 201));
    const ports = createHttpPorts({
      workspaceId: WORKSPACE_ID,
      baseUrl: '/api/v1',
      fetch: fetchMock,
    });
    const result = await ports.createTemplate({
      name: 'Nová šablona',
      document: { blocks: [] } as never,
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/templates');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      name: 'Nová šablona',
      kind: 'campaign',
    });
    expect(result).toEqual({ id: 'tmpl-9' });
  });

  it('u testovacího odeslání vrátí kód i dobu čekání', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ code: 'rate_limited', retry_after: 900 }, 429));
    const ports = createHttpPorts({
      workspaceId: WORKSPACE_ID,
      baseUrl: '/api/v1',
      fetch: fetchMock,
    });
    const result = await ports.testSend({
      templateId: 't1',
      recipients: ['a@b.cz'],
      previewData: { type: 'sample' },
    });
    expect(result).toEqual({
      ok: false,
      code: 'rate_limited',
      retryAfter: 900,
      requestId: undefined,
    });
  });

  it('neznámou chybu předá i s request_id, aby ji šlo zobrazit', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        json({ code: 'teapot', detail: 'Nefunguje to.', request_id: 'req-1' }, 500),
      );
    const ports = createHttpPorts({
      workspaceId: WORKSPACE_ID,
      baseUrl: '/api/v1',
      fetch: fetchMock,
    });
    await expect(
      ports.preview({ templateId: 't1', previewData: { type: 'sample' } }),
    ).rejects.toMatchObject({ code: 'teapot', detail: 'Nefunguje to.', requestId: 'req-1' });
  });
});
