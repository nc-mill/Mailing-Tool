import { describe, expect, it, vi } from 'vitest';
import { LiveStatsMachine } from './live-stats';

function machine(overrides: Partial<ConstructorParameters<typeof LiveStatsMachine>[0]> = {}) {
  return new LiveStatsMachine({
    mode: 'sse',
    fetchSnapshot: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: { version: 1, status: 'sending' }, etag: 'W/"1"' }),
    openStream: vi.fn(),
    ...overrides,
  });
}

describe('LiveStatsMachine', () => {
  it('po třech neúspěších SSE přejde trvale na dotazování (kritérium 101)', () => {
    const m = machine();
    m.onStreamError();
    m.onStreamError();
    expect(m.state.mode).toBe('sse');
    m.onStreamError();
    expect(m.state.mode).toBe('polling');
    expect(m.state.degraded).toBe(true);
    m.onStreamError();
    expect(m.state.attempts).toBe(3);
  });

  it('indikátor spojení hlásí obnovování, ne chybu', () => {
    const m = machine();
    m.onStreamError();
    expect(m.state.connection).toBe('reconnecting');
    m.onStreamError();
    m.onStreamError();
    expect(m.state.connection).toBe('connected');
  });

  it('v režimu dotazování se odpověď 304 nepovažuje za změnu', async () => {
    const fetchSnapshot = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'ok',
        data: { version: 1, status: 'sending' },
        etag: 'W/"1"',
      })
      .mockResolvedValueOnce({ status: 'not_modified' });
    const m = machine({ mode: 'polling', fetchSnapshot });
    const seen: unknown[] = [];
    m.subscribe((snapshot) => seen.push(snapshot));
    await m.pollOnce();
    await m.pollOnce();
    expect(seen).toHaveLength(1);
    expect(fetchSnapshot.mock.calls[1]?.[0]).toBe('W/"1"');
  });

  it('selhání dotazu obrazovku nezabije, jen označí data za zastaralá (kritérium 102)', async () => {
    const fetchSnapshot = vi.fn().mockRejectedValue(new Error('offline'));
    const m = machine({ mode: 'polling', fetchSnapshot });
    await m.pollOnce();
    expect(m.state.connection).toBe('disconnected');
    expect(m.state.lastError).toBe(true);
  });

  it('ruční obnovení funguje i po selhání živých aktualizací', async () => {
    const fetchSnapshot = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ status: 'ok', data: { version: 2, status: 'sent' }, etag: 'W/"2"' });
    const m = machine({ mode: 'polling', fetchSnapshot });
    const seen: unknown[] = [];
    m.subscribe((snapshot) => seen.push(snapshot));
    await m.pollOnce();
    await m.pollOnce();
    expect(seen).toEqual([{ version: 2, status: 'sent' }]);
    expect(m.state.connection).toBe('connected');
  });

  it('po výpadku se dopočítá z ÚPLNÉHO snímku, ne z přírůstku', async () => {
    // Server posílá vždy celý stav. Klient tedy po obnovení spojení nemusí
    // nic dopočítávat ani slévat, jen přepsat, a duplicita nevznikne
    // (kritérium 98).
    const fetchSnapshot = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'ok',
        data: { version: 1, status: 'sending', sent: 10 },
        etag: 'W/"1"',
      })
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        status: 'ok',
        data: { version: 9, status: 'sending', sent: 900 },
        etag: 'W/"9"',
      });
    const m = machine({ mode: 'polling', fetchSnapshot });
    const seen: Array<Record<string, unknown>> = [];
    m.subscribe((snapshot) => seen.push(snapshot));

    await m.pollOnce();
    await m.pollOnce();
    await m.pollOnce();
    expect(m.state.connection).toBe('disconnected');
    await m.pollOnce();

    expect(m.state.connection).toBe('connected');
    expect(seen.map((item) => item.sent)).toEqual([10, 900]);
    // Etag zůstal na poslední ÚSPĚŠNÉ verzi, takže dorovnání není podmíněné
    // odpovědí, která nikdy nedorazila.
    expect(fetchSnapshot.mock.calls[3]?.[0]).toBe('W/"1"');
  });
});
