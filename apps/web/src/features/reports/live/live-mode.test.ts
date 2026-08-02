import { describe, expect, it } from 'vitest';
import { chooseLiveMode, pollIntervalMs } from './live-mode';

describe('chooseLiveMode', () => {
  it('nad HTTP/2 a HTTP/3 volí SSE', () => {
    expect(chooseLiveMode('h2')).toBe('sse');
    expect(chooseLiveMode('h3')).toBe('sse');
  });

  it('nad HTTP/1.1 volí dotazování (kritérium 94)', () => {
    expect(chooseLiveMode('http/1.1')).toBe('polling');
  });

  it('prázdná nebo neznámá hodnota znamená dotazování, tedy bezpečnou stranu', () => {
    expect(chooseLiveMode('')).toBe('polling');
    expect(chooseLiveMode(undefined)).toBe('polling');
  });
});

describe('pollIntervalMs', () => {
  it('při odesílání se ptá po třech sekundách, jinak po třiceti', () => {
    expect(pollIntervalMs('sending')).toBe(3000);
    expect(pollIntervalMs('sent')).toBe(30_000);
  });

  it('po přechodu na dotazování kvůli selhání SSE je interval patnáct sekund', () => {
    expect(pollIntervalMs('sending', { degraded: true })).toBe(15_000);
  });
});
