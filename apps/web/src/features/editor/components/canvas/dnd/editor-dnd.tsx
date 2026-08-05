'use client';

import type { ReactNode } from 'react';
import { useEditorState, useEditorStore } from '../../../state/use-editor';
import { acceptsDrop } from './accepts';
import { DndCanvas } from './dnd-canvas';

/**
 * Vrstva přetahování kolem CELÉHO editoru, ne jen kolem plátna.
 *
 * Musí obalit i paletu: blok se táhne z palety na plátno, a `@dnd-kit` spojí
 * vlečený prvek s místem upuštění jen uvnitř téhož `DndContext`. Dokud vrstva
 * seděla uvnitř plátna, nešlo z palety táhnout vůbec nic.
 *
 * Zápisy do dokumentu jdou přes tytéž operace jako klikání (`insertBlock`,
 * `moveBlock`), takže vložení i přesun jsou JEDEN krok historie a `Ctrl+Z` je
 * vrátí najednou.
 */
export function EditorDnd({ children }: { children: ReactNode }) {
  const store = useEditorStore();
  const document = useEditorState((state) => state.document);

  return (
    <DndCanvas
      accepts={(payload, parent) => acceptsDrop(document, payload, parent)}
      onInsert={(payload, place) =>
        store.insertBlock(
          payload.blockType,
          { parent: place.parent, index: place.index },
          payload.preset,
        )
      }
      onMove={(id, target) => store.moveBlock(id, target)}
    >
      {children}
    </DndCanvas>
  );
}
