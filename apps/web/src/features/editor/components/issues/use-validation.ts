'use client';

import { useEffect } from 'react';
import type { FieldCatalog } from '../../model/field-catalog';
import { referencedAssetIds, validateDocumentClient } from '../../model/validate-client';
import type { EditorPorts } from '../../ports/types';
import type { EditorStore } from '../../state/editor-store';

/**
 * Validace běží v prohlížeči, protože musí odpovědět do 20 ms na každý úhoz.
 * Server ji opakuje při uložení, protože klientovi se nevěří (část 3, 3.7.5),
 * a jeho odpověď má přednost: nese kódy, které klient nemá jak zjistit,
 * a hotový `detail` u neznámého kódu (kritérium 76).
 */
export function useValidation(input: {
  store: EditorStore;
  ports: EditorPorts;
  templateId: string;
  fieldCatalog: FieldCatalog;
}) {
  const { fieldCatalog, store } = input;

  useEffect(
    () =>
      store.subscribe(() => {
        const state = store.getState();
        const issues = validateDocumentClient(state.document, fieldCatalog, {
          assetIds: referencedAssetIds(state.document),
        });
        // Porovnání přes JSON je tady levnější než hloubkové: nálezů jsou jednotky
        // a bez něj by každý úhoz vyvolal nové vykreslení pruhu.
        if (JSON.stringify(issues) !== JSON.stringify(state.issues)) store.setIssues(issues);
      }),
    [fieldCatalog, store],
  );

  useEffect(() => {
    let active = true;
    void input.ports
      .validate({ templateId: input.templateId })
      .then((result) => {
        if (!active) return;
        store.setIssues(
          result.findings.map((finding) => ({
            code: finding.code,
            severity: finding.severity,
            message: finding.message,
            ...(finding.pointer ? { pointer: finding.pointer } : {}),
            ...(finding.block_id ? { blockId: finding.block_id } : {}),
            ...(finding.params ? { params: finding.params } : {}),
          })),
        );
      })
      .catch(() => {
        /* stav se nezmění, chyba načtení řeší pruh stavu */
      });
    return () => {
      active = false;
    };
  }, [input.ports, input.templateId, store]);
}
