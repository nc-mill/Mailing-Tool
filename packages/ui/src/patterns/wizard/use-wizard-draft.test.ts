import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWizardDraft } from './use-wizard-draft';

describe('useWizardDraft', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T10:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('rozdělaný stav se po návratu nabídne', () => {
    const first = renderHook(() => useWizardDraft<{ file: string }>({ wizardId: 'import' }));
    act(() => first.result.current.save({ file: 'kontakty.csv' }));
    first.unmount();

    const second = renderHook(() => useWizardDraft<{ file: string }>({ wizardId: 'import' }));
    expect(second.result.current.draft).toEqual({ file: 'kontakty.csv' });
  });

  it('po 24 hodinách rozdělaný stav zmizí', () => {
    const first = renderHook(() => useWizardDraft<{ file: string }>({ wizardId: 'import' }));
    act(() => first.result.current.save({ file: 'kontakty.csv' }));
    first.unmount();

    vi.setSystemTime(new Date('2026-08-01T10:00:01.000Z'));
    const second = renderHook(() => useWizardDraft<{ file: string }>({ wizardId: 'import' }));
    expect(second.result.current.draft).toBeNull();
  });

  it('těsně před vypršením ještě existuje a hlásí zbývající čas', () => {
    const first = renderHook(() => useWizardDraft<{ file: string }>({ wizardId: 'import' }));
    act(() => first.result.current.save({ file: 'kontakty.csv' }));
    first.unmount();

    vi.setSystemTime(new Date('2026-08-01T09:00:00.000Z'));
    const second = renderHook(() => useWizardDraft<{ file: string }>({ wizardId: 'import' }));
    expect(second.result.current.draft).not.toBeNull();
    expect(second.result.current.expiresInMs).toBeGreaterThan(0);
    expect(second.result.current.expiresInMs).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it('zahození vyčistí úložiště', () => {
    const { result } = renderHook(() => useWizardDraft<{ file: string }>({ wizardId: 'import' }));
    act(() => result.current.save({ file: 'kontakty.csv' }));
    act(() => result.current.discard());
    expect(result.current.draft).toBeNull();
  });
});
