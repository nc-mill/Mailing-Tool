import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRowSelection } from './use-row-selection';

const page1 = ['a', 'b', 'c', 'd', 'e'];
const page2 = ['f', 'g', 'h'];

describe('useRowSelection', () => {
  it('výběr přežije přestránkování', () => {
    const { result, rerender } = renderHook(({ ids }) => useRowSelection({ pageIds: ids }), {
      initialProps: { ids: page1 },
    });

    act(() => result.current.toggle('b'));
    act(() => result.current.toggle('d'));
    expect(result.current.selectedIds).toEqual(['b', 'd']);

    rerender({ ids: page2 });
    expect(result.current.selectedIds).toEqual(['b', 'd']);

    act(() => result.current.toggle('g'));
    expect(result.current.selectedIds).toEqual(['b', 'd', 'g']);
    expect(result.current.count).toBe(3);
  });

  it('Shift + klik označí rozsah na stránce', () => {
    const { result } = renderHook(() => useRowSelection({ pageIds: page1 }));

    act(() => result.current.toggle('b'));
    act(() => result.current.selectRange('d'));
    expect(result.current.selectedIds).toEqual(['b', 'c', 'd']);
  });

  it('rozsah funguje i směrem nahoru', () => {
    const { result } = renderHook(() => useRowSelection({ pageIds: page1 }));
    act(() => result.current.toggle('d'));
    act(() => result.current.selectRange('b'));
    expect(result.current.selectedIds).toEqual(['b', 'c', 'd']);
  });

  it('hlavička vybere jen řádky na stránce, ne všechno', () => {
    const { result } = renderHook(() => useRowSelection({ pageIds: page1 }));
    act(() => result.current.toggleAllOnPage());
    expect(result.current.selectedIds).toEqual(page1);
    expect(result.current.mode).toBe('rows');
  });

  it('výběr všeho podle filtru je jiný režim a drží filtr', () => {
    const { result } = renderHook(() => useRowSelection({ pageIds: page1 }));
    act(() => result.current.selectAllMatchingFilter({ total: 12_480, filter: 'štítek Brno' }));

    expect(result.current.mode).toBe('allMatchingFilter');
    expect(result.current.count).toBe(12_480);
    expect(result.current.filterDescription).toBe('štítek Brno');
  });

  it('zrušení výběru vrátí režim i počet na začátek', () => {
    const { result } = renderHook(() => useRowSelection({ pageIds: page1 }));
    act(() => result.current.selectAllMatchingFilter({ total: 12_480, filter: 'štítek Brno' }));
    act(() => result.current.clear());

    expect(result.current.mode).toBe('rows');
    expect(result.current.count).toBe(0);
  });

  it('úspěšná hromadná akce výběr uklidí', async () => {
    const { result } = renderHook(() => useRowSelection({ pageIds: page1 }));
    act(() => result.current.toggle('a'));
    act(() => result.current.toggle('c'));

    await act(() => result.current.runBulkAction(async () => {}));
    expect(result.current.selectedIds).toEqual([]);
  });

  it('neúspěšná hromadná akce výběr nechá být', async () => {
    // Zákaz z 6.7: uživatel by musel vybírat znovu. Dřív tuhle vlastnost
    // hlídala prázdná funkce, takže test nemohl spadnout ani tehdy, kdyby
    // se výběr po chybě mazal. Teď obě větve testují skutečné chování.
    const { result } = renderHook(() => useRowSelection({ pageIds: page1 }));
    act(() => result.current.toggle('a'));
    act(() => result.current.toggle('c'));

    await expect(
      act(() =>
        result.current.runBulkAction(async () => {
          throw new Error('server odmítl');
        }),
      ),
    ).rejects.toThrow('server odmítl');

    expect(result.current.selectedIds).toEqual(['a', 'c']);
  });

  it('výběr jde řídit zvenčí, aby si ho obrazovka mohla držet sama', () => {
    const onSelectionChange = vi.fn();
    const { result } = renderHook(() =>
      useRowSelection({ pageIds: page1, selectedIds: ['b'], onSelectionChange }),
    );
    act(() => result.current.toggle('d'));
    expect(onSelectionChange).toHaveBeenCalledWith(['b', 'd']);
  });
});
