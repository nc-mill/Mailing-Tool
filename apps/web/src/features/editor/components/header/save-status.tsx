'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useEditorState } from '../../state/use-editor';

/** Stav ukládání patří do hlavičky. Toast by se objevoval každé dvě sekundy (část 6, 8.5.1). */
export function SaveStatus() {
  const t = useTranslations('editor');
  const format = useFormatter();
  const status = useEditorState((state) => state.status);
  const savedAt = useEditorState((state) => state.savedAt);
  const isDirty = useEditorState((state) => state.isDirty);

  const text =
    status === 'saving'
      ? t('header.saving')
      : status === 'invalid'
        ? t('header.saveInvalid')
        : status === 'error'
          ? t('header.saveFailed')
          : status === 'conflict'
            ? t('state.conflictTitle')
            : isDirty
              ? t('header.unsaved')
              : savedAt
                ? t('header.saved', {
                    time: format.dateTime(new Date(savedAt), { timeStyle: 'short' }),
                  })
                : '';

  return (
    <p data-testid="save-status" aria-live="polite" className="text-xs text-text-muted">
      {text}
    </p>
  );
}
