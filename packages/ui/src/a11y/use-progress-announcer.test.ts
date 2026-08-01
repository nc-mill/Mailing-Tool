import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProgressAnnouncer } from './use-progress-announcer';
import { useDebouncedAnnouncement } from './use-debounced-announcement';

describe('useProgressAnnouncer', () => {
  it('oznámí při 25, 50, 75 a 100 procentech, ne častěji', () => {
    const announce = vi.fn();
    const { rerender } = renderHook(
      ({ done }) => useProgressAnnouncer({ done, total: 100, announce, label: 'Import' }),
      { initialProps: { done: 0 } },
    );

    for (let value = 1; value <= 100; value += 1) {
      rerender({ done: value });
    }

    expect(announce).toHaveBeenCalledTimes(4);
    expect(announce.mock.calls.map((call) => call[0])).toEqual([25, 50, 75, 100]);
  });

  it('při skoku přes práh oznámí jen dosažený nejvyšší práh', () => {
    const announce = vi.fn();
    const { rerender } = renderHook(
      ({ done }) => useProgressAnnouncer({ done, total: 100, announce, label: 'Import' }),
      { initialProps: { done: 0 } },
    );
    rerender({ done: 80 });
    expect(announce).toHaveBeenCalledTimes(3);
  });

  it('u nulového celku neoznamuje nic', () => {
    const announce = vi.fn();
    renderHook(() => useProgressAnnouncer({ done: 0, total: 0, announce, label: 'Import' }));
    expect(announce).not.toHaveBeenCalled();
  });
});

describe('useDebouncedAnnouncement', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('oznámí až po 500 ms ustálení a jen jednou', () => {
    const announce = vi.fn();
    const { rerender } = renderHook(({ value }) => useDebouncedAnnouncement(value, announce, 500), {
      initialProps: { value: '1 kontakt' },
    });

    rerender({ value: '12 kontaktů' });
    rerender({ value: '124 kontaktů' });
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(announce).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('124 kontaktů');
  });
});
