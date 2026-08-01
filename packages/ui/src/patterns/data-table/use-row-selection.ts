'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

export type SelectionMode = 'rows' | 'allMatchingFilter';

/**
 * Výběr řádků, který přežije přestránkování (tvrdý požadavek K1).
 *
 * Rozlišuje dva režimy, protože je to klasická past: uživatel zaškrtne
 * hlavičku, myslí si, že vybral 50 řádků na obrazovce, a smaže 50 000.
 */
export function useRowSelection({
  pageIds,
  selectedIds,
  onSelectionChange,
}: {
  pageIds: string[];
  /** Když je zadaný, výběr drží obrazovka a hook je jen řízený. */
  selectedIds?: string[] | undefined;
  onSelectionChange?: ((next: string[]) => void) | undefined;
}) {
  const [own, setOwn] = useState<string[]>([]);
  const controlled = selectedIds !== undefined;
  const selected = controlled ? selectedIds : own;

  const setSelected = useCallback(
    (updater: (current: string[]) => string[]) => {
      if (controlled) {
        onSelectionChange?.(updater(selectedIds));
        return;
      }
      setOwn((current) => {
        const next = updater(current);
        onSelectionChange?.(next);
        return next;
      });
    },
    [controlled, onSelectionChange, selectedIds],
  );

  const [mode, setMode] = useState<SelectionMode>('rows');
  const [matching, setMatching] = useState<{ total: number; filter: string } | null>(null);
  const anchor = useRef<string | null>(null);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggle = useCallback(
    (id: string) => {
      anchor.current = id;
      setMode('rows');
      setMatching(null);
      setSelected((current) =>
        current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
      );
    },
    [setSelected],
  );

  /** Rozsah od poslední označené kotvy k `id`, v pořadí stránky. */
  const selectRange = useCallback(
    (id: string) => {
      const from = anchor.current;
      if (from === null) {
        toggle(id);
        return;
      }
      const start = pageIds.indexOf(from);
      const end = pageIds.indexOf(id);
      if (start === -1 || end === -1) return;
      const [low, high] = start <= end ? [start, end] : [end, start];
      const range = pageIds.slice(low, high + 1);
      setSelected((current) => {
        const next = new Set(current);
        for (const item of range) next.add(item);
        return pageIds
          .filter((item) => next.has(item))
          .concat(current.filter((item) => !pageIds.includes(item)));
      });
    },
    [pageIds, setSelected, toggle],
  );

  const toggleAllOnPage = useCallback(() => {
    setMode('rows');
    setMatching(null);
    setSelected((current) => {
      const allSelected = pageIds.every((id) => current.includes(id));
      if (allSelected) return current.filter((id) => !pageIds.includes(id));
      const next = new Set(current);
      for (const id of pageIds) next.add(id);
      return [...next];
    });
  }, [pageIds, setSelected]);

  const selectAllMatchingFilter = useCallback((input: { total: number; filter: string }) => {
    setMode('allMatchingFilter');
    setMatching(input);
  }, []);

  const clear = useCallback(() => {
    setSelected(() => []);
    setMode('rows');
    setMatching(null);
    anchor.current = null;
  }, [setSelected]);

  /**
   * Hromadná akce nad výběrem. Výběr se uklidí **jen po úspěchu**.
   *
   * Když akce selže, výjimka proletí ven a řádky pod ní se nikdy neprovedou,
   * takže výběr zůstane (zákaz z 6.7: uživatel by musel vybírat znovu).
   * Nesmí se to obalit do `try/finally`, tím by se ochrana zrušila.
   */
  const runBulkAction = useCallback(
    async (action: () => Promise<void>) => {
      await action();
      clear();
    },
    [clear],
  );

  return {
    selectedIds: selected,
    isSelected: (id: string) => mode === 'allMatchingFilter' || selectedSet.has(id),
    count: mode === 'allMatchingFilter' ? (matching?.total ?? 0) : selected.length,
    mode,
    filterDescription: matching?.filter,
    allOnPageSelected: pageIds.length > 0 && pageIds.every((id) => selectedSet.has(id)),
    toggle,
    selectRange,
    toggleAllOnPage,
    selectAllMatchingFilter,
    clear,
    runBulkAction,
  };
}
