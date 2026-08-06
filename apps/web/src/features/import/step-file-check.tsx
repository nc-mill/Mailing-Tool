'use client';

import { Button } from '@mlain/ui/components/button';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { Select, SelectItem } from '@mlain/ui/components/select';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

export type FileCheckPreview = {
  encoding: string;
  delimiter: string;
  hasHeader: boolean;
  totalRows: number;
  sample: string[][];
  error?: 'delimiter_not_detected';
};

export type FileCheckResult = { encoding: string; delimiter: string };

/**
 * Kódování, která server umí přečíst (`SupportedEncoding` v `encoding.ts`).
 * Volný text tu byl past: co uživatel napsal, se uložilo, a soubor se pak
 * nedal přečíst vůbec.
 */
const ENCODINGS = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'windows-1250', label: 'Windows-1250 (český Excel)' },
  { value: 'iso-8859-2', label: 'ISO-8859-2' },
  { value: 'windows-1252', label: 'Windows-1252' },
  { value: 'iso-8859-1', label: 'ISO-8859-1' },
];

const DELIMITERS = [
  { value: ';', key: 'semicolon' },
  { value: ',', key: 'comma' },
  { value: '\t', key: 'tab' },
  { value: '|', key: 'pipe' },
];

/**
 * Krok 2. Ptá se OTÁZKOU, ne nastavením: netechnický člověk neví, co je
 * Windows-1250, ale okamžitě pozná, jestli je jeho město napsané správně.
 * Právě tady se chytá poškozená diakritika, nejčastější český problém vůbec.
 *
 * ZMĚNA KÓDOVÁNÍ NEBO ODDĚLOVAČE ČTE SOUBOR ZNOVU. Do 5. 8. 2026 se volba jen
 * zapsala do stavu komponenty a ukázka nad ní zůstala nezměněná, takže krok
 * vypadal mrtvě: uživatel odpověděl „ne, je to rozsypané", vybral jiné
 * kódování a na obrazovce se nestalo nic. Jestli se trefil, se dozvěděl až
 * o dva kroky dál, kde se ale kódování už měnit nedá. Teď se volba uloží
 * (`PATCH`) a náhled se načte znovu, takže odpověď je vidět hned tam, kde se
 * na ni obrazovka ptá.
 */
export function StepFileCheck({
  preview,
  onRecheck,
  onConfirm,
}: {
  preview: FileCheckPreview;
  /** Uloží kódování a oddělovač a načte náhled znovu. Krok se nemění. */
  onRecheck: (result: FileCheckResult) => Promise<void>;
  onConfirm: (result: FileCheckResult) => void;
}) {
  const t = useTranslations('import');
  const [garbled, setGarbled] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [encoding, setEncoding] = useState(preview.encoding);
  const [delimiter, setDelimiter] = useState(preview.delimiter);

  const dataRows = preview.hasHeader ? Math.max(preview.totalRows - 1, 0) : preview.totalRows;
  const rows = preview.sample.slice(0, 3);
  const [headerRow, ...dataSample] = preview.hasHeader ? rows : [[] as string[], ...rows];

  async function recheck(next: FileCheckResult): Promise<void> {
    setRechecking(true);
    await onRecheck(next);
    setRechecking(false);
  }

  return (
    <div className="flex max-w-[var(--container-prose)] flex-col gap-[var(--spacing-gutter)]">
      <CardTitle>{t('fileCheck.title')}</CardTitle>

      {/* Ukázka ze souboru. Je to obsah cizího souboru, tedy data ke čtení po
          znacích: mono, na tlumené ploše a s vlastním vodorovným posuvem, aby
          široký soubor neposouval celou stránku. */}
      <Card as="div" tone="muted" padding="none" gap="none" className="overflow-x-auto">
        <table className="w-full text-left font-mono text-meta">
          <caption className="sr-only">{t('fileCheck.title')}</caption>
          {preview.hasHeader ? (
            <thead>
              <tr>
                {(headerRow ?? []).map((cell, index) => (
                  <th
                    key={index}
                    scope="col"
                    className="border-b border-border px-[var(--spacing-inline)] py-2 whitespace-nowrap text-text"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {dataSample.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className="px-[var(--spacing-inline)] py-2 whitespace-nowrap text-text-muted"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="font-mono text-meta text-text-muted">
        {t('fileCheck.rowCount', { total: preview.totalRows, data: dataRows })}
      </p>

      {rechecking ? (
        <p role="status" className="font-mono text-meta text-text-muted">
          {t('fileCheck.rechecking')}
        </p>
      ) : null}

      <fieldset className="flex flex-col gap-[var(--spacing-stack)]">
        <legend className="text-ui font-semibold text-text">{t('fileCheck.question')}</legend>
        <p className="text-meta text-text-muted">{t('fileCheck.questionHint')}</p>
        <div className="flex flex-wrap gap-[var(--spacing-inline)]">
          <Button
            type="button"
            variant="primary"
            onClick={() => onConfirm({ encoding, delimiter })}
          >
            {t('fileCheck.yes')}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setGarbled(true)}>
            {t('fileCheck.no')}
          </Button>
        </div>
      </fieldset>

      {/* Odpověď „ne" musí něco udělat. Vybrané kódování se uloží a ukázka
          nahoře se překreslí, takže uživatel na místě vidí, jestli se trefil. */}
      {garbled ? (
        <Card as="div" padding="sm">
          <p className="text-ui text-text">{t('fileCheck.alternatives')}</p>
          <div className="flex flex-wrap gap-[var(--spacing-inline)]">
            {ENCODINGS.filter((option) => option.value !== encoding).map((option) => (
              <Button
                key={option.value}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEncoding(option.value);
                  void recheck({ encoding: option.value, delimiter });
                }}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <p className="text-meta text-text-muted">{t('fileCheck.alternativesHint')}</p>
        </Card>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <span aria-hidden className="text-sm font-semibold text-text">
          {t('fileCheck.encoding')}
        </span>
        <Select
          aria-label={t('fileCheck.encoding')}
          placeholder={t('fileCheck.encoding')}
          value={encoding}
          onValueChange={(next) => {
            setEncoding(next);
            void recheck({ encoding: next, delimiter });
          }}
        >
          {ENCODINGS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <span aria-hidden className="text-sm font-semibold text-text">
          {t('fileCheck.delimiter')}
        </span>
        {/* Když detekce selhala, oddělovač je POVINNÝ. Bez něj se soubor
            nedá přečíst a průvodce by dál jen hádal. */}
        <Select
          aria-label={t('fileCheck.delimiter')}
          placeholder={t('fileCheck.delimiter')}
          value={delimiter}
          onValueChange={(next) => {
            setDelimiter(next);
            void recheck({ encoding, delimiter: next });
          }}
        >
          {DELIMITERS.map((option) => (
            <SelectItem key={option.key} value={option.value}>
              {t(`fileCheck.delimiterOptions.${option.key}`)}
            </SelectItem>
          ))}
        </Select>
        {preview.error === 'delimiter_not_detected' ? (
          <p role="alert" className="text-meta text-danger-text">
            {t('fileErrors.delimiter_not_detected.nextStep')}
          </p>
        ) : null}
      </div>

      <Button
        type="button"
        variant="primary"
        className="self-start"
        onClick={() => onConfirm({ encoding, delimiter })}
      >
        {t('fileCheck.continue')}
      </Button>
    </div>
  );
}
