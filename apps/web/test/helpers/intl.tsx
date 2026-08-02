import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';

const MESSAGES_DIR = path.resolve(import.meta.dirname, '../../../../packages/i18n/messages');

/**
 * Zprávy SKUTEČNÉHO katalogu, ne vymyšlené.
 *
 * Test, který si popisky napíše sám, projde i tehdy, když se překlad rozejde
 * s tím, co komponenta vykresluje, a to je přesně ten rozchod, kvůli kterému
 * konformanční testy existují.
 */
export function messages(locale: 'cs' | 'en', ...namespaces: string[]): Record<string, unknown> {
  const tree: Record<string, unknown> = {};
  for (const namespace of namespaces) {
    tree[namespace] = JSON.parse(
      readFileSync(path.join(MESSAGES_DIR, locale, `${namespace}.json`), 'utf8'),
    ) as unknown;
  }
  return tree;
}

/** Překladač nad katalogem pro popisky, které se předávají komponentám P05. */
export function catalogTranslate(locale: 'cs' | 'en', namespace: string) {
  const catalog = messages(locale, namespace)[namespace] as Record<string, unknown>;
  return (key: string, values: Record<string, string | number> = {}): string => {
    const raw = key
      .split('.')
      .reduce<unknown>(
        (acc, part) => (acc as Record<string, unknown> | undefined)?.[part],
        catalog,
      );
    if (typeof raw !== 'string') return key;
    return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in values ? String(values[name]) : match,
    );
  };
}

export function renderIntl(
  ui: ReactElement,
  opts: { locale?: 'cs' | 'en'; namespaces?: string[] } & RenderOptions = {},
): RenderResult {
  const { locale = 'cs', namespaces = ['import', 'segments', 'common'], ...rest } = opts;
  return render(ui, {
    wrapper: ({ children }) => (
      <NextIntlClientProvider locale={locale} messages={messages(locale, ...namespaces)}>
        {children}
      </NextIntlClientProvider>
    ),
    ...rest,
  });
}
