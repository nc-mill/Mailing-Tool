'use client';

import { useTranslations } from 'next-intl';
import type { ControlProps } from '../prop-field';

export function CodeControl({
  descriptor,
  value,
  onChange,
  id,
  canWriteHtml,
  autoFocus,
}: ControlProps) {
  const t = useTranslations('editor');
  if (descriptor.kind !== 'code') return <></>;

  if (!canWriteHtml) {
    return (
      <div data-readonly="true" className="space-y-1">
        <pre className="overflow-x-auto rounded-[var(--radius-control)] bg-surface-muted p-2 text-meta">
          {String(value ?? '')}
        </pre>
        <p className="text-meta text-text-muted">{t('block.htmlForbidden')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <textarea
        id={id}
        data-autofocus={autoFocus ? '' : undefined}
        maxLength={descriptor.maxLength}
        rows={8}
        className="w-full rounded-[var(--radius-control)] border border-border bg-surface p-2 font-mono text-meta"
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="text-meta text-text-muted">{t('block.htmlConditionHint')}</p>
    </div>
  );
}
