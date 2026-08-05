import { describe, expect, it } from 'vitest';
import { createSdkResponder } from './serve-sdk';

describe('serve ml.js', () => {
  const responder = createSdkResponder({ readBundle: () => 'console.log(1)', version: '1.2.3' });

  it('vrátí skript s typem application/javascript', async () => {
    const res = responder(new Request('https://events.shop.cz/e/ml.js'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/javascript; charset=utf-8');
    expect(await res.text()).toBe('console.log(1)');
  });

  it('nastaví cache na hodinu se stale-while-revalidate na den', () => {
    const res = responder(new Request('https://events.shop.cz/e/ml.js'));
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=3600, stale-while-revalidate=86400',
    );
  });

  it('ETag odpovídá verzi instance, takže se při upgradu změní', () => {
    const res = responder(new Request('https://events.shop.cz/e/ml.js'));
    expect(res.headers.get('etag')).toBe('W/"1.2.3"');
  });

  it('shodný If-None-Match vrátí 304 bez těla', async () => {
    const res = responder(
      new Request('https://events.shop.cz/e/ml.js', { headers: { 'If-None-Match': 'W/"1.2.3"' } }),
    );
    expect(res.status).toBe(304);
    expect(await res.text()).toBe('');
  });

  it('skript se smí načíst z libovolného původu', () => {
    const res = responder(new Request('https://events.shop.cz/e/ml.js'));
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('bundle se čte jen jednou, ne při každém požadavku', () => {
    let reads = 0;
    const once = createSdkResponder({
      readBundle: () => {
        reads += 1;
        return 'x';
      },
      version: '1',
    });
    once(new Request('https://events.shop.cz/e/ml.js'));
    once(new Request('https://events.shop.cz/e/ml.js'));
    expect(reads).toBe(1);
  });
});
