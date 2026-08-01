import { describe, expect, it, vi } from 'vitest';
import { createHttpPorts } from './http-ports';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('http ports', () => {
  it('uloží dokument s optimistickým zámkem', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ design_hash: 'h2', updated_at: '2026-07-31T12:00:00Z' }));
    const ports = createHttpPorts({ baseUrl: '/api/v1', fetch: fetchMock });
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
    const ports = createHttpPorts({ baseUrl: '/api/v1', fetch: fetchMock });
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
    const ports = createHttpPorts({ baseUrl: '/api/v1', fetch: fetchMock });
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
    const ports = createHttpPorts({ baseUrl: '/api/v1', fetch: fetchMock });
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
    const ports = createHttpPorts({ baseUrl: '/api/v1', fetch: fetchMock });
    const result = await ports.testSend({
      templateId: 't1',
      recipients: ['a@b.cz'],
      addTestPrefix: true,
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
    const ports = createHttpPorts({ baseUrl: '/api/v1', fetch: fetchMock });
    await expect(
      ports.preview({ templateId: 't1', previewData: { type: 'sample' } }),
    ).rejects.toMatchObject({ code: 'teapot', detail: 'Nefunguje to.', requestId: 'req-1' });
  });
});
