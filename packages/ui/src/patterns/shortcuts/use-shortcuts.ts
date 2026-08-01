'use client';

import { useEffect, useRef } from 'react';
import { SHORTCUTS } from './shortcut-map';

const SEQUENCE_TIMEOUT_MS = 1000;

function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

/**
 * Globální posluchač zkratek. Jednopísmenné zkratky se ignorují,
 * když je fokus v textovém poli, jinak by se uživateli při psaní
 * měnila stránka.
 */
export function useShortcuts(handlers: Record<string, () => void>): void {
  const buffer = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function reset() {
      buffer.current = [];
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    }

    function onKeyDown(event: KeyboardEvent) {
      const isTextField = inTextField(event.target);
      const modifier = event.metaKey || event.ctrlKey ? 'mod' : event.altKey ? 'alt' : undefined;

      // Zkratky s modifikátorem se řeší rovnou, sekvence se jich netýká.
      if (modifier) {
        for (const shortcut of SHORTCUTS) {
          if (shortcut.modifier !== modifier) continue;
          if (shortcut.keys.length !== 1) continue;
          if (shortcut.keys[0]?.toLowerCase() !== event.key.toLowerCase()) continue;
          if (isTextField && !shortcut.worksInInput) continue;
          event.preventDefault();
          handlers[shortcut.id]?.();
          reset();
          return;
        }
        return;
      }

      if (isTextField) return;

      buffer.current = [...buffer.current, event.key];
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(reset, SEQUENCE_TIMEOUT_MS);

      for (const shortcut of SHORTCUTS) {
        if (shortcut.modifier) continue;
        const tail = buffer.current.slice(-shortcut.keys.length);
        if (tail.join(' ') === shortcut.keys.join(' ')) {
          event.preventDefault();
          handlers[shortcut.id]?.();
          reset();
          return;
        }
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [handlers]);
}
