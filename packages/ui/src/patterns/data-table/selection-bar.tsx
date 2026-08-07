'use client';

import { Button } from '../../components/button';
import { cn } from '../../lib/cn';

/**
 * Rozlišení „vybráno na stránce" a „vybráno vše" (6.5).
 * Bez něj uživatel zaškrtne hlavičku, myslí si, že vybral 50 řádků,
 * a smaže 50 000.
 */
export function SelectionBar({
  mode,
  count,
  total,
  labels,
  onSelectAllMatching,
  onClear,
  actions,
}: {
  mode: 'rows' | 'allMatchingFilter';
  count: number;
  total: number;
  labels: {
    selectedOnPage: (count: number) => string;
    selectAllMatching: (total: number) => string;
    selectedAllMatching: (total: number) => string;
    clearSelection: string;
  };
  /**
   * Rozšíření výběru na všechno, co odpovídá filtru. **Nepovinné, a to je celá pointa:
   * bez něj se odkaz vůbec nekreslí.**
   *
   * Do 7. 8. 2026 byl odkaz vždycky. Nad tabulkou, která se nestránkuje (kampaně,
   * seznamy, štítky, formuláře), sliboval „Vybrat všech 9" nad devíti řádky, které
   * uživatel právě zaškrtl, tedy přesně to, co už vybrané bylo. Odkaz, po jehož
   * stisku se nic nezmění, je lež o schopnosti, kterou tabulka nemá.
   *
   * Kdo ho smí nabídnout, rozhoduje `DataTable`: musí existovat další stránka
   * A zároveň musí umět obrazovka režim převzít (`selection.onModeChange`). Bez toho
   * druhého by pruh napsal „Vybráno všech 12 480" a tlačítko pod ním by dál pracovalo
   * s dvaceti zaškrtnutými řádky.
   */
  onSelectAllMatching?: (() => void) | undefined;
  onClear: () => void;
  actions?: React.ReactNode;
}) {
  if (count === 0) return null;

  // Tmavý pruh. V návrhu se hromadný výběr odlišuje od zbytku stránky plochou,
  // ne rámečkem: papír zůstává papírem a výběr je na něm cizí těleso, dokud ho
  // uživatel nezruší. Režim „vybráno vše, co odpovídá filtru" navíc přebarví
  // text do identitní žluté, aby bylo poznat, že jde o víc než jednu stránku.
  return (
    <div
      data-testid="selection-bar"
      className={cn(
        'on-panel flex flex-wrap items-center gap-[var(--spacing-inline)]',
        'rounded-[var(--radius-surface)] bg-panel px-[var(--spacing-row-x)] py-3',
        'font-mono text-meta',
        mode === 'allMatchingFilter' ? 'text-primary' : 'text-panel-foreground',
      )}
    >
      {mode === 'allMatchingFilter' ? (
        <span>{labels.selectedAllMatching(count)}</span>
      ) : (
        <>
          <span>{labels.selectedOnPage(count)}</span>
          {onSelectAllMatching === undefined ? null : (
            <Button
              variant="link"
              onClick={onSelectAllMatching}
              className="text-panel-soft hover:text-panel-foreground"
            >
              {labels.selectAllMatching(total)}
            </Button>
          )}
        </>
      )}
      {actions}
      {/*
       * ZRUŠIT VÝBĚR STOJÍ AŽ ZA AKCEMI, A V OBOU REŽIMECH STEJNĚ.
       *
       * Dvě změny naráz, obě z provozu. Za prvé v režimu „vybráno na stránce" tu žádné
       * zrušení nebylo vůbec („ta operace proběhne, ale tohle tam zůstane viset a nejde
       * se toho zbavit"), takže jedinou cestou ven bylo odškrtat řádky zpátky. Za druhé
       * stálo hned za textem, tedy před akcemi, a patří na konec řady.
       *
       * Že je až za `actions`, není kosmetika: akce dostává pruh zvenčí jako jeden slot,
       * takže „za poslední tlačítko" jde zařídit jedině tímhle pořadím. Pořadí v DOM se
       * shoduje s pořadím na obrazovce, takže totéž platí i pro průchod klávesnicí.
       *
       * TICHÝ ODKAZ VEDLE ČERVENÉHO MAZÁNÍ je schválně. Zrušení výběru je vratné a nic
       * nemaže; kdyby mělo tvar tlačítka, stálo by na tmavém pruhu vedle jediné nevratné
       * akce jako její dvojče. Rozdíl nese tvar (odkaz proti vyplněnému tlačítku)
       * i barva (tlumená proti červené), ne jen slovo.
       */}
      <Button
        variant="link"
        onClick={onClear}
        className="text-panel-soft hover:text-panel-foreground"
      >
        {labels.clearSelection}
      </Button>
    </div>
  );
}
