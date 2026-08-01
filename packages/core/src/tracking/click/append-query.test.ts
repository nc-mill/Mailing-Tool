import { describe, expect, it } from 'vitest';
import { appendQueryParam } from './append-query';

describe('appendQueryParam', () => {
  it('přidá parametr k adrese bez query', () => {
    expect(appendQueryParam('https://shop.cz/vyprodej', 'ml_token', 't1abc')).toBe(
      'https://shop.cz/vyprodej?ml_token=t1abc',
    );
  });

  it('zachová existující query i fragment a fragment nechá na konci', () => {
    expect(appendQueryParam('https://x.cz/a?b=1#c', 'ml_token', 't1abc')).toBe(
      'https://x.cz/a?b=1&ml_token=t1abc#c',
    );
  });

  it('existující ml_token přepíše, nezdvojí', () => {
    expect(appendQueryParam('https://x.cz/a?ml_token=old', 'ml_token', 't1new')).toBe(
      'https://x.cz/a?ml_token=t1new',
    );
  });

  it('nevalidní adresu vrátí beze změny, aby se přesměrování nerozbilo', () => {
    expect(appendQueryParam('není url', 'ml_token', 't1abc')).toBe('není url');
  });
});
