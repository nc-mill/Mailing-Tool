'use client';

import { Input } from '@mlain/ui/components/input';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  type FieldCatalog,
  toCatalogPath,
  toMergePath,
  usableFields,
} from '../../model/field-catalog';
import { GREETING_PATH, greetingGuidanceFor } from './greeting-guidance';

/**
 * Pět celých formátů z kontraktu. Zadávají se výběrem, ne psaním (část 3, 3.7.2).
 *
 * ODCHYLKA OD PLÁNU: formát není zároveň překladovým klíčem. `next-intl` zakazuje
 * tečku uvnitř klíče, protože jí vyjadřuje vnoření, a `%d.%m.%Y` by shodilo
 * načtení katalogu chybou `INVALID_KEY` na **každé** stránce aplikace, ne jen
 * v editoru. Hodnota ve výběru zůstává formát, klíč popisku je slug.
 */
const DATE_FORMATS = [
  { format: '%d.%m.%Y', labelKey: 'dayMonthYearPadded' },
  { format: '%-d.%-m.%Y', labelKey: 'dayMonthYear' },
  { format: '%Y-%m-%d', labelKey: 'isoDate' },
  { format: '%d.%m.%Y %H:%M', labelKey: 'dayMonthYearTime' },
  { format: '%H:%M', labelKey: 'time' },
];
const FORBIDDEN = /["'{}<>]/;

export function TokenInspector(props: {
  attrs: { expr: string; fallback: string | null; dateFormat: string | null };
  fieldCatalog: FieldCatalog;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const t = useTranslations('editor');
  const [invalid, setInvalid] = useState(false);
  const entry = props.fieldCatalog.fields.find(
    (field) => field.path === toCatalogPath(props.attrs.expr),
  );
  const isDate = entry?.type === 'date' || entry?.type === 'datetime';
  const isLongText = entry?.path.startsWith('attr.') && entry.type === 'string';

  // Která ze tří rolí to je: hotové oslovení, surovina jména, nebo běžné pole.
  const guidance = greetingGuidanceFor(props.attrs.expr);

  /**
   * Řeší projekt oslovení a 5. pád? Pozná se z KATALOGU, ne z další propy: pole
   * `contact.greeting` je při vypnutém oslovení označené `deleted` a `usableFields`
   * ho odfiltruje.
   *
   * Varování u suroviny jména na to spoléhá, protože končí větou „Na oslovení
   * použijte pole Oslovení." Kdyby zůstalo, posílalo by uživatele za polem, které
   * v nabídce není. Nápověda u samotného `contact.greeting` naopak zůstává vždy:
   * vysvětluje značku, kterou uživatel PRÁVĚ MÁ v dokumentu, a ta se dál renderuje.
   */
  const greetingOffered = usableFields(props.fieldCatalog).some(
    (field) => toMergePath(field.path) === GREETING_PATH,
  );

  return (
    <div className="space-y-2">
      <p className="text-xs text-text-muted">{t('token.title')}</p>
      {/* Vysvětlení role značky. U suroviny jména je to varování, ne popisek:
          přesně z ní si uživatel skládal „Dobrý den, " + jméno a dostával 1. pád
          u kontaktů v jazyce bez vokativu a visící čárku u kontaktů bez jména. */}
      {guidance === 'greeting' ? (
        <p data-testid="token-greeting-hint" className="text-xs text-text-muted">
          {t('token.greetingHint')}
        </p>
      ) : null}
      {guidance === 'nameFragment' && greetingOffered ? (
        <p data-testid="token-fragment-warning" className="text-xs text-warning-text">
          {t('token.fragmentWarning')}
        </p>
      ) : null}
      <label className="block text-xs">
        {t('token.fallbackLabel')}
        <Input
          aria-label={t('token.fallbackLabel')}
          maxLength={100}
          defaultValue={props.attrs.fallback ?? ''}
          onChange={(event) => {
            const next = event.target.value;
            if (FORBIDDEN.test(next)) {
              setInvalid(true);
              return;
            }
            setInvalid(false);
            props.onChange({ fallback: next === '' ? null : next });
          }}
        />
      </label>
      {invalid ? (
        <p role="alert" className="text-xs text-danger-text">
          {t('token.fallbackInvalid')}
        </p>
      ) : null}
      <p className="text-xs text-text-muted">{t('token.fallbackHint')}</p>
      {isDate ? (
        <label className="block text-xs">
          {t('token.dateFormatLabel')}
          <select
            aria-label={t('token.dateFormatLabel')}
            className="mt-1 h-9 w-full rounded-[var(--radius-control)] border border-border bg-surface px-2 text-sm"
            defaultValue={props.attrs.dateFormat ?? ''}
            onChange={(event) => props.onChange({ dateFormat: event.target.value || null })}
          >
            <option value="">{t('token.dateFormatDefault')}</option>
            {DATE_FORMATS.map((entry) => (
              <option key={entry.format} value={entry.format}>
                {t(`token.dateFormat.${entry.labelKey}`)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {isLongText ? (
        <p data-testid="token-hint" className="text-xs text-text-muted">
          {t('token.longTextHint')}
        </p>
      ) : null}
    </div>
  );
}
