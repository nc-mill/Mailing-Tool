'use client';

import { useCallback, useEffect, useRef } from 'react';
import { AUTOSAVE_DEBOUNCE_MS } from '../config';
import type { EditorDocument } from '../model/document-types';
import type { EditorPorts } from '../ports/types';
import { PortError } from '../ports/types';
import type { EditorStore } from '../state/editor-store';

const RETRY_MS = 5000;

export function useAutosave(input: {
  store: EditorStore;
  ports: EditorPorts;
  templateId: string;
  onConflict?: (document: unknown, designHash: string) => void;
}) {
  const { store, ports, templateId, onConflict } = input;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef(false);
  /**
   * Dokument, který server odmítl jako neplatný. Podruhé se neposílá.
   *
   * Porovnává se REFERENCÍ, ne obsahem: operace nad dokumentem jsou neměnné,
   * takže každá úprava dá nový objekt a stará reference se sama zneplatní.
   */
  const rejected = useRef<EditorDocument | null>(null);

  const persist = useCallback(async () => {
    const state = store.getState();
    if (!state.isDirty || running.current) return;
    /*
     * TOHLE JE POJISTKA PROTI SMYČCE, ne optimalizace.
     *
     * Odběr níž plánuje uložení při KAŽDÉ změně stavu, a `store.setStatus`
     * je taky změna stavu. Neúspěšné uložení tedy samo naplánovalo další
     * pokus, ten zase selhal, a tak pořád dokola, jednou za 1,5 vteřiny.
     * V provozu stačilo přidat blok obrázku (nový blok má `assetId: ""`,
     * schéma přitom chce formát `uuid`) a editor od té chvíle mlel PATCH
     * požadavky, dokud uživatel nezavřel stránku.
     */
    if (state.document === rejected.current) return;
    running.current = true;
    store.setStatus('saving');
    try {
      const result = await ports.save({
        templateId,
        document: state.document,
        ifDesignHash: state.designHash,
      });
      if (result.ok) {
        rejected.current = null;
        store.markSaved(result.designHash, Date.parse(result.updatedAt) || Date.now());
      } else {
        store.setStatus('conflict');
        onConflict?.(result.document, result.designHash);
      }
    } catch (error) {
      /*
       * Opakuje se výpadek spojení, NIKDY odmítnutý obsah.
       *
       * Server vrací 422 `template_document_invalid`, když dokument neprojde
       * schématem. Poslat totéž tělo znovu nemůže dopadnout jinak. Stav se
       * proto liší od chyby spojení: uživatel má opravit nález, ne čekat.
       */
      if (error instanceof PortError && error.status === 422) {
        rejected.current = state.document;
        store.setStatus('invalid');
        return;
      }
      store.setStatus('error');
      timer.current = setTimeout(() => {
        void persist();
      }, RETRY_MS);
    } finally {
      running.current = false;
    }
  }, [onConflict, ports, store, templateId]);

  useEffect(
    () =>
      store.subscribe(() => {
        if (!store.getState().isDirty) return;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          void persist();
        }, AUTOSAVE_DEBOUNCE_MS);
      }),
    [persist, store],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    await persist();
  }, [persist]);

  return { flush };
}
