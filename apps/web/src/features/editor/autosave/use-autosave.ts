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
  /**
   * Otisk, na kterém se ukládání rozešlo se serverem, nebo `null`.
   *
   * Konflikt se od odmítnutého dokumentu liší v tom, ČÍM se dá odblokovat.
   * Neplatný dokument spraví uživatel tím, že ho upraví, takže tam stačí
   * porovnávat dokument. Konflikt ale neříká nic o obsahu: server odmítl
   * `If-Match`, protože pracovní kopie v databázi má novější otisk. Další
   * úpravy s tím nehnou, každý pokus posílá tentýž zastaralý otisk a musí
   * dopadnout stejně.
   *
   * Drží se proto otisk, ne dokument. Ukládání mlčí, dokud se otisk ve storu
   * nezmění, což znamená, že editor dostal novou verzi (`replaceDocument`
   * u převzetí cizí verze, `markSaved` po úspěšném uložení). Pak má nový
   * pokus smysl a sám se rozjede.
   */
  const conflictedHash = useRef<string | null>(null);

  const persist = useCallback(async () => {
    const state = store.getState();
    if (!state.isDirty || running.current) return;
    /*
     * PO KONFLIKTU SE MLČÍ, a je to táž pojistka proti smyčce jako u 422.
     *
     * Bez ní se to chovalo takhle (naměřeno v prohlížeči): uložení vrátilo
     * konflikt, `setStatus` změnil stav, odběr níž si z toho naplánoval další
     * pokus, ten vrátil zase konflikt, a tak pořád dokola po 1,5 vteřiny.
     * Čtyři pokusy za pět vteřin a nic to nezastavilo. Uživateli běžela na
     * pozadí smyčka požadavků, které NEMOHLY uspět, a opakování k tomu budilo
     * dojem, že jde o přechodnou chybu; přitom od té chvíle už se neuložilo
     * vůbec nic.
     */
    if (conflictedHash.current === state.designHash) return;
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
        conflictedHash.current = null;
        store.markSaved(result.designHash, Date.parse(result.updatedAt) || Date.now());
      } else {
        conflictedHash.current = state.designHash;
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
        // Věta ze serveru, ne obecné „neplatný dokument": doménové závory
        // v ní posílají celou instrukci, co má autor opravit.
        store.setStatus('invalid', error.detail === '' ? null : error.detail);
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
