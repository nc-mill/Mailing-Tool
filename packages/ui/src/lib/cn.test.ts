import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('spojí třídy', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('vynechá falsy hodnoty', () => {
    const isDisabled = false;
    expect(cn('a', isDisabled && 'b', undefined, null, 'c')).toBe('a c');
  });

  it('u konfliktu vyhraje poslední třída', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('bg-surface', 'bg-surface-muted')).toBe('bg-surface-muted');
  });

  it('umí podmíněný objekt', () => {
    expect(cn('base', { active: true, hidden: false })).toBe('base active');
  });
});
