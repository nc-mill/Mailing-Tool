'use client';

import { useCallback, useEffect, useState } from 'react';

type Preferences = { hidden: string[] };

const VERSION = 1;

function storageKey(tableId: string): string {
  return `mlain.table.${tableId}`;
}

/**
 * Uložené nastavení, nebo `null`, když v úložišti nic použitelného není.
 *
 * Rozdíl mezi „nic uloženo" a „uloženo prázdno" je podstatný: prázdný seznam
 * skrytých sloupců je platná volba (uživatel si zobrazil všechno) a nesmí se
 * po načtení stránky přepsat výchozí šesticí.
 */
function read(tableId: string): Preferences | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(storageKey(tableId));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { version?: number; hidden?: string[] };
    if (parsed.version !== VERSION) return null;
    if (!Array.isArray(parsed.hidden)) return null;
    // Starší zápisy nesou i `widths`. Přesná šířka se už nenastavuje, takže
    // se údaj při čtení zahodí a při nejbližším zápisu z úložiště zmizí.
    return { hidden: parsed.hidden };
  } catch {
    // Poškozený zápis nesmí zabít tabulku, jen se zahodí.
    console.error('Nastavení sloupců je poškozené, používáme výchozí.');
    return null;
  }
}

/**
 * Viditelnost sloupců, uložená na uživatele a tabulku.
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
  const [preferences, setPreferences] = useState<Preferences>(
    () => read(tableId) ?? { hidden: allColumns.slice(defaultVisible) },
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      storageKey(tableId),
      JSON.stringify({ version: VERSION, ...preferences }),
    );
  }, [preferences, tableId]);

  const toggleColumn = useCallback((column: string) => {
    setPreferences((current) => ({
      hidden: current.hidden.includes(column)
        ? current.hidden.filter((item) => item !== column)
        : [...current.hidden, column],
    }));
  }, []);

  return {
    visible: allColumns.filter((column) => !preferences.hidden.includes(column)),
    hidden: preferences.hidden,
    toggleColumn,
  };
}
