'use client';

import { Button } from '@mlain/ui/components/button';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { cn } from '@mlain/ui/lib/cn';
import { Alert } from '@mlain/ui/patterns/states';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

/** Buňka náhledu. Stejné odsazení jako v řádku tabulky ve zbytku aplikace. */
const CELL = 'px-[var(--spacing-row-x)] py-[var(--spacing-row-y)] text-ui text-text';

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
    <div className="flex flex-col gap-[var(--spacing-gutter)]">
      <CardTitle>{t('preview.title')}</CardTitle>

      {estimate.approximate ? <Alert tone="info">{t('preview.approximate')}</Alert> : null}

      <Card as="div" padding="none" gap="none" className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left">
          <caption className="sr-only">{t('preview.title')}</caption>
          <thead>
            <tr className="border-b border-border bg-surface-muted">
              {[
                t('preview.columns.email'),
                t('preview.columns.titlePrefix'),
                t('preview.columns.firstName'),
                t('preview.columns.gender'),
                t('preview.columns.lastName'),
                ...(greetingEnabled ? [t('preview.columns.greeting')] : []),
              ].map((header) => (
                <th
                  key={header}
                  scope="col"
                  className="meta-caps px-[var(--spacing-row-x)] py-3 whitespace-nowrap text-text-muted"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => (
              <tr
                key={row.rowNumber}
                data-state={row.state}
                // Chybný a duplicitní řádek se pozná plochou, ne jen sloupcem
                // se stavem: v náhledu jde právě o to, aby na nich oko utkvělo.
                className={cn(
                  'border-b border-border last:border-b-0',
                  row.state === 'error'
                    ? 'bg-danger-surface'
                    : row.state === 'duplicate'
                      ? 'bg-accent-surface'
                      : undefined,
                )}
              >
                <td className={cn(CELL, 'font-mono text-meta')}>{row.email}</td>
                <td className={CELL}>{row.titlePrefix}</td>
                <td className={CELL}>{row.firstName}</td>
                {/* Otazník, ne prázdno: prázdná buňka vypadá jako chybějící
                    sloupec, otazník říká „nevíme, a víme, že nevíme".
                    Rod se píše slovem, ne kódem: `female` v tabulce vedle
                    českých jmen vypadá jako nedodělek, kterým taky je. */}
                <td className={CELL}>
                  {row.gender === 'female'
                    ? t('vocative.genderFemale')
                    : row.gender === 'male'
                      ? t('vocative.genderMale')
                      : '?'}
                </td>
                <td className={CELL}>{row.lastName}</td>
                {greetingEnabled ? <td className={CELL}>{row.greeting}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="flex flex-wrap items-center gap-[var(--spacing-stack)]">
        <p className="font-mono text-meta text-text-muted">
          {t('preview.showing', { shown: estimate.shown, total: estimate.totalRows })}
        </p>
        {onShowMore ? (
          <Button variant="secondary" size="sm" onClick={onShowMore}>
            {t('preview.showMore')}
          </Button>
        ) : null}
      </div>

      {/* Tři upozornění o tom, co v souboru není v pořádku. Každé stojí samo za
          sebe, proto tři hlášky a ne jedna slepená věta. */}
      {greetingEnabled && estimate.reviewRows > 0 ? (
        <Alert tone="warning">{t('preview.vocativeNotice', { count: estimate.reviewRows })}</Alert>
      ) : null}
      {estimate.noEmailRows > 0 ? (
        <Alert tone="warning">{t('preview.noEmailRows', { count: estimate.noEmailRows })}</Alert>
      ) : null}
      {estimate.duplicateRows > 0 ? (
        <Alert tone="warning">
          {t('preview.duplicateRows', { count: estimate.duplicateRows })}
        </Alert>
      ) : null}

      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        aria-expanded={showSplit}
        onClick={() => setShowSplit((v) => !v)}
      >
        {t('preview.splitHelp')}
      </Button>

      {showSplit ? (
        <Card as="div" tone="muted" padding="sm">
          <fieldset className="flex flex-col gap-[var(--spacing-stack)]">
            <legend className="text-ui font-semibold text-text">{t('preview.nameOrder')}</legend>
            <label className="flex items-center gap-[var(--spacing-inline)] text-ui text-text">
              <input
                type="radio"
                name="name-order"
                defaultChecked
                className="accent-[var(--color-panel)]"
              />
              {t('preview.nameOrderFirstLast')}
            </label>
            <label className="flex items-center gap-[var(--spacing-inline)] text-ui text-text">
              <input type="radio" name="name-order" className="accent-[var(--color-panel)]" />
              {t('preview.nameOrderLastFirst')}
            </label>
            <label className="flex items-center gap-[var(--spacing-inline)] text-ui text-text">
              <input type="checkbox" defaultChecked className="accent-[var(--color-panel)]" />
              {t('preview.splitTitlesPrefix')}
            </label>
            <label className="flex items-center gap-[var(--spacing-inline)] text-ui text-text">
              <input type="checkbox" defaultChecked className="accent-[var(--color-panel)]" />
              {t('preview.splitTitlesSuffix')}
            </label>
            <label className="flex items-center gap-[var(--spacing-inline)] text-ui text-text">
              <input type="checkbox" defaultChecked className="accent-[var(--color-panel)]" />
              {t('preview.keepDoubleSurnames')}
            </label>
          </fieldset>
        </Card>
      ) : null}

      <Button variant="primary" className="self-start" onClick={onNext}>
        {t('preview.next')}
      </Button>
    </div>
  );
}
