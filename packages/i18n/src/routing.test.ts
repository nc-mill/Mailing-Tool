import { describe, expect, it } from 'vitest';
import { routing } from './routing';

describe('routing', () => {
  it('výchozí jazyk je bez prefixu v cestě', () => {
    expect(routing.localePrefix).toBe('as-needed');
    expect(routing.defaultLocale).toBe('cs');
  });

  it('zná oba jazyky', () => {
    expect(routing.locales).toEqual(['cs', 'en']);
  });
});
