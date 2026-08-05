import { HISTORY_LIMIT } from '../config';
import type {
  EditorDocument,
  EditorIssue,
  Theme,
  VisibilityCondition,
} from '../model/document-types';
import { newBlockId } from '../model/document-types';
import { createBlock } from '../model/factory';
import { moveDelta, moveIn, moveOut, toInsertionTarget } from '../model/moves';
import {
  countBlocks,
  duplicateBlock,
  insertBlock,
  type MoveTarget,
  moveBlock,
  patchProps,
  removeBlock,
  setVisibility,
} from '../model/ops';

/**
 * `invalid` je oddělené od `error` schválně.
 *
 * `error` znamená „nepovedlo se to poslat, zkoušíme znovu" a je to dočasné.
 * `invalid` znamená „server obsah odmítl jako neplatný" a samo to nepřejde:
 * musí zasáhnout uživatel. Dokud byl obojí týž stav, hlásil editor u nového
 * bloku obrázku donekonečna „Nepodařilo se uložit, zkoušíme to znovu",
 * což bylo dvakrát nepravda: nezkoušelo se to znovu smysluplně a chyba
 * nebyla v ukládání, ale v obsahu.
 */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict' | 'invalid';

/** Typ nálezu se tady nedefinuje, bydlí v `model/document-types.ts` (úkol 1). */
export type { EditorIssue };

export type EditorState = {
  document: EditorDocument;
  selectedId: string | null;
  designHash: string;
  savedAt: number | null;
  status: SaveStatus;
  issues: EditorIssue[];
  isDirty: boolean;
  historyDepth: number;
  blockCount: number;
};

type Snapshot = { document: EditorDocument; selectedId: string | null };

export type EditorStore = ReturnType<typeof createEditorStore>;

