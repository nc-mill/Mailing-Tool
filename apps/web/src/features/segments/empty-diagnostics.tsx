'use client';

import { Button } from '@mlain/ui/components/button';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { useTranslations } from 'next-intl';

export type Diagnostics = {
  perCondition: { path: number[]; label: string; count: number }[];
  mostRestrictive: { path: number[]; label: string; count: number } | null;
  fieldStats: {
    key: string;
    filled: number;
    total: number;
    topValues: { value: string; count: number }[];
  } | null;
  /** Hodnota, která se od zadané liší jen velikostí písmen. */
  caseSuggestion?: string | null;
};

/**
 * Prázdný výsledek není chyba, je to otázka „proč". Netechnický člověk neumí
 * přečíst logický výraz, ale okamžitě pochopí větu „tahle jedna podmínka
 * vrací nula".
 */
export function EmptyDiagnostics({
  data,
  onUseValue,
  onIncludeEmpty,
}: {
  data: Diagnostics;
  onUseValue?: (value: string) => void;
  onIncludeEmpty?: () => void;
}) {
  const t = useTranslations('segments');
  const others = data.perCondition.filter((item) => item !== data.mostRestrictive);

  return (
    <Card gap="gutter">
      <CardTitle>{t('empty.title')}</CardTitle>

      {data.mostRestrictive ? (
        <section className="grid gap-[var(--spacing-hairline)]">
          <h3 className="text-ui font-semibold text-text">{t('empty.mostRestrictive')}</h3>
          <p className="flex flex-wrap items-baseline gap-[var(--spacing-inline)] text-ui text-text">
            {data.mostRestrictive.label}
            <span className="font-mono text-meta text-text-muted">
              {data.mostRestrictive.count}
            </span>
          </p>
        </section>
      ) : null}

      {others.length > 0 ? (
        <section className="grid gap-[var(--spacing-hairline)]">
          <h3 className="text-ui font-semibold text-text">{t('empty.others')}</h3>
          <ul className="grid gap-1.5">
            {others.map((item) => (
              <li
                key={item.path.join('.')}
                className="flex flex-wrap items-baseline gap-[var(--spacing-inline)] text-ui text-text"
              >
                {item.label}
                <span className="font-mono text-meta text-text-muted">{item.count}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.fieldStats ? (
        <p className="text-sm text-text-muted">
          {t('empty.fieldStats', {
            field: data.fieldStats.key,
            filled: data.fieldStats.filled,
            total: data.fieldStats.total,
            values: data.fieldStats.topValues
              .map((value) => `${value.value} (${value.count})`)
              .join(', '),
          })}
        </p>
      ) : null}

      {data.caseSuggestion ? (
        <div className="flex flex-wrap items-center gap-[var(--spacing-inline)]">
          <p className="text-ui text-text">
            {t('empty.caseSuggestion', { value: data.caseSuggestion })}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onUseValue?.(data.caseSuggestion ?? '')}
          >
            {t('empty.useValue')}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-[var(--spacing-inline)]">
        <p className="text-ui text-text">{t('empty.includeEmpty')}</p>
        <Button variant="secondary" size="sm" onClick={onIncludeEmpty}>
          {t('empty.include')}
        </Button>
      </div>
    </Card>
  );
}
