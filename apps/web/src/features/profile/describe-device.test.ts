import { describe, expect, it } from 'vitest';
import { describeDevice } from './describe-device';

const FALLBACK = 'Neznámé zařízení';

describe('describeDevice', () => {
  it('u prázdné hodnoty vrátí náhradní text', () => {
    expect(describeDevice('', FALLBACK)).toBe(FALLBACK);
    expect(describeDevice('   ', FALLBACK)).toBe(FALLBACK);
  });

  it('pozná Safari na macOS', () => {
    const agent =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
    expect(describeDevice(agent, FALLBACK)).toBe('Safari, Macintosh');
  });

  it('pozná Chrome na Windows', () => {
    const agent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36';
    expect(describeDevice(agent, FALLBACK)).toBe('Chrome, Windows NT 10.0');
  });

  it('u nerozpoznaného řetězce vrátí náhradní text, ne syrový user agent', () => {
    expect(describeDevice('curl/8.4.0', FALLBACK)).toBe(FALLBACK);
  });

  /**
   * STARÉ RELACE. Do 6. 8. 2026 se k přihlášení ukládal user agent Node
   * (`node`), protože požadavek na API odesílal server, ne prohlížeč. Takové
   * řádky v databázi zůstávají a obrazovka je musí unést: ukáže náhradní text,
   * nespadne a nevypíše `node` jako jméno zařízení.
   */
  it('u starých relací s hodnotou node vrátí náhradní text', () => {
    expect(describeDevice('node', FALLBACK)).toBe(FALLBACK);
  });

  it('nikdy nevrátí celý user agent', () => {
    const agent = 'Mozilla/5.0 (X11; Linux x86_64) Firefox/141.0';
    expect(describeDevice(agent, FALLBACK)).not.toContain('Mozilla/5.0');
  });
});
