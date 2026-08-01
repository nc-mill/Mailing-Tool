'use client';

import { useCallback, useState } from 'react';

const TTL_MS = 24 * 60 * 60 * 1000;

type Stored<T> = { savedAt: number; data: T };

function key(wizardId: string): string {
  return `mlain.wizard.${wizardId}`;
}

/**
 * Rozdělaný průvodce se drží 24 hodin (tvrdý požadavek K3).
 * Po návratu se nabídne pokračování, po vypršení se tiše zahodí.
 */
export function useWizardDraft<T>({ wizardId }: { wizardId: string }) {
  const [draft, setDraft] = useState<T | null>(() => {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(key(wizardId));
    if (raw === null) return null;
    try {
      const stored = JSON.parse(raw) as Stored<T>;
      if (Date.now() - stored.savedAt > TTL_MS) {
        window.localStorage.removeItem(key(wizardId));
        return null;
      }
      return stored.data;
    } catch {
      window.localStorage.removeItem(key(wizardId));
      return null;
    }
  });

  const [savedAt, setSavedAt] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(key(wizardId));
    if (raw === null) return null;
    try {
      return (JSON.parse(raw) as Stored<T>).savedAt;
    } catch {
      return null;
    }
  });

  const save = useCallback(
    (data: T) => {
      const now = Date.now();
      window.localStorage.setItem(key(wizardId), JSON.stringify({ savedAt: now, data }));
      setDraft(data);
      setSavedAt(now);
    },
    [wizardId],
  );

  const discard = useCallback(() => {
    window.localStorage.removeItem(key(wizardId));
    setDraft(null);
    setSavedAt(null);
  }, [wizardId]);

  return {
    draft,
    save,
    discard,
    expiresInMs: savedAt === null ? null : Math.max(0, savedAt + TTL_MS - Date.now()),
  };
}
