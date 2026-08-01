import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWizardStep } from './use-wizard-step';

const steps = [{ id: 'upload' }, { id: 'mapping' }, { id: 'preview' }];

describe('useWizardStep', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/w/eshop/contacts/import');
  });

  it('bez parametru začne na prvním kroku a dopíše ho do adresy', () => {
    const { result } = renderHook(() => useWizardStep({ steps }));
    expect(result.current.current).toBe('upload');
    expect(new URLSearchParams(window.location.search).get('step')).toBe('upload');
  });

  it('krok z adresy má přednost, takže odkaz jde poslat kolegovi', () => {
    window.history.replaceState({}, '', '/w/eshop/contacts/import?step=preview');
    const { result } = renderHook(() => useWizardStep({ steps }));
    expect(result.current.current).toBe('preview');
  });

  it('neznámý krok v adrese spadne na první, ne na prázdnou obrazovku', () => {
    window.history.replaceState({}, '', '/w/eshop/contacts/import?step=vymysleny');
    const { result } = renderHook(() => useWizardStep({ steps }));
    expect(result.current.current).toBe('upload');
  });

  it('přechod zapíše krok do adresy a založí položku historie', () => {
    const { result } = renderHook(() => useWizardStep({ steps }));
    act(() => result.current.goToStep('mapping'));
    expect(result.current.current).toBe('mapping');
    expect(new URLSearchParams(window.location.search).get('step')).toBe('mapping');
  });

  it('tlačítko zpět v prohlížeči vrátí krok, ne odchod z průvodce', () => {
    const { result } = renderHook(() => useWizardStep({ steps }));
    act(() => result.current.goToStep('mapping'));
    act(() => {
      window.history.replaceState({}, '', '/w/eshop/contacts/import?step=upload');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.current).toBe('upload');
  });

  it('ostatní parametry v adrese zůstanou, průvodce je nesmaže', () => {
    window.history.replaceState({}, '', '/w/eshop/contacts/import?source=email&step=upload');
    const { result } = renderHook(() => useWizardStep({ steps }));
    act(() => result.current.goToStep('preview'));
    expect(new URLSearchParams(window.location.search).get('source')).toBe('email');
  });
});
