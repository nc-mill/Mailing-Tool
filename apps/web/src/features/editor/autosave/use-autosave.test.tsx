import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorDocument } from '../model/document-types';
import { createFakePorts } from '../ports/fake-ports';
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
