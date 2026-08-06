/**
 * Co se s formulářem dá dělat.
 *
 * JEDNO MÍSTO, stejně jako `campaigns/campaign-state.ts`, `segments/segment-state.ts`
 * a `templates/template-state.ts`. Tabulka se dá zkoušet bez Reactu a bez
 * katalogu překladů; soubor je schválně BEZ `'use client'` a bez komponent.
 */

/** Akce nabízené v řádku seznamu formulářů. Pořadí je pořadím v nabídce. */
export type FormRowAction = 'edit' | 'embed' | 'pause' | 'activate' | 'viewList' | 'delete';

export type FormStateInput = {
  /** Sbírá formulář přihlášení? Rozhoduje mezi „Pozastavit" a „Spustit". */
  active: boolean;
  /**
   * Seznamy, do kterých formulář zapisuje. Prázdné pole znamená, že položka
   * „Zobrazit cílový seznam" nemá kam vést, takže se nenabízí.
   */
  list_ids: string[];
};

/**
 * Které akce dávají u tohohle formuláře smysl.
 *
 * CO NEDÁVÁ SMYSL, SE NENABÍZÍ, ne zašedle. „Pozastavit" a „Spustit" jsou proto
 * dvě různé položky, ne jedna zašedlá: v nabídce vždycky stojí ta, která stav
 * doopravdy změní.
 *
 * „Vložit na web" se nabízí i tomu, kdo formuláře upravovat nesmí. Je to čtení:
 * stránka s kódem k vložení nic nemění a `forms:read` na ni stačí.
 *
 * Prázdné pole znamená, že se nekreslí ani spouštěč nabídky.
 */
export function formRowActions(
  form: FormStateInput,
  permissions: { write: boolean },
): FormRowAction[] {
  const actions: FormRowAction[] = [];
  if (permissions.write) actions.push('edit');
  actions.push('embed');
  if (permissions.write) actions.push(form.active ? 'pause' : 'activate');
  if (form.list_ids.length > 0) actions.push('viewList');
  if (permissions.write) actions.push('delete');
  return actions;
}

/**
 * Kam vede „Zobrazit cílový seznam".
 *
 * BERE SE PRVNÍ SEZNAM, i když jich API pouští víc. Rozhraní jiný než jeden
 * nastavit neumí: zakládací okno posílá `[listId]` a editor pracuje
 * s `form.list_ids[0]` (`form-editor.tsx:138`). Druhá logika by tady slibovala
 * výběr, který se nikde nedá vyrobit.
 */
export function formTargetListHref(basePath: string, listId: string): string {
  return `${basePath}/lists/${listId}`;
}

/** Akce, které se v nabídce oddělují čarou a kreslí červeně. */
export const DESTRUCTIVE_FORM_ACTIONS: readonly FormRowAction[] = ['delete'];
