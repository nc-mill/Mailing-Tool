'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({
  children,
  initialPreference = 'system',
  onPreferenceChange,
}: {
  children: React.ReactNode;
  /** Hodnota z profilu uživatele. Ukládání do profilu vlastní plán nastavení. */
  initialPreference?: ThemePreference;
  onPreferenceChange?: (next: ThemePreference) => void;
}) {
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const handle = () => setSystem(query.matches ? 'dark' : 'light');
    handle();
    query.addEventListener('change', handle);
    return () => query.removeEventListener('change', handle);
  }, []);

  const resolved: ResolvedTheme = preference === 'system' ? system : preference;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      setPreferenceState(next);
      onPreferenceChange?.(next);
    },
    [onPreferenceChange],
  );

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme se smí volat jen uvnitř ThemeProvider.');
  }
  return value;
}
