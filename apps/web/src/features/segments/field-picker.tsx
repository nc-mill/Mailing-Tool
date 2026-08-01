'use client';

import { useTranslations } from 'next-intl';

export type CatalogField = {
  id: string;
  labelKey?: string;
  label?: string;
  group: FieldGroup;
  /** Pole, u kterého kompilátor neumí podmínku přeložit na `@>`. */
  unindexed?: boolean;
};

export type FieldGroup =
  | 'contact'
  | 'attribute'
  | 'tag'
  | 'list'
  | 'consent'
  | 'suppression'
  | 'engagement'
  | 'event'
  | 'times'
  | 'segment';

/** Pořadí sekcí je dané specifikací, ne abecedou. */
export const FIELD_GROUPS: FieldGroup[] = [
  'contact',
  'attribute',
  'tag',
  'list',
  'consent',
  'suppression',
  'engagement',
  'event',
  'times',
  'segment',
];

const MAX_ENGAGEMENT = 5;

/**
 * Výběr pole seskupený do deseti sekcí. Neindexované vlastní pole je označené
 * a řekne PROČ je pomalejší; varování se váže na to, jestli kompilátor umí
 * podmínku přeložit na `@>`, ne na sloupec `contact_fields.indexed`, který
 * dnes nikdo neplní (rozhodnutí R19).
 */
export function FieldPicker({
  catalog,
  value,
  usedEngagement = 0,
  onChange,
}: {
  catalog: CatalogField[];
  value?: string;
  usedEngagement?: number;
  onChange: (fieldId: string) => void;
}) {
  const t = useTranslations('segments');
  const engagementFull = usedEngagement >= MAX_ENGAGEMENT;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="field-picker">{t('builder.fieldLabel')}</label>
      <select
        id="field-picker"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      >
        {FIELD_GROUPS.map((group) => {
          const items = catalog.filter((field) => field.group === group);
          if (items.length === 0) return null;
          return (
            <optgroup key={group} label={t(`fieldGroups.${group}`)}>
              {items.map((field) => {
                const disabled = field.group === 'engagement' && engagementFull;
                return (
                  <option
                    key={field.id}
                    value={field.id}
                    aria-disabled={disabled ? 'true' : undefined}
                    disabled={disabled}
                  >
                    {field.label ?? t(field.labelKey ?? `fields.${field.id}`)}
                  </option>
                );
              })}
            </optgroup>
          );
        })}
      </select>

      {catalog.some((field) => field.unindexed === true) ? (
        <p>
          <span role="img" aria-label={t('fields.unindexedBadge')}>
            {'⚠'}
          </span>{' '}
          {t('fields.unindexed')}
        </p>
      ) : null}

      {engagementFull ? <p>{t('limits.tooManyEngagement', { limit: MAX_ENGAGEMENT })}</p> : null}
    </div>
  );
}
