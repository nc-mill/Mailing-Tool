'use client';

import { useCallback, useEffect, useState } from 'react';

type Preferences = { hidden: string[]; widths: Record<string, number> };

const VERSION = 1;

function storageKey(tableId: string): string {
  return `mlain.table.${tableId}`;
}

function read(tableId: string): Preferences {
  if (typeof window === 'undefined') return { hidden: [], widths: {} };
  const raw = window.localStorage.getItem(storageKey(tableId));
  if (raw === null) return { hidden: [], widths: {} };
  try {
    const parsed = JSON.parse(raw) as { version?: number } & Preferences;
    if (parsed.version !== VERSION) return { hidden: [], widths: {} };
    return { hidden: parsed.hidden ?? [], widths: parsed.widths ?? {} };
  } catch {
    // Poškozený zápis nesmí zabít tabulku, jen se zahodí.
    console.error('Nastavení sloupců je poškozené, používáme výchozí.');
    return { hidden: [], widths: {} };
  }
}

/**
 * Viditelnost a šířka sloupců, uložené na uživatele a tabulku.
 * Stav filtrů a řazení do úložiště nepatří, ten je v URL (konvence 4.3).
 */
export function useColumnPreferences({
  tableId,
  allColumns,
  defaultVisible,
}: {
  tableId: string;
  allColumns: string[];
  /** Kolik sloupců je vidět, dokud si uživatel nevybere. Výchozí sada je 6. */
  defaultVisible: number;
}) {
  const [preferences, setPreferences] = useState<Preferences>(() => {
    const stored = read(tableId);
    if (stored.hidden.length === 0 && Object.keys(stored.widths).length === 0) {
      return { hidden: allColumns.slice(defaultVisible), widths: {} };
    }
    return stored;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      storageKey(tableId),
      JSON.stringify({ version: VERSION, ...preferences }),
    );
  }, [preferences, tableId]);

  const toggleColumn = useCallback((column: string) => {
    setPreferences((current) => ({
      ...current,
      hidden: current.hidden.includes(column)
        ? current.hidden.filter((item) => item !== column)
        : [...current.hidden, column],
    }));
  }, []);

  const setWidth = useCallback((column: string, width: number) => {
    setPreferences((current) => ({ ...current, widths: { ...current.widths, [column]: width } }));
  }, []);

  return {
    visible: allColumns.filter((column) => !preferences.hidden.includes(column)),
    hidden: preferences.hidden,
    widths: preferences.widths,
    toggleColumn,
    setWidth,
  };
}
