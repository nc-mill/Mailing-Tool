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
  onModeChange,
  clearToken,
}: {
  pageIds: string[];
  /** Když je zadaný, výběr drží obrazovka a hook je jen řízený. */
  selectedIds?: string[] | undefined;
  onSelectionChange?: ((next: string[]) => void) | undefined;
  /**
   * Režim výběru se ZMĚNIL. Bez téhle propy zůstává uvnitř hooku a hromadné akce
   * o něm nevědí.
   *
   * PROČ VZNIKLA. Odkaz „Vybrat všech N" přepnul režim na `allMatchingFilter`, pruh
   * napsal „Vybráno všech 12 480", ale řízené pole `selectedIds` se tím nezměnilo,
   * takže tlačítko pod tím textem dál pracovalo s dvaceti zaškrtnutými řádky. Pruh
   * a akce se rozešly a rozhraní lhalo. Režim se proto pouští ven stejně jako výběr.
   *
   * HLÁSÍ SE KAŽDÁ ZMĚNA, ne jen rozšíření na celý filtr: zaškrtnutí jednoho řádku
   * nebo hlavičky režim vrací zpátky na `rows` a obrazovka to musí vědět taky,
   * jinak by nad jedním zaškrtnutým řádkem spustila akci nad celým filtrem.
   *
   * ÚKLID PŘES `clearToken` SE NEHLÁSÍ. Ten mění vlastník výběru sám a ve stejném
   * kroku si režim srovná; volání zvenčí by tu navíc padlo do vykreslování cizí
   * komponenty, což React zakazuje.
   */
  onModeChange?: ((mode: SelectionMode) => void) | undefined;
  /**
   * Změna téhle hodnoty výběr uklidí, včetně režimu „vše odpovídající filtru".
   *
   * PROČ TO NEJDE BEZ NÍ. Řízený režim pouští ven jen `selectedIds`, kdežto režim
   * výběru a spočítané „vše odpovídající filtru" bydlí uvnitř hooku. Obrazovka si
   * tedy sama po hromadné akci uklidit nedokáže: vynuluje si vlastní pole, ale pruh
   * výběru zůstane viset, protože v režimu `allMatchingFilter` se počet bere
   * z `matching.total`, ne z délky pole. Přesně to zažil uživatel po hromadném
   * smazání: akce proběhla, pruh nad tabulkou zůstal a nabízel akce nad kontakty,
   * které už neexistují.
   *
   * Je to TOKEN, ne příkaz: hook si pamatuje poslední viděnou hodnotu a uklidí,
   * když se změní. Volající proto nemusí řešit, kdy se překreslí.
   */
  clearToken?: unknown;
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

  /*
   * Poslední známý režim v ref, ne jen ve stavu. Ohlásit se smí JEN SKUTEČNÁ ZMĚNA,
   * jinak by každé zaškrtnutí řádku posílalo ven „režim je rows" a obrazovka by
   * překreslovala hromadné akce pokaždé znovu. Stav se ve chvíli volání ještě nezměnil
   * (React ho srovná až v dalším vykreslení), takže porovnávat jde jedině proti ref.
   */
  const modeRef = useRef<SelectionMode>('rows');
  const switchMode = useCallback(
    (next: SelectionMode) => {
      if (modeRef.current === next) return;
      modeRef.current = next;
      setMode(next);
      onModeChange?.(next);
    },
    [onModeChange],
  );

  /*
   * Úklid na pokyn zvenčí. Stav se rovná PŘI VYKRESLOVÁNÍ, ne v efektu: efekt by
   * nechal pruh výběru jeden snímek viset a uživatel by ho po smazání viděl bliknout.
   * React tenhle tvar povoluje právě pro srovnání stavu podle změněné propy, protože
   * je pod podmínkou, která se hned nato přestane plnit.
   *
   * Neřízený výběr si vynuluje i pole; řízený ho drží obrazovka, která ho ruší sama.
   */
  const seenClearToken = useRef(clearToken);
  if (clearToken !== seenClearToken.current) {
    seenClearToken.current = clearToken;
    if (!controlled) setOwn([]);
    // Bez `modeRef` by se ohlásila až PŘÍŠTÍ změna režimu: hook by si pamatoval
    // `allMatchingFilter`, přepnutí na `rows` by proti ref vyšlo jako beze změny
    // a obrazovka by o něm nevěděla. Zvenčí se tenhle úklid schválně nehlásí.
    modeRef.current = 'rows';
    if (mode !== 'rows') setMode('rows');
    if (matching !== null) setMatching(null);
    anchor.current = null;
  }

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggle = useCallback(
    (id: string) => {
      anchor.current = id;
      switchMode('rows');
      setMatching(null);
      setSelected((current) =>
        current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
      );
    },
    [setSelected, switchMode],
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
      // Rozsah je označení řádků, takže z „vše odpovídající filtru" vede ven stejně
      // jako kliknutí do jednoho zaškrtávátka. Bez tohohle by zůstal viset režim,
      // ve kterém hromadná akce jede nad celým filtrem, i když uživatel právě
      // ukázal na pět řádků.
      switchMode('rows');
      setMatching(null);
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
    [pageIds, setSelected, switchMode, toggle],
  );

  const toggleAllOnPage = useCallback(() => {
    switchMode('rows');
    setMatching(null);
    setSelected((current) => {
      const allSelected = pageIds.every((id) => current.includes(id));
      if (allSelected) return current.filter((id) => !pageIds.includes(id));
      const next = new Set(current);
      for (const id of pageIds) next.add(id);
      return [...next];
    });
  }, [pageIds, setSelected, switchMode]);

  const selectAllMatchingFilter = useCallback(
    (input: { total: number; filter: string }) => {
      switchMode('allMatchingFilter');
      setMatching(input);
    },
    [switchMode],
  );

  const clear = useCallback(() => {
    setSelected(() => []);
    switchMode('rows');
    setMatching(null);
    anchor.current = null;
  }, [setSelected, switchMode]);

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
