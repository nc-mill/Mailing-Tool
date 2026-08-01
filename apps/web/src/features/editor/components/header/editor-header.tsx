'use client';

import { Button } from '@mlain/ui/components/button';
import { useTranslations } from 'next-intl';
import { SaveStatus } from './save-status';

export function EditorHeader(props: {
  mode: 'edit' | 'preview';
  onMode: (mode: 'edit' | 'preview') => void;
  onTestSend: () => void;
  readOnly: boolean;
}) {
  const t = useTranslations('editor');
  return (
    <header className="flex items-center justify-between border-b border-border px-4 py-2">
      <SaveStatus />
      <div className="flex gap-2">
        <Button
          variant="secondary"
          onClick={() => props.onMode(props.mode === 'edit' ? 'preview' : 'edit')}
        >
          {props.mode === 'edit' ? t('header.preview') : t('header.edit')}
        </Button>
        <Button variant="primary" onClick={props.onTestSend}>
          {t('header.testSend')}
        </Button>
      </div>
    </header>
  );
}
