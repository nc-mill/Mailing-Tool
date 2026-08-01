'use client';

import { Input } from '@mlain/ui/components/input';
import { Switch } from '@mlain/ui/components/switch';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ControlProps } from '../prop-field';

const ALLOWED = ['https:', 'http:', 'mailto:', 'tel:'];
const SYSTEM_TAGS = ['{{ unsubscribe_url }}', '{{ preferences_url }}', '{{ webview_url }}'];

/** Validace schématu (content_link_scheme_forbidden) a zákaz Liquidu v trackovaném odkazu (3.1.5). */
export function validateHref(raw: string): 'ok' | 'scheme' | 'liquid' {
  const value = raw.trim();
  if (value === '' || SYSTEM_TAGS.includes(value)) return 'ok';
  if (value.includes('{{') || value.includes('{%')) return 'liquid';
  try {
    if (!ALLOWED.includes(new URL(value).protocol)) return 'scheme';
  } catch {
    return 'scheme';
  }
  return 'ok';
}

export function LinkControl({ descriptor, value, onChange, id, block, autoFocus }: ControlProps) {
  const t = useTranslations('editor');
  const [draft, setDraft] = useState(String(value ?? ''));
  const [problem, setProblem] = useState<'ok' | 'scheme' | 'liquid'>('ok');
  if (descriptor.kind !== 'link') return <></>;
  const trackableKey = descriptor.trackableKey;

  return (
    <div className="space-y-1">
      <Input
        id={id}
        data-autofocus={autoFocus ? '' : undefined}
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const state = validateHref(next);
          setProblem(state);
          if (state === 'ok') onChange(next);
        }}
      />
      {problem !== 'ok' ? (
        <p role="alert" className="text-xs text-danger-text">
          {problem === 'scheme' ? t('link.schemeForbidden') : t('link.liquidForbidden')}
        </p>
      ) : null}
      {trackableKey ? (
        <label className="flex items-center gap-2 text-xs">
          <Switch
            checked={block.props[trackableKey] !== false}
            onCheckedChange={(checked) => onChange(draft, { [trackableKey]: checked })}
          />
          {t('link.trackable')}
        </label>
      ) : null}
    </div>
  );
}