export function createEditorStore(input: {
  document: EditorDocument;
  designHash: string;
  historyLimit?: number;
  generateId?: () => string;
}) {
  const historyLimit = input.historyLimit ?? HISTORY_LIMIT;
  const generateId = input.generateId ?? newBlockId;
  const listeners = new Set<() => void>();
  let past: Snapshot[] = [];
  let future: Snapshot[] = [];
  let savedDocument = input.document;

  let state: EditorState = {
    document: input.document,
    selectedId: null,
    designHash: input.designHash,
    savedAt: null,
    status: 'idle',
    issues: [],
    isDirty: false,
    historyDepth: 0,
    blockCount: countBlocks(input.document),
  };

  const emit = () => {
    listeners.forEach((listener) => listener());
  };

  const set = (patch: Partial<EditorState>) => {
    const next = { ...state, ...patch };
    next.isDirty = next.document !== savedDocument;
    next.historyDepth = past.length;
    next.blockCount = countBlocks(next.document);
    state = next;
    emit();
  };

  const mutate = (
    change: (
      document: EditorDocument,
    ) => { document: EditorDocument; selectedId?: string | null } | null,
  ) => {
    const result = change(state.document);
    if (!result) return null;
    past = [...past, { document: state.document, selectedId: state.selectedId }].slice(
      -historyLimit,
    );
    future = [];
    set({ document: result.document, selectedId: result.selectedId ?? state.selectedId });
    return result;
  };

  /**
   * Vlastní funkce místo `this.moveBlock` z doslovného kódu plánu. Metoda odkazující
   * na `this` uvnitř objektového literálu by z `ReturnType<typeof createEditorStore>`
   * udělala kruhový typ; chování je totožné.
   */
  const applyMove = (id: string, target: MoveTarget): boolean =>
    mutate((document) => {
      const next = moveBlock(document, id, target);
      return next ? { document: next, selectedId: id } : null;
    }) !== null;

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    select(id: string | null) {
      set({ selectedId: id });
    },

    insertBlock(type: string, target: MoveTarget, preset: Record<string, unknown> = {}) {
      const block = createBlock(type, preset, generateId);
      mutate((document) => ({
        document: insertBlock(document, target.parent, target.index, block),
        selectedId: block.id,
      }));
      return block.id;
    },
    removeBlock(id: string) {
      mutate((document) => {
        const result = removeBlock(document, id);
        return result ? { document: result.doc, selectedId: null } : null;
      });
    },
    duplicateBlock(id: string): string | null {
      let newId: string | null = null;
      mutate((document) => {
        const result = duplicateBlock(document, id, generateId);
        if (!result) return null;
        newId = result.newId;
        return { document: result.doc, selectedId: result.newId };
      });
      return newId;
    },
    moveBlock(id: string, target: MoveTarget) {
      return applyMove(id, target);
    },
    moveByKeyboard(id: string, direction: 'up' | 'down' | 'out' | 'in') {
      const document = state.document;
      const target =
        direction === 'up'
          ? moveDelta(document, id, -1)
          : direction === 'down'
            ? moveDelta(document, id, 1)
            : direction === 'out'
              ? moveOut(document, id)
              : moveIn(document, id);
      if (!target) return false;
      // Přesuny z `model/moves` popisují cílovou pozici, `moveBlock` bere místo
      // vložení před odebráním. Bez převodu by se krok dolů vyrušil sám se sebou.
      return applyMove(id, toInsertionTarget(document, id, target));
    },
    patchProps(id: string, patch: Record<string, unknown>) {
      mutate((document) => ({ document: patchProps(document, id, patch) }));
    },
    setVisibility(id: string, condition: VisibilityCondition | null) {
      mutate((document) => ({ document: setVisibility(document, id, condition) }));
    },
    patchTheme(patch: Partial<Theme>) {
      mutate((document) => ({
        document: { ...document, theme: { ...document.theme, ...patch } },
      }));
    },
    patchMeta(patch: Record<string, unknown>) {
      mutate((document) => ({ document: { ...document, meta: { ...document.meta, ...patch } } }));
    },

    undo() {
      const previous = past[past.length - 1];
      if (!previous) return;
      past = past.slice(0, -1);
      future = [{ document: state.document, selectedId: state.selectedId }, ...future];
      set({ document: previous.document, selectedId: previous.selectedId });
    },
    redo() {
      const next = future[0];
      if (!next) return;
      future = future.slice(1);
      past = [...past, { document: state.document, selectedId: state.selectedId }].slice(
        -historyLimit,
      );
      set({ document: next.document, selectedId: next.selectedId });
    },

    setStatus(status: SaveStatus) {
      set({ status });
    },
    setIssues(issues: EditorIssue[]) {
      set({ issues });
    },
    markSaved(designHash: string, at: number) {
      savedDocument = state.document;
      set({ designHash, savedAt: at, status: 'saved' });
    },
    /**
     * Převzetí přejmenování, které právě proběhlo na serveru.
     *
     * Mění se dokument (`meta.name`) i hash, protože server mění obojí: jméno
     * dokumentu je předmět odesílaného e-mailu, ne kopie jména řádku.
     *
     * HISTORIE ZŮSTÁVÁ. `replaceDocument` by ji zahodila, jenže tady se
     * nevyměňuje obsah, mění se jedna vlastnost, a přijít kvůli přejmenování
     * o možnost vrátit hodinu práce zpět by byla nepříjemná pokuta za překlep
     * v názvu.
     *
     * Volá se AŽ PO `flush()`. Nastavením `savedDocument` na nový dokument
     * zmizí příznak neuložených změn, takže kdyby se volalo nad rozdělanou
     * úpravou, editor by ji prohlásil za uloženou a automatické ukládání by
     * se o ni už nepokusilo.
     */
    applyName(name: string, designHash: string, at: number) {
      const document = { ...state.document, meta: { ...state.document.meta, name } };
      savedDocument = document;
      set({ document, designHash, savedAt: at, status: 'saved' });
    },
    /**
     * Vymění celý dokument a zahodí historii.
     *
     * `saved` říká, jestli nový dokument UŽ JE na serveru:
     * - `true` u převzetí cizí verze při konfliktu, protože ta ze serveru přišla,
     * - `false` (výchozí) u návrhu od AI asistenta, protože ten nikde uložený není.
     *
     * VÝCHOZÍ HODNOTA JE ZÁMĚRNĚ `false`. Dokud se dokument značil jako uložený
     * vždycky, byl po vložení návrhu `isDirty` rovnou `false`, automatické
     * ukládání se nespustilo (`use-autosave.ts` na `isDirty` stojí dvakrát)
     * a hlavička neukázala ani „Neuloženo", protože `status` zůstal `idle`.
     * Uživateli to přišlo tak, že šablonu nejde uložit a chybí tlačítko:
     * ono se opravdu neukládalo nic a nic o tom neřeklo. Po znovunačtení
     * stránky byl celý návrh pryč.
     *
     * Jediný skutečný volající je dnes panel AI asistenta, tedy přesně ten
     * případ, kde „už uloženo" neplatí.
     */
    replaceDocument(
      document: EditorDocument,
      designHash: string,
      options: { saved?: boolean } = {},
    ) {
      past = [];
      future = [];
      if (options.saved === true) savedDocument = document;
      set({ document, designHash, selectedId: null, status: 'idle' });
    },
  };
}
