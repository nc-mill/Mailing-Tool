'use client';

import { Button } from '@mlain/ui/components/button';
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
    <div className="flex max-w-3xl flex-col gap-5">
      <h2 className="text-lg font-semibold text-text">{t('fileCheck.title')}</h2>

      <table className="w-full text-left text-sm">
        <caption className="sr-only">{t('fileCheck.title')}</caption>
        {preview.hasHeader ? (
          <thead>
            <tr>
              {(headerRow ?? []).map((cell, index) => (
                <th
                  key={index}
                  scope="col"
                  className="border-b border-border pr-3 pb-1 font-medium"
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
                <td key={cellIndex} className="pr-3 pt-1 text-text-muted">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <p>{t('fileCheck.rowCount', { total: preview.totalRows, data: dataRows })}</p>

      {rechecking ? <p role="status">{t('fileCheck.rechecking')}</p> : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="font-semibold text-text">{t('fileCheck.question')}</legend>
        <p className="text-sm text-text-muted">{t('fileCheck.questionHint')}</p>
        <div className="flex flex-wrap gap-2">
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
        <div className="flex flex-col gap-2 rounded-[var(--radius-surface)] border border-border p-4">
          <p className="text-sm text-text">{t('fileCheck.alternatives')}</p>
          <div className="flex flex-wrap gap-2">
            {ENCODINGS.filter((option) => option.value !== encoding).map((option) => (
              <Button
                key={option.value}
                type="button"
                variant="secondary"
                onClick={() => {
                  setEncoding(option.value);
                  void recheck({ encoding: option.value, delimiter });
                }}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <p className="text-sm text-text-muted">{t('fileCheck.alternativesHint')}</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <span aria-hidden className="text-sm font-medium text-text">
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
        <span aria-hidden className="text-sm font-medium text-text">
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
          <p role="alert" className="text-sm text-danger-text">
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
