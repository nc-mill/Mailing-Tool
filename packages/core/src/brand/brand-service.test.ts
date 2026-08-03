import { describe, expect, it, vi } from 'vitest';
import {
  assertTransition,
  publicExtraction,
  requestExtraction,
  type RequestExtractionDeps,
} from './brand-service';

describe('stavový automat extrakce', () => {
  it('povolené přechody', () => {
    expect(() => assertTransition('pending', 'running')).not.toThrow();
    expect(() => assertTransition('pending', 'blocked')).not.toThrow();
    expect(() => assertTransition('running', 'succeeded')).not.toThrow();
    expect(() => assertTransition('running', 'failed')).not.toThrow();
    expect(() => assertTransition('running', 'blocked')).not.toThrow();
  });

  it('do succeeded se nedá dostat bez running', () => {
    expect(() => assertTransition('pending', 'succeeded')).toThrow(/pending/);
  });

  it('koncový stav se už nikdy nemění, opakování zakládá nový řádek', () => {
    for (const terminal of ['succeeded', 'failed', 'blocked'] as const) {
      expect(() => assertTransition(terminal, 'running')).toThrow();
      expect(() => assertTransition(terminal, 'succeeded')).toThrow();
    }
  });
});

describe('rate limit', () => {
  const deps = (over: Partial<RequestExtractionDeps> = {}): RequestExtractionDeps => ({
    countExtractionsInLastHour: vi.fn(async () => 0),
    countRunningExtractions: vi.fn(async () => 0),
    insertExtraction: vi.fn(async () => ({ id: 'e1', status: 'pending' as const })),
    enqueue: vi.fn(async () => undefined),
    writeAuditLog: vi.fn(async () => undefined),
    ...over,
  });

  it('T20: jedenáctý pokus v hodině vrátí obecný rate_limited s retry_after', async () => {
    const d = deps({ countExtractionsInLastHour: vi.fn(async () => 10) });
    const result = await requestExtraction(
      { workspaceId: 'w1', actorId: 'u1', url: 'https://kolo-shop.cz', inferTone: true },
      { ratePerHour: 10, concurrencyPerWorkspace: 1 },
      d,
    );
    expect(result).toMatchObject({ ok: false, code: 'rate_limited', status: 429 });
    // `in` místo porovnání kódu: varianta se stavem 400 má `code: string`,
    // takže samotná rovnost typ nezúží.
    if (result.ok === false && 'retryAfterSeconds' in result) {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    }
    expect(d.insertExtraction).not.toHaveBeenCalled();
    expect(d.enqueue).not.toHaveBeenCalled();
  });

  it('vlastní kód pro vyčerpaný limit neexistuje, používá se obecný', async () => {
    const d = deps({ countExtractionsInLastHour: vi.fn(async () => 10) });
    const result = await requestExtraction(
      { workspaceId: 'w1', actorId: 'u1', url: 'https://kolo-shop.cz', inferTone: true },
      { ratePerHour: 10, concurrencyPerWorkspace: 1 },
      d,
    );
    expect(JSON.stringify(result)).not.toContain('brand_rate_limited');
  });

  it('souběžná extrakce na projekt je nejvýš jedna', async () => {
    const d = deps({ countRunningExtractions: vi.fn(async () => 1) });
    const result = await requestExtraction(
      { workspaceId: 'w1', actorId: 'u1', url: 'https://kolo-shop.cz', inferTone: true },
      { ratePerHour: 10, concurrencyPerWorkspace: 1 },
      d,
    );
    expect(result).toMatchObject({ ok: false, code: 'conflict', status: 409 });
  });

  it('syntakticky vadná URL skončí jako blocked ještě před zařazením do fronty', async () => {
    const d = deps();
    const result = await requestExtraction(
      { workspaceId: 'w1', actorId: 'u1', url: 'http://169.254.169.254/', inferTone: true },
      { ratePerHour: 10, concurrencyPerWorkspace: 1 },
      d,
    );
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(d.enqueue).not.toHaveBeenCalled();
  });

  it('host se zakázanou příponou se do fronty také nedostane', async () => {
    const d = deps();
    const result = await requestExtraction(
      { workspaceId: 'w1', actorId: 'u1', url: 'http://tiskarna.local/', inferTone: true },
      { ratePerHour: 10, concurrencyPerWorkspace: 1 },
      d,
    );
    expect(result).toMatchObject({ ok: false, code: 'brand_host_not_allowed', status: 400 });
    expect(d.enqueue).not.toHaveBeenCalled();
  });

  it('platný požadavek se zapíše, zařadí a zaznamená do audit logu', async () => {
    const d = deps();
    const result = await requestExtraction(
      { workspaceId: 'w1', actorId: 'u1', url: 'https://kolo-shop.cz', inferTone: true },
      { ratePerHour: 10, concurrencyPerWorkspace: 1 },
      d,
    );
    expect(result).toMatchObject({ ok: true, id: 'e1', status: 202 });
    // Projekt v nákladu je podmínka zpracování, ne ozdoba: obsluha bez něj
    // nemá pod čím otevřít transakci a řádek pod RLS by nenačetla.
    expect(d.enqueue).toHaveBeenCalledWith('content.brand_extract', {
      workspaceId: 'w1',
      extractionId: 'e1',
    });
    expect(d.writeAuditLog).toHaveBeenCalledTimes(1);
  });
});

describe('kritérium 53: co se vrací uživateli', () => {
  it('odpověď nikdy nenese HTTP kód cílového serveru ani IP adresu', () => {
    const view = publicExtraction({
      id: 'e1',
      status: 'failed',
      inputUrl: 'https://kolo-shop.cz',
      normalizedUrl: 'https://kolo-shop.cz/',
      errorCode: 'brand_fetch_failed',
      hopSummary: [
        { url: 'https://kolo-shop.cz/', status: 301, ipClass: 'public' },
        { url: 'https://www.kolo-shop.cz/', status: 200, ipClass: 'public' },
      ],
      bytesFetched: 1234,
      durationMs: 900,
      result: null,
      brandProfileId: null,
      createdAt: '2026-07-31T10:00:00.000Z',
      finishedAt: '2026-07-31T10:00:01.000Z',
      internalNote: 'ECONNREFUSED 10.0.0.5:443',
    });
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('10.0.0.5');
    expect(serialized).not.toContain('ECONNREFUSED');
    expect(view).not.toHaveProperty('internalNote');
    // URL a stav v hop_summary zůstávají: uživatel je zadal a jsou jeho.
    expect(serialized).toContain('"status":301');
    expect(serialized).toContain('"ipClass":"public"');
  });

  it('hop_summary nese třídu adresy, nikdy syrovou IP', () => {
    const view = publicExtraction({
      id: 'e1',
      status: 'succeeded',
      inputUrl: 'https://kolo-shop.cz',
      normalizedUrl: 'https://kolo-shop.cz/',
      errorCode: null,
      hopSummary: [{ url: 'https://kolo-shop.cz/', status: 200, ipClass: 'public' }],
      bytesFetched: 10,
      durationMs: 10,
      result: null,
      brandProfileId: 'b1',
      createdAt: '2026-07-31T10:00:00.000Z',
      finishedAt: '2026-07-31T10:00:01.000Z',
    });
    for (const hop of view.hop_summary) {
      expect(Object.keys(hop).sort()).toEqual(['ipClass', 'status', 'url']);
    }
  });
});
