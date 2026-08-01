import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useOptimisticAction } from './use-optimistic-action';

type Row = { id: string; tag: string | null };

describe('useOptimisticAction', () => {
  it('při úspěchu ponechá optimistický stav', async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useOptimisticAction<Row>({
        initial: { id: 'a', tag: null },
        apply: (state) => ({ ...state, tag: 'Brno' }),
        commit,
      }),
    );

    await act(async () => {
      await result.current.run();
    });

    expect(result.current.state.tag).toBe('Brno');
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('při selhání vrátí stav přesně do původní podoby', async () => {
    const original: Row = { id: 'a', tag: null };
    const { result } = renderHook(() =>
      useOptimisticAction<Row>({
        initial: original,
        apply: (state) => ({ ...state, tag: 'Brno' }),
        commit: () => Promise.reject(new Error('kvóta')),
      }),
    );

    await act(async () => {
      await result.current.run();
    });

    expect(result.current.state).toEqual(original);
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('po selhání se akce nezopakuje sama', async () => {
    const commit = vi.fn().mockRejectedValue(new Error('síť'));
    const { result } = renderHook(() =>
      useOptimisticAction<Row>({
        initial: { id: 'a', tag: null },
        apply: (state) => ({ ...state, tag: 'Brno' }),
        commit,
      }),
    );

    await act(async () => {
      await result.current.run();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('opakování je jen na výslovný pokyn uživatele', async () => {
    const commit = vi.fn().mockRejectedValueOnce(new Error('síť')).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() =>
      useOptimisticAction<Row>({
        initial: { id: 'a', tag: null },
        apply: (state) => ({ ...state, tag: 'Brno' }),
        commit,
      }),
    );

    await act(async () => {
      await result.current.run();
    });
    expect(result.current.state.tag).toBeNull();

    await act(async () => {
      await result.current.retry();
    });
    await waitFor(() => expect(result.current.state.tag).toBe('Brno'));
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('během běhu hlásí čekání, aby tlačítko mohlo ukázat stav', async () => {
    let release: () => void = () => {};
    const commit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useOptimisticAction<Row>({
        initial: { id: 'a', tag: null },
        apply: (state) => ({ ...state, tag: 'Brno' }),
        commit,
      }),
    );

    let pending: Promise<void>;
    act(() => {
      pending = result.current.run();
    });
    await waitFor(() => expect(result.current.isPending).toBe(true));

    await act(async () => {
      release();
      await pending;
    });
    expect(result.current.isPending).toBe(false);
  });
});
