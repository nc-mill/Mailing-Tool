'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, SlidersHorizontal, X } from '../../icons';
import { useEffect, useId, useRef, useState } from 'react';
import { IconButton } from '../../components/icon-button';
import { Checkbox } from '../../components/checkbox';
import { cn } from '../../lib/cn';
import { mobileRoles, type DataTableMobileRole } from './mobile-roles';
import { PaginationFooter, type CountInfo } from './pagination-footer';
import { SelectionBar } from './selection-bar';
import { useColumnPreferences } from './use-column-preferences';
import { useRowSelection, type SelectionMode } from './use-row-selection';

/** Mez ze specifikace 14.2. Pod ní se virtualizace nevyplatí. */
const VIRTUALIZE_FROM = 100;
const ROW_HEIGHT = 44;

/**
 * Šířka, pod kterou se řádek kreslí jako karta. Musí sedět s variantou
 * `max-md:` v třídách níž; `md` je v Tailwindu 768 px.
 */
const CARD_MODE = '(max-width: 767px)';

/**
 * Kreslí se řádky jako karty?
 *
 * Samotné rozvržení karty umí CSS (`max-md:`) a JavaScript na ně nesahá.
 * Tenhle hook existuje kvůli JEDINÉ věci, kterou CSS neumí: VIRTUALIZACE.
 * Virtualizovaný řádek dostává pevnou výšku 44 px a absolutní pozici, kdežto
 * karta má tři řádky textu a měří přes sto pixelů. Karty by se proto překryly
 * a text by ležel přes text. Přesně to je „nepoužitelné", co je vidět na
 * obrazovce, ne chyba měření.
 *
 * Na serveru vrací `false`, takže se první vykreslení chová jako širší displej.
 * Je to bezpečná strana: rozvržení se po připojení srovná, kdežto opačná volba
 * by na monitoru krátce ukázala karty.
 */
function useCardMode(): boolean {
  const [cardMode, setCardMode] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(CARD_MODE);
    const update = (event: MediaQueryList | MediaQueryListEvent) => setCardMode(event.matches);
    update(query);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return cardMode;
}

/**
 * Ovládací prvky UVNITŘ buňky: tlačítko, odkaz, pole, zaškrtávátko, položka nabídky.
 * Kliknutí ani klávesa, které přišly z nich, řádku nepatří.
 *
 * JE TO JEDNA VĚC VE DVOU POLOVINÁCH: `onRowClick` je cesta myší, `onKeyDown` cesta
 * klávesnicí. **Kdo sáhne na jednu, musí sáhnout i na druhou.** Výčet proto stojí
 * tady, na jednom místě, a ne dvakrát opsaný uvnitř obsluh. Právě z rozejití těch
 * dvou cest vznikly obě vady, které tuhle tabulku potkaly: nejdřív fungovala jen
 * klávesnice a klik neměl obsluhu vůbec, pak měla výjimku jen myš a tlačítko v řádku
 * nešlo z klávesnice spustit.
 */
const ROW_CONTROLS = 'button, a, input, label, [role="checkbox"], [role="menuitem"]';

export type DataTableColumn<Row> = {
  id: string;
  header: string;
  cell: (row: Row) => React.ReactNode;
  /**
   * Řadit jde jen podle hodnot, které zdroj vyjmenovává v `order`.
   * Sloupec mimo ten výčet řazení **vůbec nenabízí**, žádná zašedlá šipka.
   */
  sortable?: boolean;
  /**
   * Pevná šířka sloupce v pixelech. Rozhoduje o ní **obrazovka**, ne uživatel:
   * je to volba návrhu pro sloupec, do kterého se sází odznak nebo datum.
   * Bez ní se sloupec roztáhne rovným dílem. Uživatelské nastavení přesné
   * šířky panel sloupců nenabízí a nikdy se neukládá.
   *
   * POD 768 px SE NEUPLATNÍ. Řádek je tam karta, ne mřížka, takže pevná šířka
   * sloupce nemá co držet a jen by kartu roztáhla ven ze stránky.
   */
  width?: number;
  /**
   * Role sloupce na kartě pod 768 px. Bez ní rozhodne `mobileRoles`.
   * Nastav ji tam, kde výchozí pravidlo („první sloupec je hlavní údaj")
   * nesedí, ne u každého sloupce.
   */
  mobile?: DataTableMobileRole;
};

