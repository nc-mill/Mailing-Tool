'use client';

import { Input } from '@mlain/ui/components/input';
import { useTranslations } from 'next-intl';
import { THEME_GROUPS } from '../../descriptors/theme';
import type { Theme } from '../../model/document-types';
import { useEditorState, useEditorStore } from '../../state/use-editor';
import { PropField } from './prop-field';

const getPath = (source: Record<string, unknown>, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], source);

const setPath = (
  source: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> => {
  const [head, ...rest] = path.split('.');
  if (!head) return source;
  if (rest.length === 0) return { ...source, [head]: value };
  return {
    ...source,
    [head]: setPath((source[head] as Record<string, unknown>) ?? {}, rest.join('.'), value),
  };
};

export function ThemePanel() {
  const t = useTranslations('editor');
  const store = useEditorStore();
  const document = useEditorState((state) => state.document);

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold">{t('theme.title')}</h2>
      <label className="block text-xs">
        {t('meta.previewText')}
        <Input
          value={String(document.meta.previewText ?? '')}
          maxLength={150}
          onChange={(event) => store.patchMeta({ previewText: event.target.value })}
        />
      </label>
      {THEME_GROUPS.map((group) => (
        <fieldset key={group.label} className="space-y-3">
          <legend className="text-xs uppercase text-text-muted">{t(group.label)}</legend>
          {group.props.map((descriptor) => (
            <PropField
              key={descriptor.key}
              descriptor={descriptor}
              block={{ id: '$theme', type: '$theme', props: {} }}
              canWriteHtml={false}
              fieldCatalog={{ fields: [], version: 'theme' }}
              ports={null}
              value={getPath(document.theme as unknown as Record<string, unknown>, descriptor.key)}
              onChange={(next) =>
                store.patchTheme(
                  setPath(
                    document.theme as unknown as Record<string, unknown>,
                    descriptor.key,
                    next,
                  ) as unknown as Partial<Theme>,
                )
              }
            />
          ))}
        </fieldset>
      ))}
    </div>
  );
}
