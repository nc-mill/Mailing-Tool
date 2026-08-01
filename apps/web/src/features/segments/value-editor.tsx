'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

/** Do výčtu se vejde nejvýš tisíc položek, viz 4.11.2 části 2. */
export const LIST_LIMIT = 1000;

/**
 * Vstup hodnoty podle tvaru operátoru. Vložení delšího seznamu se NEODMÍTNE
 * tiše: vezme se prvních tisíc a řekne se, kolik jich spadlo pod stůl. Tichý
 * ořez by znamenal segment, který vypadá správně a chybí mu čtvrtina hodnot.
 */
export function ValueEditor({
  operator,
  value,
  onChange,
}: {
  operator: string;
  value: string[] | string | number | null;
  onChange: (next: string[] | string | number | null) => void;
}) {
  const t = useTranslations('segments');
  const [dropped, setDropped] = useState(0);
  const isList = ['in', 'not_in', 'has_any', 'has_all', 'has_none'].includes(operator);

  if (!isList) {
    return (
      <label>
        {t('builder.valueLabel')}
        <input
          value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    );
  }

  const items = Array.isArray(value) ? value : [];

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="value-list">{t('builder.valueLabel')}</label>
      <textarea
        id="value-list"
        value={items.join('\n')}
        onChange={(event) => {
          const next = event.target.value
            .split(/[\n,;]/)
            .map((item) => item.trim())
            .filter((item) => item !== '');
          if (next.length > LIST_LIMIT) {
            setDropped(next.length - LIST_LIMIT);
            onChange(next.slice(0, LIST_LIMIT));
            return;
          }
          setDropped(0);
          onChange(next);
        }}
        onPaste={(event) => {
          const text = event.clipboardData.getData('text');
          const next = text
            .split(/[\n,;]/)
            .map((item) => item.trim())
            .filter((item) => item !== '');
          if (next.length > LIST_LIMIT) {
            event.preventDefault();
            setDropped(next.length - LIST_LIMIT);
            onChange(next.slice(0, LIST_LIMIT));
          }
        }}
      />
      {dropped > 0 ? (
        <p role="alert">{t('limits.listTooLong', { limit: LIST_LIMIT, dropped })}</p>
      ) : null}
    </div>
  );
}