export type DataTableLabels = {
  selectRow: string;
  selectAllOnPage: string;
  previous: string;
  next: string;
  showing: (shown: number, total: number, estimated: boolean) => string;
  selectedOnPage: (count: number) => string;
  selectAllMatching: (total: number) => string;
  selectedAllMatching: (total: number) => string;
  clearSelection: string;
  cursorInvalid: string;
  sortNotAvailable: string;
  sortedAscending: string;
  sortedDescending: string;
  /** Nastavení sloupců: viditelnost (tvrdý požadavek K1). */
  columnSettings: string;
  columnVisible: (column: string) => string;
  /**
   * Popisek křížku, kterým se panel sloupců zavírá. Nepovinný, protože ho
   * dřívější volající nemají; bez něj se křížek nevykreslí. Obrazovka, která
   * si spouštěč vzala do hlavičky, ho ale předat MÁ, jinak panel nemá jak
   * zavřít bez cesty zpátky nahoru. V katalogu je `common.actions.close`.
   */
  closeColumnSettings?: string;
};

export function DataTable<Row>({
  tableId,
  caption,
  columns,
  rows,
  getRowId,
  labels,
  count,
  pagination,
  order,
  cursorInvalid = false,
  filterDescription,
  bulkActions,
  onRowActivate,
  selection: selectionProp,
  selectable = true,
  emptyState,
  defaultVisibleColumns,
  virtualizeFrom = VIRTUALIZE_FROM,
  columnSettings,
}: {
  tableId: string;
  /** Popisek tabulky pro čtečku. Nikdy prázdný. */
  caption: string;
  columns: DataTableColumn<Row>[];
  rows: Row[];
  getRowId: (row: Row) => string;
  labels: DataTableLabels;
  count: CountInfo;
  pagination: {
    hasMore: boolean;
    canGoBack: boolean;
    onPrevious: () => void;
    onNext: () => void;
  };
  order?: { value: string; onChange: (value: string) => void };
  /** Kurzor přestal platit. Ukáže se první stránka stejného filtru a vysvětlení. */
  cursorInvalid?: boolean;
  filterDescription?: string;
  bulkActions?: React.ReactNode;
  onRowActivate?: (row: Row) => void;
  /**
   * Když je zadaný, výběr drží obrazovka. Jinak si ho tabulka řídí sama.
   *
   * `clearToken` je způsob, jak výběr uklidit i tehdy, když je rozšířený na „vše
   * odpovídající filtru": ten režim bydlí uvnitř tabulky a vynulování pole
   * `selectedIds` ho nezruší. Podrobně u `useRowSelection`.
   */
  selection?: {
    selectedIds: string[];
    onSelectionChange: (next: string[]) => void;
    /**
     * Režim výběru pro obrazovku. **Kdo ho nepřevezme, tomu tabulka odkaz
     * „Vybrat všech N" vůbec nenabídne**, protože by slíbil rozsah, na který
     * hromadné akce nedosáhnou.
     *
     * Obrazovka podle něj skládá rozsah akce: `rows` znamená výčet zaškrtnutých
     * identifikátorů, `allMatchingFilter` tentýž filtr, jaký je v adrese. Předat
     * ho smí jen ta, jejíž akce filtr opravdu umí; u kontaktů to je hromadné
     * smazání a export, u ostatních tabulek se to musí ověřit proti API.
     */
    onModeChange?: ((mode: SelectionMode) => void) | undefined;
    clearToken?: unknown;
  };
  /**
   * Kreslí se sloupec se zaškrtávátky? Výchozí `true`, aby se stávající tabulky
   * nemusely měnit.
   *
   * Existuje proto, že do 7. 8. 2026 se výběr kreslil BEZ JAKÉKOLI PODMÍNKY, takže
   * ho měla i obrazovka, nad kterou žádná hromadná akce není a vzniknout nemůže.
   * Zaškrtnout deset řádků a zjistit, že se s nimi nedá udělat nic, je horší než
   * nemít výběr vůbec: rozhraní slíbí schopnost, kterou nemá.
   *
   * Vypíná se tam, kde je tabulka ČTENÍ, ne pracovní plocha. První takový případ
   * jsou příjemci reportu kampaně (doručení jedné rozesílky; API nad příjemci
   * žádnou hromadnou operaci nezná) a Centrum úloh, kde by hromadná akce ani
   * dávat smysl nemohla, protože zastavit jde u každého druhu něco jiného.
   *
   * S `selectable={false}` mizí sloupec, hlavičkové „Označit všechny na stránce"
   * i pruh výběru. `selection` se pak ignoruje.
   */
  selectable?: boolean;
  /** Co se ukáže místo mřížky, když nejsou žádné řádky. */
  emptyState?: React.ReactNode;
  /** Kolik sloupců je vidět, dokud si uživatel nevybere. Výchozí je 6. */
  defaultVisibleColumns?: number;
  /** Mez, od které se zapíná virtualizace. Specifikace 14.2 říká 100. */
  virtualizeFrom?: number;
  /**
   * Kdo drží otevření panelu „Nastavení sloupců".
   *
   * Bez téhle propy si ho tabulka řídí sama a vykreslí si nad sebou vlastní
   * tlačítko. To je rozumné výchozí chování pro tabulku kdekoliv v aplikaci.
   *
   * Návrh ale spouštěč nemá nad tabulkou, má ho jako **ikonový čtverec 44×44
   * v hlavičce obrazovky** vedle hlavní akce, a to shodně na Kontaktech
   * i na Seznamech. Obrazovka proto může stav převzít: předá `open`
   * a `onOpenChange`, vykreslí si `IconButton` v `PageHeader` a tabulka pak
   * **žádné vlastní tlačítko nekreslí**, jen ukáže nebo schová panel.
   */
  columnSettings?: { open: boolean; onOpenChange: (open: boolean) => void };
}) {
  const pageIds = rows.map(getRowId);
  const selection = useRowSelection({
    pageIds,
    selectedIds: selectionProp?.selectedIds,
    onSelectionChange: selectionProp?.onSelectionChange,
    onModeChange: selectionProp?.onModeChange,
    clearToken: selectionProp?.clearToken,
  });
  const [focusedIndex, setFocusedIndex] = useState(0);
  // Neřízený stav existuje pořád, jen se nepoužije, když si ho vzala obrazovka.
  const [ownColumnSettingsOpen, setOwnColumnSettingsOpen] = useState(false);
  const columnSettingsOpen = columnSettings?.open ?? ownColumnSettingsOpen;
  // Předpona `id` zaškrtávátek v panelu. Na stránce může být tabulek víc,
  // takže se nesmí odvozovat jen od `column.id`.
  const columnSettingsId = useId();
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Nastavení sloupců je tvrdý požadavek K1. Hook existoval od úkolu 19,
  // ale tabulka ho neimportovala, takže viditelnost ani šířka nešly měnit.
  const preferences = useColumnPreferences({
    tableId,
    allColumns: columns.map((column) => column.id),
    defaultVisible: defaultVisibleColumns ?? Math.min(columns.length, 6),
  });

  const visibleColumns = columns.filter((column) => preferences.visible.includes(column.id));

  /**
   * POD 768 px JE ŘÁDEK KARTA, ne mřížka, a je to jediné rozvržení, které se
   * na telefonu dá přečíst.
   *
   * Naměřeno 7. 8. 2026 na 390 px: rám tabulky má 343 px, kdežto obsah řádku
   * Kontaktů 755 px (deset sloupců), Šablon 900 px, Segmentů 720 px. Sloupce
   * se nemají kam zúžit, takže se text vrství přes sebe a tabulka roluje
   * vodorovně uvnitř stránky, která roluje svisle. Vodorovný posuv s ukotveným
   * prvním sloupcem to nespraví: po odečtení zaškrtávátka a ukotveného e-mailu
   * zbývá na osm sloupců 240 px, tedy 30 px na sloupec.
   *
   * Karta srovnávání sloupců mezi řádky ZTRÁCÍ, a je to vědomá cena. Na telefonu
   * se čtou jednotlivé záznamy, na monitoru se porovnávají sloupce, a tabulka
   * nad 768 px zůstává beze změny.
   */
  const roles = mobileRoles(visibleColumns);
  const cardMode = useCardMode();

  // Virtualizace se zapíná od sta řádků (14.2). `aria-rowcount`
  // a `aria-rowindex` se počítají z dat, ne z vykreslených uzlů,
  // takže se virtualizací nemění.
  //
  // NA KARTÁCH SE NEZAPÍNÁ VŮBEC: počítá s pevnou výškou řádku 44 px, kdežto
  // karta má tři řádky textu. Řádky by se překryly a text by ležel přes text.
  const virtualized = rows.length >= virtualizeFrom && !cardMode;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => bodyRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    enabled: virtualized,
  });

  const visibleRows: Array<{ row: Row; index: number }> = virtualized
    ? virtualizer.getVirtualItems().flatMap((item) => {
        const row = rows[item.index];
        return row === undefined ? [] : [{ row, index: item.index }];
      })
    : rows.map((row, index) => ({ row, index }));

  function focusRow(index: number) {
    const clamped = Math.max(0, Math.min(rows.length - 1, index));
    setFocusedIndex(clamped);
    const target = bodyRef.current?.querySelectorAll<HTMLElement>('[role="row"]')[clamped];
    target?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>, index: number, row: Row) {
    // Jednopísmenné zkratky se ignorují, když je fokus v textovém poli.
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

    /*
     * ENTER A MEZERNÍK PATŘÍ PRVKU V BUŇCE, NE ŘÁDKU.
     *
     * Naměřená vada, kvůli které tenhle řádek vznikl: tlačítko potvrzení v seznamu
     * kontaktů nešlo z klávesnice spustit VŮBEC. `preventDefault()` níž potlačí
     * i vlastní aktivaci tlačítka, takže Enter kontakt nepotvrdil (0 požadavků na
     * server, stav beze změny) a místo toho otevřel detail, kdežto mezerník místo
     * potvrzení přepnul výběr řádku. Myší přitom tlačítko fungovalo, protože druhá
     * polovina téhle dvojice, `onRowClick`, tutéž výjimku má. Opravila se tehdy
     * jedna cesta a do druhé se to nezrcadlilo.
     *
     * Šipky, `j`, `k` ani `x` výjimku NEMAJÍ, a je to schválně: jsou to zkratky,
     * které si žádné tlačítko neobsluhuje samo, takže se o ně řádek s nikým nepere.
     * Pohyb mezi řádky navíc musí fungovat i tehdy, když fokus stojí na tlačítku
     * uvnitř buňky, jinak by se z něj šipkami nedalo dostat pryč.
     */
    const fromRowControl = target.closest(ROW_CONTROLS) !== null;

    if (event.key === 'ArrowDown' || event.key === 'j') {
      event.preventDefault();
      focusRow(index + 1);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'k') {
      event.preventDefault();
      focusRow(index - 1);
      return;
    }
    if (event.key === 'x' || (event.key === ' ' && !fromRowControl)) {
      event.preventDefault();
      if (event.shiftKey) selection.selectRange(getRowId(row));
      else selection.toggle(getRowId(row));
      return;
    }
    if (event.key === 'Enter' && onRowActivate && !fromRowControl) {
      event.preventDefault();
      onRowActivate(row);
    }
  }

  /**
   * Otevření řádku myší. Doplněno dodatečně, protože tabulka reagovala VÝHRADNĚ
   * na Enter a na klik neměla handler vůbec. Klávesová cesta byla hotová
   * a odladěná, takže to nikoho nenapadlo zkusit myší, jenže drtivá většina
   * uživatelů seznam otevírá kliknutím. Týkalo se to všech seznamů v aplikaci,
   * protože tuhle tabulku používají všechny.
   *
   * Kliknutí na ovládací prvky UVNITŘ řádku se ignoruje. Bez toho by zaškrtnutí
   * políčka nebo stisk tlačítka v řádku zároveň otevřely detail, takže by výběr
   * několika položek nešel udělat vůbec.
   *
   * Druhá polovina je `onKeyDown` výš. Výčet prvků je v `ROW_CONTROLS`, ať se
   * ty dvě cesty nemají jak rozejít potřetí.
   */
  function onRowClick(event: React.MouseEvent<HTMLDivElement>, index: number, row: Row) {
    if (!onRowActivate) return;
    const target = event.target as HTMLElement;
    if (target.closest(ROW_CONTROLS)) return;
    setFocusedIndex(index);
    onRowActivate(row);
  }

  const sortDirection = order?.value.endsWith('.desc') ? 'desc' : 'asc';
  const sortColumn = order?.value.split('.')[0];

  /*
   * SMÍ SE NABÍDNOUT „VYBRAT VŠECH N"? Dvě podmínky, obě nutné.
   *
   * ZA PRVÉ MUSÍ EXISTOVAT DALŠÍ STRÁNKA. Tabulka bez stránkování ukazuje všechno
   * naráz, takže „vybrat všech 9" nabízí právě těch devět řádků, které uživatel
   * vidí a nejspíš už zaškrtl; odkaz, po jehož stisku se nic nezmění, je lež.
   * Týká se to kampaní, seznamů, štítků i formulářů, tedy většiny tabulek v aplikaci.
   *
   * ZA DRUHÉ MUSÍ OBRAZOVKA REŽIM PŘEVZÍT. Bez `onModeChange` zůstane rozšířený
   * výběr jen uvnitř tabulky: pruh napíše „Vybráno všech 12 480", ale hromadná
   * akce pod ním dostane dvacet zaškrtnutých identifikátorů. Přesně tak se to
   * chovalo do 7. 8. 2026 na všech obrazovkách.
   */
  const canSelectAllMatching =
    (pagination.hasMore || pagination.canGoBack) && selectionProp?.onModeChange !== undefined;

  return (
    <div className="flex flex-col gap-3">
      {cursorInvalid ? (
        <p
          role="status"
          className="rounded-[var(--radius-control)] bg-surface-muted px-4 py-3 text-ui text-text"
        >
          {labels.cursorInvalid}
        </p>
      ) : null}

      {columnSettings ? null : (
        <div className="flex justify-end">
          <IconButton
            variant="quiet"
            label={labels.columnSettings}
            icon={<SlidersHorizontal aria-hidden className="icon-md" />}
            onClick={() => setOwnColumnSettingsOpen((open) => !open)}
            aria-expanded={columnSettingsOpen}
          />
        </div>
      )}

      {/* Panel nastavení sloupců. Nabízí JEN skrývání a zobrazování; přesná
          šířka v pixelech se tu dřív zadávala u každého sloupce zvlášť a byla
          zrušena. Zaškrtávátka proto stojí v jedné řadě vedle sebe, ne pod
          sebou, ať je panel nízký. Zalomení je pojistka pro úzké okno, ne
          rozvržení: na běžné šířce se vejdou na jeden řádek. */}
      {columnSettingsOpen ? (
        <div className="flex items-center gap-[var(--spacing-inline)] rounded-[var(--radius-surface)] border border-border bg-surface p-[var(--spacing-stack)]">
          <div className="flex flex-1 flex-wrap items-center gap-x-[var(--spacing-gutter)]">
            {columns.map((column) => {
              const checkboxId = `${columnSettingsId}-${column.id}`;
              return (
                <div
                  key={column.id}
                  className="flex min-h-[var(--size-target-min)] items-center gap-[var(--spacing-inline)]"
                >
                  {/* `aria-label` nese celou větu („Zobrazit sloupec Jméno"),
                      viditelný popisek jen název sloupce. Spárování přes
                      `htmlFor` je tu kvůli klikací ploše: `<button>` je
                      popisovatelný prvek, takže klik na jméno sloupce
                      zaškrtávátko přepne. */}
                  <Checkbox
                    id={checkboxId}
                    aria-label={labels.columnVisible(column.header)}
                    checked={preferences.visible.includes(column.id)}
                    onCheckedChange={() => preferences.toggleColumn(column.id)}
                  />
                  <label htmlFor={checkboxId} className="text-sm text-text">
                    {column.header}
                  </label>
                </div>
              );
            })}
          </div>
          {/* Zavírací křížek. Když spouštěč drží obrazovka, je to jediná cesta,
              jak panel zavřít bez cesty zpátky do hlavičky. */}
          {labels.closeColumnSettings ? (
            <IconButton
              variant="ghost"
              size="xs"
              label={labels.closeColumnSettings}
              icon={<X aria-hidden className="icon-sm" />}
              onClick={() =>
                columnSettings
                  ? columnSettings.onOpenChange(false)
                  : setOwnColumnSettingsOpen(false)
              }
            />
          ) : null}
        </div>
      ) : null}

      {/* Bez výběru se pruh nekreslí vůbec. Kdyby zůstal, hlásil by „Nevybráno nic"
          nad tabulkou, ve které se vybírat nedá. */}
      {selectable ? (
        <SelectionBar
          mode={selection.mode}
          count={selection.count}
          total={count.value}
          labels={labels}
          onSelectAllMatching={
            canSelectAllMatching
              ? () =>
                  selection.selectAllMatchingFilter({
                    total: count.value,
                    filter: filterDescription ?? '',
                  })
              : undefined
          }
          onClear={selection.clear}
          actions={bulkActions}
        />
      ) : null}

      {rows.length === 0 && emptyState ? emptyState : null}

      <div
        role="grid"
        hidden={rows.length === 0 && Boolean(emptyState)}
        aria-label={caption}
        // Počet řádků včetně hlavičky. Platí i při virtualizaci,
        // proto se bere z dat, ne z počtu vykreslených uzlů.
        aria-rowcount={rows.length + 1}
        data-table-id={tableId}
        className="overflow-auto rounded-[var(--radius-surface)] border border-border bg-surface"
      >
        <div
          role="row"
          aria-rowindex={1}
          data-testid="data-table-head"
          className={cn(
            'sticky top-0 z-[var(--z-sticky)] flex items-center gap-[var(--spacing-stack)]',
            'border-b border-border bg-surface-muted px-[var(--spacing-row-x)] py-3',
            // Na kartách se hlavička láme: zbydou v ní jen zaškrtávátko
            // s popiskem a tlačítka řazení, tedy to, co se jinak nedá udělat.
            'max-md:flex-wrap max-md:gap-y-1',
          )}
        >
          {selectable ? (
            <span role="columnheader" className="flex w-8 items-center max-md:w-auto max-md:gap-2">
              <Checkbox
                aria-label={labels.selectAllOnPage}
                dense
                checked={selection.allOnPageSelected}
                onCheckedChange={() => selection.toggleAllOnPage()}
              />
              {/* Na kartách stojí u zaškrtávátka jeho jméno. Bez hlavičky tabulky
                  by to bylo osamocené zaškrtávátko, u kterého není poznat,
                  co zaškrtne. Na mřížce ho nese sloupec, takže se skrývá.

                  NENÍ to `meta-caps` jako ostatní hlavičky: verzálky se lámou
                  do dvou řádků a celá věta („Vybrat všechny kontakty na této
                  stránce") pak nad tabulkou křičí víc než její obsah. */}
              <span aria-hidden className="hidden text-sm text-text-muted max-md:inline">
                {labels.selectAllOnPage}
              </span>
            </span>
          ) : null}
          {visibleColumns.map((column) => (
            <span
              key={column.id}
              role="columnheader"
              aria-sort={
                sortColumn === column.id
                  ? sortDirection === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : undefined
              }
              className={cn(
                'meta-caps flex-1 text-text-muted',
                // NÁZVY SLOUPCŮ SE NA KARTÁCH SKRÝVAJÍ `sr-only`, ne `hidden`.
                // Karta má název u každé hodnoty, takže vidět být nemusí, ale
                // `display: none` by je vzalo i z přístupnostního stromu
                // a čtečka by v mřížce ztratila hlavičky sloupců.
                //
                // VÝJIMKA JE ŘAZENÍ: tlačítko řazení je jediná cesta, jak
                // tabulku seřadit, a `sr-only` prvek se nedá stisknout prstem.
                // Řaditelné sloupce proto na kartách zůstávají vidět a lámou
                // se do řádku pod zaškrtávátkem.
                column.sortable && order ? 'max-md:flex-none' : 'max-md:sr-only',
              )}
              // Pevná šířka sloupce na kartách NEPLATÍ. Je to vnitřní styl,
              // takže ji třídou přebít nejde a musí se vynechat rovnou.
              style={!cardMode && column.width ? { width: column.width, flex: 'none' } : undefined}
            >
              {column.sortable && order ? (
                <button
                  type="button"
                  className="flex min-h-11 items-center gap-1"
                  onClick={() =>
                    order.onChange(
                      sortColumn === column.id && sortDirection === 'asc'
                        ? `${column.id}.desc`
                        : `${column.id}.asc`,
                    )
                  }
                >
                  {column.header}
                  {sortColumn === column.id ? (
                    sortDirection === 'asc' ? (
                      <ArrowUp aria-label={labels.sortedAscending} className="icon-sm" />
                    ) : (
                      <ArrowDown aria-label={labels.sortedDescending} className="icon-sm" />
                    )
                  ) : null}
                </button>
              ) : (
                column.header
              )}
            </span>
          ))}
        </div>

        <div
          ref={bodyRef}
          style={
            virtualized ? { height: virtualizer.getTotalSize(), position: 'relative' } : undefined
          }
        >
          {visibleRows.map(({ row, index }) => {
            const id = getRowId(row);
            return (
              <div
                key={id}
                role="row"
                // Index se počítá z dat, ne z pořadí v DOM, takže při
                // virtualizaci sedí i pro čtečku.
                aria-rowindex={index + 2}
                aria-selected={selection.isSelected(id)}
                tabIndex={index === focusedIndex ? 0 : -1}
                onKeyDown={(event) => onKeyDown(event, index, row)}
                onClick={(event) => onRowClick(event, index, row)}
                onFocus={() => setFocusedIndex(index)}
                style={
                  virtualized
                    ? {
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: ROW_HEIGHT,
                        transform: `translateY(${index * ROW_HEIGHT}px)`,
                      }
                    : undefined
                }
                className={cn(
                  'flex items-center gap-[var(--spacing-stack)] border-b border-border last:border-b-0',
                  'px-[var(--spacing-row-x)] py-[var(--spacing-row-y)]',
                  // KARTA. První řádek nese SÁM identifikátor, doplňkové údaje
                  // jsou pod ním jako dvojice popisek a hodnota. Zalomení dělá
                  // `flex-wrap`, pořadí `order` u buněk níž; DOM zůstává stejný,
                  // aby si čtečka i pohyb klávesnicí zachovaly pořadí sloupců.
                  'max-md:flex-wrap max-md:items-start max-md:gap-y-1.5 max-md:py-[var(--spacing-stack)]',
                  // MÍSTO PRO NABÍDKU V PRAVÉM HORNÍM ROHU. Nabídka je na kartě
                  // mimo tok (`absolute` níž), aby vedle identifikátoru nestálo
                  // nic a přesto byla vždycky na stejném místě. Vnitřní okraj
                  // vpravo je to jediné, co jí drží místo, jinak by pod ni
                  // dlouhá adresa podtekla.
                  'max-md:relative max-md:pr-[calc(var(--size-target-min)+var(--spacing-inline))]',
                  selection.isSelected(id)
                    ? 'bg-accent-surface'
                    : 'bg-surface hover:bg-surface-muted',
                )}
              >
                {selectable ? (
                  <span
                    role="gridcell"
                    className="flex w-8 items-center max-md:self-start max-md:pt-1"
                  >
                    <Checkbox
                      aria-label={labels.selectRow}
                      dense
                      checked={selection.isSelected(id)}
                      onClick={(event) => {
                        if (event.shiftKey) {
                          event.preventDefault();
                          selection.selectRange(id);
                        }
                      }}
                      onCheckedChange={() => selection.toggle(id)}
                    />
                  </span>
                ) : null}
                {visibleColumns.map((column) => {
                  const role = roles[column.id] ?? 'hidden';
                  const content = column.cell(row);
                  /*
                   * PRÁZDNÁ HODNOTA SE NA KARTĚ NEKRESLÍ VŮBEC, ani jako
                   * popisek s prázdnem za ním. Kontakt bez jména měl na kartě
                   * řádek „JMÉNO" a za ním nic, což vypadá jako chybějící
                   * data, ne jako nevyplněný údaj. Karta se má u takového
                   * kontaktu smrsknout.
                   *
                   * Poznáme jen prázdnotu, kterou vidět je: `null`, `undefined`
                   * a prázdný řetězec, tedy přesně to, co buňka vrací, když
                   * hodnota chybí. Element, který se vykreslí naprázdno, poznat
                   * nejde a je to v pořádku: takový sloupec by měl vracet
                   * `null`, ne prázdný `<span>`.
                   */
                  const emptyOnCard =
                    content === null ||
                    content === undefined ||
                    content === false ||
                    (typeof content === 'string' && content.trim() === '');
                  return (
                    <span
                      key={column.id}
                      role="gridcell"
                      className={cn(
                        'min-w-0 flex-1 text-ui text-text',
                        role === 'primary' &&
                          cn(
                            // IDENTIFIKÁTOR MÁ NA KARTĚ CELÝ PRVNÍ ŘÁDEK SÁM PRO
                            // SEBE. Vedle něj nestojí ani odznak stavu, ani
                            // nabídka: je to údaj, podle kterého člověk řádek
                            // hledá, a všechno ostatní ho jen zužuje.
                            'max-md:order-1 max-md:basis-full',
                            'max-md:flex max-md:min-h-[var(--size-target-min)] max-md:items-center',
                            'max-md:text-base max-md:font-semibold',
                            // NIKDY SE NEUŘÍZNE TŘEMI TEČKAMI, zalomí se.
                            // Zkrácená adresa je k nepoznání od jiné adresy
                            // téhož zákazníka, a přesně podle ní člověk řádek
                            // hledá. `anywhere` je u adres nutné: nemají mezeru,
                            // takže se běžným zalomením nezlomí vůbec.
                            'max-md:[overflow-wrap:anywhere]',
                            // Zkrácení si nese sama buňka od obrazovky
                            // (`truncate` na odkazu), takže se ruší i uvnitř.
                            // Bez tohohle by pravidlo výš platilo jen na obal
                            // a text by se pořád uřízl.
                            '[&_*]:max-md:overflow-visible [&_*]:max-md:whitespace-normal',
                            '[&_*]:max-md:[overflow-wrap:anywhere] [&_*]:max-md:max-w-full',
                            // Klikací plocha odkazu uvnitř: výška řádku textu
                            // je 22 px, tedy polovina toho, do čeho se dá
                            // trefit prstem.
                            '[&>a]:max-md:flex [&>a]:max-md:min-h-[var(--size-target-min)] [&>a]:max-md:items-center',
                            '[&>button]:max-md:flex [&>button]:max-md:min-h-[var(--size-target-min)] [&>button]:max-md:items-center',
                          ),
                        // NABÍDKA JE V PRAVÉM HORNÍM ROHU KARTY a je mimo tok,
                        // aby vedle identifikátoru nestála. Je to jediná cesta
                        // k akcím řádku, takže musí být vždycky na témž místě
                        // a nesmí ji odsunout obsah.
                        role === 'actions' &&
                          cn(
                            'max-md:absolute max-md:top-[var(--spacing-inline)] max-md:right-[var(--spacing-inline)]',
                            'max-md:order-2 max-md:w-auto max-md:flex-none',
                          ),
                        // Doplňkový údaj má na kartě vlastní řádek a před
                        // hodnotou název sloupce. `basis-full` je to, co ho
                        // pod první řádek zalomí. Odznak stavu je taky doplňkový
                        // údaj, takže stojí AŽ ZA identifikátorem, ne vedle něj.
                        role === 'secondary' &&
                          'max-md:order-3 max-md:flex max-md:basis-full max-md:items-baseline max-md:gap-2',
                        // Skrytý sloupec se z karty ODSTRANÍ, neschová se
                        // `sr-only`. V buňce může být tlačítko (potvrzení,
                        // odznak s akcí) a `sr-only` prvek zůstává zaostřitelný:
                        // uživatel s klávesnicí by tabuloval do ovládání,
                        // které není vidět. Údaj zůstává dostupný v detailu
                        // záznamu a v nastavení sloupců nad tabulkou.
                        role === 'hidden' && 'max-md:hidden',
                        // Prázdný doplňkový údaj z karty mizí i s popiskem.
                        role === 'secondary' && emptyOnCard && 'max-md:hidden',
                        // Totéž pro prázdnotu, kterou React poznat nemůže:
                        // buňka často vrací `<span>{row.name ?? ''}</span>`,
                        // tedy element, který se vykreslí naprázdno. Rozhodne
                        // o tom až prohlížeč, takže to musí umět CSS.
                        role === 'secondary' && '[&:has(>*:last-child:empty)]:max-md:hidden',
                      )}
                      style={
                        !cardMode && column.width
                          ? { width: column.width, flex: 'none' }
                          : undefined
                      }
                    >
                      {role === 'secondary' && !emptyOnCard ? (
                        // `aria-hidden`, protože tentýž název nese `columnheader`
                        // v hlavičce, kterou čtečka pořád vidí (je `sr-only`,
                        // ne `hidden`). Bez toho by se přečetl dvakrát.
                        <span
                          aria-hidden
                          className="meta-caps hidden shrink-0 text-text-muted max-md:inline"
                        >
                          {column.header}
                        </span>
                      ) : null}
                      {content}
                    </span>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Stránkování je UVNITŘ karty, ne pod ní. V návrhu je tabulka jedna
            plocha s hairline rámečkem a patička je její spodní pruh; kdyby
            stála venku, vznikly by pod sebou dva rámečky. */}
        <PaginationFooter
          shown={rows.length}
          count={count}
          hasMore={pagination.hasMore}
          canGoBack={pagination.canGoBack}
          onPrevious={pagination.onPrevious}
          onNext={pagination.onNext}
          labels={labels}
        />
      </div>
    </div>
  );
}
