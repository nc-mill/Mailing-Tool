import { describe, expect, it, vi } from 'vitest';
import {
  RETRY_LIMIT,
  STALE_RUNNING_MS,
  runBrandExtraction,
  sweepStaleExtractions,
  type BrandExtractDeps,
} from './brand-extract';
import { collectStylesheetUrls, parseDocument } from '../extract/html';
import { collectLogoCandidates } from '../extract/logo';

const okPage = () => ({
  ok: true as const,
  finalUrl: 'https://kolo-shop.cz/',
  status: 200,
  headers: {},
  body: Buffer.from(
    '<html><head><meta name="theme-color" content="#c41e3a"></head><body><h1>Kolo Shop</h1></body></html>',
  ),
  hops: [{ url: 'https://kolo-shop.cz/', status: 200, ipClass: 'public' as const }],
  bytesRead: 100,
});

const deps = (over: Partial<BrandExtractDeps> = {}): BrandExtractDeps => ({
  loadExtraction: vi.fn(async () => ({
    id: 'e1',
    workspaceId: 'w1',
    status: 'pending' as const,
    normalizedUrl: 'https://kolo-shop.cz/',
    inferTone: true,
  })),
  markRunning: vi.fn(async () => undefined),
  finish: vi.fn(async () => undefined),
  checkRobots: vi.fn(async () => ({ allowed: true as const })),
  fetchPage: vi.fn(async () => okPage()),
  fetchAssets: vi.fn(async () => []),
  parseDocument: vi.fn((html: string) => parseDocument(html)),
  collectStylesheetUrls: vi.fn(collectStylesheetUrls),
  collectLogoCandidates: vi.fn(collectLogoCandidates),
  buildBrandProfile: vi.fn(async () => ({ brandProfileId: 'b1', warnings: [] })),
  inferTone: vi.fn(async () => ({ tone: null, warnings: [] })),
  emitWebhookEvent: vi.fn(async () => undefined),
  logDebug: vi.fn(),
  ...over,
});

describe('job content.brand_extract', () => {
  it('nemá opakování', () => {
    expect(RETRY_LIMIT).toBe(0);
  });

  it('šťastná cesta projde přes running do succeeded', async () => {
    const d = deps();
    await runBrandExtraction({ extractionId: 'e1' }, d);
    expect(d.markRunning).toHaveBeenCalledWith('e1');
    expect(vi.mocked(d.finish).mock.calls[0]?.[0]).toMatchObject({ id: 'e1', status: 'succeeded' });
  });

  it('T15: robots.txt se zákazem skončí jako blocked, ne failed', async () => {
    const d = deps({
      checkRobots: vi.fn(async () => ({ allowed: false, code: 'brand_robots_disallowed' })),
    });
    await runBrandExtraction({ extractionId: 'e1' }, d);
    expect(vi.mocked(d.finish).mock.calls[0]?.[0]).toMatchObject({
      status: 'blocked',
      errorCode: 'brand_robots_disallowed',
    });
    expect(d.fetchPage).not.toHaveBeenCalled();
  });

  it('zakázaná adresa skončí jako blocked', async () => {
    const d = deps({
      fetchPage: vi.fn(async () => ({
        ok: false as const,
        code: 'brand_blocked_address',
        hops: [],
        bytesRead: 0,
      })),
    });
    await runBrandExtraction({ extractionId: 'e1' }, d);
    expect(vi.mocked(d.finish).mock.calls[0]?.[0]).toMatchObject({
      status: 'blocked',
      errorCode: 'brand_blocked_address',
    });
  });

  it('síťová chyba skončí jako failed', async () => {
    const d = deps({
      fetchPage: vi.fn(async () => ({
        ok: false as const,
        code: 'brand_timeout',
        hops: [],
        bytesRead: 0,
      })),
    });
    await runBrandExtraction({ extractionId: 'e1' }, d);
    expect(vi.mocked(d.finish).mock.calls[0]?.[0]).toMatchObject({
      status: 'failed',
      errorCode: 'brand_timeout',
    });
  });

  it('kritérium 52: web bez loga a bez barev uspěje s výchozí paletou a varováním', async () => {
    const d = deps({
      fetchPage: vi.fn(async () => ({
        ...okPage(),
        body: Buffer.from('<html><body>Nic</body></html>'),
        bytesRead: 30,
      })),
      buildBrandProfile: vi.fn(async () => ({
        brandProfileId: 'b1',
        warnings: ['logo_not_found'],
      })),
    });
    await runBrandExtraction({ extractionId: 'e1' }, d);
    const finish = vi.mocked(d.finish).mock.calls[0]?.[0];
    expect(finish?.status).toBe('succeeded');
    expect((finish?.result as { warnings: string[] }).warnings).toContain('logo_not_found');
  });

  it('externí stylopisy a kandidáti na logo se opravdu stáhnou', async () => {
    const d = deps({
      fetchPage: vi.fn(async () => ({
        ...okPage(),
        body: Buffer.from(
          '<html><head><link rel="stylesheet" href="/styl.css"></head><body><header><img src="/logo.png" alt="Logo"></header></body></html>',
        ),
      })),
    });
    await runBrandExtraction({ extractionId: 'e1' }, d);
    const requested = vi.mocked(d.fetchAssets).mock.calls[0]?.[0] ?? [];
    expect(requested).toContain('https://kolo-shop.cz/styl.css');
    expect(requested).toContain('https://kolo-shop.cz/logo.png');
  });

  it('do hop_summary jde třída adresy, syrové IP jdou jen do debug logu', async () => {
    const d = deps();
    await runBrandExtraction({ extractionId: 'e1' }, d);
    const finish = vi.mocked(d.finish).mock.calls[0]?.[0];
    expect(JSON.stringify(finish?.hopSummary)).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  it('po dokončení se vyhlásí událost brand.extraction_completed', async () => {
    const d = deps();
    await runBrandExtraction({ extractionId: 'e1' }, d);
    expect(d.emitWebhookEvent).toHaveBeenCalledWith(
      'brand.extraction_completed',
      expect.objectContaining({ extractionId: 'e1', status: 'succeeded' }),
    );
  });
});

describe('úklid zaseknutých extrakcí', () => {
  it('running starší než pět minut se převede na failed s brand_timeout', async () => {
    expect(STALE_RUNNING_MS).toBe(5 * 60 * 1000);
    const failStale = vi.fn(async () => 2);
    const result = await sweepStaleExtractions(
      { now: new Date('2026-07-31T10:10:00.000Z') },
      { failStaleExtractions: failStale },
    );
    expect(failStale).toHaveBeenCalledWith(new Date('2026-07-31T10:05:00.000Z'), 'brand_timeout');
    expect(result).toEqual({ failed: 2 });
  });
});
