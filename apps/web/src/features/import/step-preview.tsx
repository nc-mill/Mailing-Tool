'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

export type PreviewRow = {
  rowNumber: number;
  email: string | null;
  titlePrefix: string | null;
  firstName: string | null;
  lastName: string | null;
  gender: string | null;
  greeting: string | null;
  state: 'ok' | 'error' | 'suppressed' | 'duplicate';
};

export type PreviewEstimate = {
  totalRows: number;
  shown: number;
  reviewRows: number;
  noEmailRows: number;
  duplicateRows: number;
  approximate: boolean;
};

/**
 * Krok 4. Sloupec „Oslovení" je nejdůležitější sloupec celé obrazovky:
 * ukazuje přesně to, co uvidí příjemce v e-mailu, tedy jediné místo, kde se
 * pozná, jestli vokativ sedí. Neurčený rod se pozná podle „?" ve sloupci Rod
 * a podle oslovení bez jména.
 */
export function StepPreview({
  preview,
  estimate,
  onNext,
  onShowMore,
  greetingEnabled = true,
}: {
  preview: { rows: PreviewRow[] };
  estimate: PreviewEstimate;
  onNext: () => void;
  onShowMore?: () => void;
  /**
   * Řeší projekt oslovení a 5. pád? Vypnuto schová sloupec „Oslovení" i větu
   * o nejistém 5. pádu, protože obrazovka, na kterou ta věta odkazuje, v takovém
   * projektu neexistuje. Výchozí `true` je kvůli starším testům.
   */
  greetingEnabled?: boolean;
}) {
  const t = useTranslations('import');
  const [showSplit, setShowSplit] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <h2>{t('preview.title')}</h2>

      {estimate.approximate ? <p>{t('preview.approximate')}</p> : null}

      <table>
        <caption className="sr-only">{t('preview.title')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('preview.columns.email')}</th>
            <th scope="col">{t('preview.columns.titlePrefix')}</th>
            <th scope="col">{t('preview.columns.firstName')}</th>
            <th scope="col">{t('preview.columns.gender')}</th>
            <th scope="col">{t('preview.columns.lastName')}</th>
            {greetingEnabled ? <th scope="col">{t('preview.columns.greeting')}</th> : null}
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row) => (
            <tr key={row.rowNumber} data-state={row.state}>
              <td>{row.email}</td>
              <td>{row.titlePrefix}</td>
              <td>{row.firstName}</td>
              {/* Otazník, ne prázdno: prázdná buňka vypadá jako chybějící
                  sloupec, otazník říká „nevíme, a víme, že nevíme".
                  Rod se píše slovem, ne kódem: `female` v tabulce vedle
                  českých jmen vypadá jako nedodělek, kterým taky je. */}
              <td>
                {row.gender === 'female'
                  ? t('vocative.genderFemale')
                  : row.gender === 'male'
                    ? t('vocative.genderMale')
                    : '?'}
              </td>
              <td>{row.lastName}</td>
              {greetingEnabled ? <td>{row.greeting}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>

      <p>{t('preview.showing', { shown: estimate.shown, total: estimate.totalRows })}</p>
      {onShowMore ? (
        <button type="button" onClick={onShowMore}>
          {t('preview.showMore')}
        </button>
      ) : null}

      {greetingEnabled && estimate.reviewRows > 0 ? (
        <p>{t('preview.vocativeNotice', { count: estimate.reviewRows })}</p>
      ) : null}
      {estimate.noEmailRows > 0 ? (
        <p>{t('preview.noEmailRows', { count: estimate.noEmailRows })}</p>
      ) : null}
      {estimate.duplicateRows > 0 ? (
        <p>{t('preview.duplicateRows', { count: estimate.duplicateRows })}</p>
      ) : null}

      <button type="button" aria-expanded={showSplit} onClick={() => setShowSplit((v) => !v)}>
        {t('preview.splitHelp')}
      </button>

      {showSplit ? (
        <fieldset className="flex flex-col gap-1">
          <legend>{t('preview.nameOrder')}</legend>
          <label>
            <input type="radio" name="name-order" defaultChecked />
            {t('preview.nameOrderFirstLast')}
          </label>
          <label>
            <input type="radio" name="name-order" />
            {t('preview.nameOrderLastFirst')}
          </label>
          <label>
            <input type="checkbox" defaultChecked />
            {t('preview.splitTitlesPrefix')}
          </label>
          <label>
            <input type="checkbox" defaultChecked />
            {t('preview.splitTitlesSuffix')}
          </label>
          <label>
            <input type="checkbox" defaultChecked />
            {t('preview.keepDoubleSurnames')}
          </label>
        </fieldset>
      ) : null}

      <button type="button" onClick={onNext}>
        {t('preview.next')}
      </button>
    </div>
  );
}
