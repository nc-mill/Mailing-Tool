'use client';

import { Dialog, DialogBody, DialogTitle } from '../../components/dialog';
import { SHORTCUTS } from './shortcut-map';

/**
 * Přehled zkratek. Dostupný přes `?` **i z nabídky uživatele**,
 * protože zkratka na zobrazení zkratek je vtip, ne funkce.
 */
export function ShortcutsHelp({
  open,
  onOpenChange,
  title,
  translate,
  thenLabel,
  isMac,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  translate: (key: string) => string;
  /** Slovo mezi klávesami sekvence, například „pak". */
  thenLabel: string;
  isMac: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle>{title}</DialogTitle>
      <DialogBody>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.id} className="contents">
              <dt className="flex items-center gap-1">
                {shortcut.modifier ? (
                  <kbd className="rounded border border-border bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
                    {shortcut.modifier === 'mod' ? (isMac ? 'Cmd' : 'Ctrl') : 'Alt'}
                  </kbd>
                ) : null}
                {shortcut.keys.map((key, index) => (
                  <span key={key} className="flex items-center gap-1">
                    {index > 0 ? (
                      <span className="text-xs text-text-muted">{thenLabel}</span>
                    ) : null}
                    <kbd className="rounded border border-border bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
                      {key === ' ' ? 'Space' : key}
                    </kbd>
                  </span>
                ))}
              </dt>
              <dd className="text-sm text-text">{translate(shortcut.descriptionKey)}</dd>
            </div>
          ))}
        </dl>
      </DialogBody>
    </Dialog>
  );
}
