'use client';

import { useAnnouncer } from '@mlain/ui/a11y';
import { useTranslations } from 'next-intl';
import { type KeyboardEvent, useCallback } from 'react';
import { useEditorStore } from '../state/use-editor';
import { matchOperation } from './operations';
import { runOperation } from './run-operation';

export function useCanvasKeyboard(options: {
  onFocusProperties: () => void;
  onUndoOffer: () => void;
}) {
  const store = useEditorStore();
  // `useAnnouncer()` vrací objekt se dvěma metodami, ne jednu funkci. Zdvořilá
  // oblast nepřeruší čtení, důrazná ano; odmítnutá operace musí být slyšet hned.
  const { assertive, polite } = useAnnouncer();
  const t = useTranslations('editor');

  return useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const operation = matchOperation(event);
      if (!operation) return;
      event.preventDefault();
      const result = runOperation(store, operation);
      if (result.announce) {
        const say = result.announce.tone === 'assertive' ? assertive : polite;
        say(
          t(
            result.announce.key,
            mapParams((key) => t(key), result.announce.params),
          ),
        );
      }
      if (result.focusProperties) options.onFocusProperties();
      if (result.undo) options.onUndoOffer();
    },
    [assertive, options, polite, store, t],
  );
}

/** Popisek bloku je překladový klíč, takže se přeloží dřív, než se vloží do věty. */
function mapParams(
  t: (key: string) => string,
  params?: Record<string, string | number>,
): Record<string, string | number> {
  if (!params) return {};
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = typeof value === 'string' && value.startsWith('block.') ? t(value) : value;
  }
  return out;
}
