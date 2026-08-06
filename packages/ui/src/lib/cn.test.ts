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

  // Regrese: `tailwind-merge` bral vlastní velikosti písma jako barvy textu
  // a při skládání je zahazoval. Prvek pak tiše dostal zděděnou velikost.
  it('velikost písma z tokenů přežije vedle barvy textu', () => {
    expect(cn('text-ui', 'text-text')).toBe('text-ui text-text');
    expect(cn('text-h1', 'text-text-muted')).toBe('text-h1 text-text-muted');
    expect(cn('meta-caps', 'text-panel-muted')).toBe('meta-caps text-panel-muted');
  });

  it('dvě velikosti písma se pořád vylučují', () => {
    expect(cn('text-ui', 'text-h1')).toBe('text-h1');
    expect(cn('text-sm', 'text-body')).toBe('text-body');
  });

  it('dvě velikosti ikony se vylučují', () => {
    expect(cn('icon-sm', 'icon-lg')).toBe('icon-lg');
  });

  it('umí podmíněný objekt', () => {
    expect(cn('base', { active: true, hidden: false })).toBe('base active');
  });
});
