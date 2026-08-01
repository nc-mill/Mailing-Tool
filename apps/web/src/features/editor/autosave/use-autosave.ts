'use client';

import { useCallback, useEffect, useRef } from 'react';
import { AUTOSAVE_DEBOUNCE_MS } from '../config';
import type { EditorPorts } from '../ports/types';
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

  const persist = useCallback(async () => {
    const state = store.getState();
    if (!state.isDirty || running.current) return;
    running.current = true;
    store.setStatus('saving');
    try {
      const result = await ports.save({
        templateId,
        document: state.document,
        ifDesignHash: state.designHash,
      });
      if (result.ok) {
        store.markSaved(result.designHash, Date.parse(result.updatedAt) || Date.now());
      } else {
        store.setStatus('conflict');
        onConflict?.(result.document, result.designHash);
      }
    } catch {
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
