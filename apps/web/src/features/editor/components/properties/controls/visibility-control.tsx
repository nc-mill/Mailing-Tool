'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  OPERATORS_BY_TYPE,
  pickLabel,
  toMergePath,
  usableFields,
  type VisibilityOperator,
} from '../../../model/field-catalog';
import type { ControlProps } from '../prop-field';

type Condition = { field: string; op: string };

/** Uživatel vybere pole a operátor. Žádný Liquid nepíše a žádný nevidí (část 3, 3.1.10). */
export function VisibilityControl({ descriptor, value, onChange, id, fieldCatalog }: ControlProps) {
  const t = useTranslations('editor');
  const locale = useLocale();
  /**
   * ODCHYLKA OD PLÁNU: vlastní stav vedle propu. Nabídka operátorů se musí objevit
   * hned po výběru pole, tedy i v okamžiku, kdy volající novou hodnotu ještě
   * nepropsal zpět. Prop má vždycky přednost, takže se dvě pravdy nerozejdou.
   */
  const [local, setLocal] = useState<Condition | null>(null);
  if (descriptor.kind !== 'visibility') return <></>;
  const condition = (value as Condition | null) ?? local;
  const fields = usableFields(fieldCatalog);
  const selected = fields.find((field) => toMergePath(field.path) === condition?.field);
  const operators: VisibilityOperator[] = selected ? OPERATORS_BY_TYPE[selected.type] : [];

  const emit = (next: Condition | null) => {
    setLocal(next);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <label className="block text-xs">
        {t('visibility.field')}
        <select
          id={id}
          aria-label={t('visibility.field')}
          className="mt-1 h-9 w-full rounded-[var(--radius-control)] border border-border bg-surface px-2 text-sm"
          value={condition?.field ?? ''}
          onChange={(event) => {
            const path = event.target.value;
            if (!path) {
              emit(null);
              return;
            }
            const field = fields.find((entry) => toMergePath(entry.path) === path);
            if (!field) return;
            emit({ field: path, op: OPERATORS_BY_TYPE[field.type][0] ?? 'present' });
          }}
        >
          <option value="">{t('visibility.always')}</option>
          {fields.map((field) => (
            <option key={field.path} value={toMergePath(field.path)}>
              {pickLabel(field.label, locale)}
            </option>
          ))}
        </select>
      </label>
      {condition ? (
        <label className="block text-xs">
          {t('visibility.operator')}
          <select
            aria-label={t('visibility.operator')}
            className="mt-1 h-9 w-full rounded-[var(--radius-control)] border border-border bg-surface px-2 text-sm"
            value={condition.op}
            onChange={(event) => emit({ ...condition, op: event.target.value })}
          >
            {operators.map((operator) => (
              <option key={operator} value={operator}>
                {t(`visibility.op.${operator}`)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
