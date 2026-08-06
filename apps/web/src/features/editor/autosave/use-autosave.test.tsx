import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorDocument } from '../model/document-types';
import { createFakePorts } from '../ports/fake-ports';
import { PortError } from '../ports/types';
import { createEditorStore } from '../state/editor-store';
import { useAutosave } from './use-autosave';

const doc = (): EditorDocument =>
  ({
    schemaVersion: 1,
    meta: { name: 'T', previewText: '', language: 'cs' },
    theme: {},
    blocks: [
      {
        id: 'b_s1',
        type: 'section',
        props: {},
        children: [{ id: 'b_h1', type: 'heading', props: {} }],
      },
    ],
  }) as unknown as EditorDocument;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useAutosave', () => {
  it('uloží až po prodlevě a nejvýš jednou za sérii úprav', async () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    const ports = createFakePorts();
    const save = vi.spyOn(ports, 'save');
    renderHook(() => useAutosave({ store, ports, templateId: 't1' }));

    act(() => {
      store.patchProps('b_h1', { level: 1 });
    });
    act(() => {
      store.patchProps('b_h1', { level: 3 });
    });
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(save).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(store.getState().status).toBe('saved'));
    expect(store.getState().isDirty).toBe(false);
  });

  it('při konfliktu přepne stav na conflict a dokument nepřepíše', async () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    const ports = createFakePorts({
      save: async () => ({ ok: false, conflict: true, document: doc(), designHash: 'h9' }),
    });
    renderHook(() => useAutosave({ store, ports, templateId: 't1' }));
    act(() => {
      store.patchProps('b_h1', { level: 1 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    await waitFor(() => expect(store.getState().status).toBe('conflict'));
    expect(store.getState().document.blocks[0]!.children![0]!.props.level).toBe(1);
  });

  /**
   * Regrese na druhou smyčku, naměřenou v prohlížeči: po konfliktu jel editor
   * dokola, čtyři pokusy za pět vteřin, a nic ho nezastavilo. Vadilo to dvakrát.
   * Uživateli běžela na pozadí smyčka požadavků, které nemohly uspět, a
   * opakování k tomu vypadalo jako přechodná chyba, kdežto ve skutečnosti se od
   * té chvíle neuložilo vůbec nic.
   *
   * Konflikt se nedá spravit úpravou dokumentu, na rozdíl od odmítnutého
   * obsahu: server odmítá zastaralý otisk, ne obsah. Další psaní proto nesmí
   * vyvolat nový pokus.
   */
  it('po konfliktu se další pokus nepošle, ani když uživatel píše dál', async () => {
    let calls = 0;
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    const ports = createFakePorts({
      save: async () => {
        calls += 1;
        return { ok: false, conflict: true, document: doc(), designHash: 'h9' };
      },
    });
    renderHook(() => useAutosave({ store, ports, templateId: 't1' }));

    act(() => {
      store.patchProps('b_h1', { level: 1 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    await waitFor(() => expect(store.getState().status).toBe('conflict'));
    expect(calls).toBe(1);

    // Dvacet vteřin ticha. Tady dřív přibývalo po pokusu každou 1,5 vteřiny.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(calls).toBe(1);

    // Ani psaní na tom nic nemění: otisk je pořád tentýž zastaralý.
    act(() => {
      store.patchProps('b_h1', { level: 2 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(calls).toBe(1);
  });

  /**
   * Druhá strana téhož pravidla: zastavení nesmí být doživotní. Jakmile editor
   * dostane novou verzi, má se ukládání samo rozjet, jinak by se uživatel po
   * převzetí cizí verze nedostal ke slovu jinak než znovunačtením stránky.
   */
  it('po převzetí nové verze se ukládání zase rozjede', async () => {
    let calls = 0;
    let conflict = true;
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    const ports = createFakePorts({
      save: async () => {
        calls += 1;
        return conflict
          ? { ok: false as const, conflict: true as const, document: doc(), designHash: 'h9' }
          : { ok: true as const, designHash: 'h10', updatedAt: '2026-08-06T10:00:00Z' };
      },
    });
    renderHook(() => useAutosave({ store, ports, templateId: 't1' }));

    act(() => {
      store.patchProps('b_h1', { level: 1 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    await waitFor(() => expect(store.getState().status).toBe('conflict'));

    conflict = false;
    act(() => {
      store.replaceDocument(doc(), 'h9', { saved: true });
    });
    act(() => {
      store.patchProps('b_h1', { level: 3 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    await waitFor(() => expect(store.getState().status).toBe('saved'));
    expect(calls).toBe(2);
  });

  it('po chybě to zkusí znovu a stav je error, ne ticho', async () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    let calls = 0;
    const ports = createFakePorts({
      save: async () => {
        calls += 1;
        if (calls === 1) throw new Error('offline');
        return { ok: true, designHash: 'h2', updatedAt: '2026-07-31T12:00:00Z' };
      },
    });
    renderHook(() => useAutosave({ store, ports, templateId: 't1' }));
    act(() => {
      store.patchProps('b_h1', { level: 1 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    await waitFor(() => expect(store.getState().status).toBe('error'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await waitFor(() => expect(store.getState().status).toBe('saved'));
    expect(calls).toBe(2);
  });

  /**
   * VĚTA ZE SERVERU SE MUSÍ DOSTAT AŽ NA OBRAZOVKU.
   *
   * Doménové závory seznamu (potvrzovací e-mail bez odkazu na potvrzení,
   * odhlašovací odkaz v uvítacím a rozloučovacím e-mailu) vracejí 422 s celou
   * instrukcí, co má autor opravit. Do téhle chvíle se z ní nedostalo nic:
   * hlavička ukázala obecné „dokument je neplatný" a člověk neměl podle čeho
   * dokument spravit.
   */
  it('u odmítnutého uložení si zapamatuje větu ze serveru', async () => {
    const veta =
      'Tenhle e-mail je připojený jako potvrzovací, takže musí obsahovat odkaz na potvrzení.';
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    const ports = createFakePorts({
      save: async () => {
        throw new PortError('validation_failed', veta, undefined, 422);
      },
    });
    renderHook(() => useAutosave({ store, ports, templateId: 't1' }));

    act(() => {
      store.patchProps('b_h1', { level: 1 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });

    await waitFor(() => expect(store.getState().status).toBe('invalid'));
    expect(store.getState().saveIssue).toBe(veta);
  });

  it('odmítnutý dokument neposílá dokola a řekne, že jde o obsah, ne o spojení', async () => {
    /*
     * Regrese na smyčku z provozu: stačilo přidat blok obrázku (nový blok má
     * `assetId: ""`, schéma chce `uuid`) a editor mlel PATCH požadavky každou
     * 1,5 vteřiny, dokud uživatel stránku nezavřel. Smyčku dělal odběr storu:
     * `setStatus` je změna stavu, takže si neúspěšné uložení samo naplánovalo
     * další pokus.
     */
    let calls = 0;
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    const ports = createFakePorts({
      save: async () => {
        calls += 1;
        throw new PortError('template_document_invalid', 'neplatný dokument', undefined, 422);
      },
    });
    renderHook(() => useAutosave({ store, ports, templateId: 't1' }));

    act(() => {
      store.patchProps('b_h1', { level: 1 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    await waitFor(() => expect(store.getState().status).toBe('invalid'));
    expect(calls).toBe(1);

    // Dvacet vteřin ticha: bez opravy se nesmí stát vůbec nic.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(calls).toBe(1);

    // Jakmile uživatel dokument změní, zkusí se to znovu. Sám od sebe ne.
    act(() => {
      store.patchProps('b_h1', { level: 2 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    await waitFor(() => expect(calls).toBe(2));
  });

  it('flush uloží okamžitě, používá ho náhled a testovací odeslání', async () => {
    const store = createEditorStore({ document: doc(), designHash: 'h1' });
    const ports = createFakePorts();
    const save = vi.spyOn(ports, 'save');
    const { result } = renderHook(() => useAutosave({ store, ports, templateId: 't1' }));
    act(() => {
      store.patchProps('b_h1', { level: 1 });
    });
    await act(async () => {
      await result.current.flush();
    });
    expect(save).toHaveBeenCalledTimes(1);
  });
});
