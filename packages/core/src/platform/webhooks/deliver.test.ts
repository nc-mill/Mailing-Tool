import { describe, it, expect } from 'vitest';
import { classifyResponse, CONNECT_TIMEOUT_MS, TOTAL_TIMEOUT_MS, SNIPPET_BYTES } from './deliver';

describe('klasifikace odpovědi podle 3.8', () => {
  it('2xx je úspěch', () => {
    for (const s of [200, 201, 202, 204, 299]) expect(classifyResponse(s).ok).toBe(true);
  });

  it('3xx je neúspěch, protože přesměrování nenásledujeme', () => {
    for (const s of [301, 302, 307, 308]) {
      expect(classifyResponse(s).ok).toBe(false);
      expect(classifyResponse(s).abandon).toBe(false);
    }
  });

  it('408, 429 a 5xx se opakují', () => {
    for (const s of [408, 429, 500, 502, 503]) {
      expect(classifyResponse(s).ok).toBe(false);
      expect(classifyResponse(s).abandon).toBe(false);
    }
  });

  it('kritérium 37: 410 Gone se okamžitě vzdává a deaktivuje endpoint', () => {
    expect(classifyResponse(410)).toEqual({ ok: false, abandon: true, disable: 'endpoint_gone' });
  });

  it('ostatní 4xx se opakují, endpoint může být dočasně špatně nasazený', () => {
    for (const s of [400, 401, 403, 404, 422]) {
      expect(classifyResponse(s).abandon).toBe(false);
    }
  });
});

describe('limity podle 3.8', () => {
  it('connect timeout 5 s, celkový 10 s, snippet 2 kB', () => {
    expect(CONNECT_TIMEOUT_MS).toBe(5000);
    expect(TOTAL_TIMEOUT_MS).toBe(10000);
    expect(SNIPPET_BYTES).toBe(2048);
  });
});
