'use client';

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
    <div className="flex flex-col gap-3">
      <h2>{t('empty.title')}</h2>

      {data.mostRestrictive ? (
        <section>
          <h3>{t('empty.mostRestrictive')}</h3>
          <p>
            {data.mostRestrictive.label} {data.mostRestrictive.count}
          </p>
        </section>
      ) : null}

      {others.length > 0 ? (
        <section>
          <h3>{t('empty.others')}</h3>
          <ul>
            {others.map((item) => (
              <li key={item.path.join('.')}>
                {item.label} {item.count}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.fieldStats ? (
        <p>
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
        <div>
          <p>{t('empty.caseSuggestion', { value: data.caseSuggestion })}</p>
          <button type="button" onClick={() => onUseValue?.(data.caseSuggestion ?? '')}>
            {t('empty.useValue')}
          </button>
        </div>
      ) : null}

      <div>
        <p>{t('empty.includeEmpty')}</p>
        <button type="button" onClick={onIncludeEmpty}>
          {t('empty.include')}
        </button>
      </div>
    </div>
  );
}
