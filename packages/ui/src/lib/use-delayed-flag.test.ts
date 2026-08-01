import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDelayedFlag } from './use-delayed-flag';

describe('useDelayedFlag', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('u operace kratší než 300 ms se indikátor nezobrazí vůbec', () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active), {
      initialProps: { active: true },
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    rerender({ active: false });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(false);
  });

  it('po 300 ms se zobrazí', () => {
    const { result } = renderHook(() => useDelayedFlag(true));
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe(true);
  });

  it('jakmile se zobrazí, zůstane aspoň 400 ms', () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active), {
      initialProps: { active: true },
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe(true);

    rerender({ active: false });
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(result.current).toBe(false);
  });
});
