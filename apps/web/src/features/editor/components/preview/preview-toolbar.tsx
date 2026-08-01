'use client';

import { Switch } from '@mlain/ui/components/switch';
import { useTranslations } from 'next-intl';

export type PreviewMode = 'desktop' | 'mobile' | 'text' | 'source';

const MODES: PreviewMode[] = ['desktop', 'mobile', 'text', 'source'];

export function PreviewToolbar(props: {
  mode: PreviewMode;
  onMode: (mode: PreviewMode) => void;
  dark: boolean;
  onDark: (dark: boolean) => void;
}) {
  const t = useTranslations('editor');
  return (
    <div className="flex items-center justify-between border-b border-border p-2">
      <div role="radiogroup" aria-label={t('preview.modes')} className="flex gap-1">
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={props.mode === mode}
            className="rounded px-2 py-1 text-sm aria-checked:bg-surface-muted"
            onClick={() => props.onMode(mode)}
          >
            {t(`preview.${mode}`)}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Switch
          aria-label={t('preview.dark')}
          checked={props.dark}
          onCheckedChange={props.onDark}
        />
        {t('preview.dark')}
      </label>
    </div>
  );
}
