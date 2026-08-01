import { EmptyState, type EmptyStateAction } from './empty-state';

/**
 * Stav S2. Je to **samostatný stav**, ne varianta S1: katalog 7.1 mu
 * předepisuje jiné povinné prvky, tedy připomenutí filtru slovy a tlačítko
 * na jeho zrušení. Kdyby se skládal ručně z `EmptyState`, každá obrazovka
 * by na jeden z těch dvou prvků dřív nebo později zapomněla.
 */
export function FilteredEmptyState({
  title,
  explanation,
  filterDescription,
  clearFiltersLabel,
  onClearFilters,
  suggestion,
  actions = [],
  className,
}: {
  title: string;
  explanation: string;
  /** Použitý filtr slovy, například „štítek Brno a stav Potvrzený". */
  filterDescription: string;
  clearFiltersLabel: string;
  onClearFilters: () => void;
  /** Návrh, jak hledání upravit. */
  suggestion?: string;
  actions?: EmptyStateAction[];
  className?: string;
}) {
  return (
    <EmptyState
      variant="filtered"
      title={title}
      explanation={explanation}
      filterDescription={filterDescription}
      // Zrušení filtrů je vždycky první akce, protože je to ta,
      // kterou uživatel v tomhle stavu skoro vždy chce.
      actions={[{ label: clearFiltersLabel, onClick: onClearFilters }, ...actions]}
      hint={suggestion}
      className={className}
    />
  );
}
