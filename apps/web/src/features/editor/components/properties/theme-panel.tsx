'use client';

import { CardTitle } from '@mlain/ui/components/card';
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
    <div className="flex flex-col gap-[var(--spacing-stack)]">
      <CardTitle>{t('theme.title')}</CardTitle>
      {/*
        Popisek obaluje pole, takže je s ním svázaný i bez `id`. `Field` by tu
        vazbu udělal přes `htmlFor`, ale tenhle tvar už mají v rukou testy panelu
        a přepisovat je kvůli vzhledu nedává smysl: vzhled je stejný tak jako tak.
      */}
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-text">
        {t('meta.previewText')}
        <Input
          value={String(document.meta.previewText ?? '')}
          maxLength={150}
          onChange={(event) => store.patchMeta({ previewText: event.target.value })}
        />
      </label>
      {THEME_GROUPS.map((group) => (
        <fieldset
          key={group.label}
          className="flex flex-col gap-3 border-t border-border pt-[var(--spacing-stack)]"
        >
          <legend className="meta-caps text-text-muted">{t(group.label)}</legend>
          {group.props.map((descriptor) => (
            <PropField
              key={descriptor.key}
              descriptor={descriptor}
              block={{ id: '$theme', type: '$theme', props: {} }}
              canWriteHtml={false}
              fieldCatalog={{ fields: [], version: 'theme' }}
              ports={null}
              // Panel motivu nemá jediné pole odkazu, takže profil nic
              // neovlivní. `campaign` je tu jako přísnější z dvojice: kdyby
              // sem někdy odkaz přibyl, bude se kontrolovat, ne propouštět.
              templateKind="campaign"
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
