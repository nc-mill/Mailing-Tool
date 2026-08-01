'use client';

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

/** Kandidáti, které nabízíme, když uživatel řekne, že je text rozsypaný. */
const ALTERNATIVES = [
  { value: 'windows-1250', label: 'Windows-1250' },
  { value: 'iso-8859-2', label: 'ISO-8859-2' },
  { value: 'utf-8', label: 'UTF-8' },
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
 */
export function StepFileCheck({
  preview,
  onConfirm,
}: {
  preview: FileCheckPreview;
  onConfirm: (result: FileCheckResult) => void;
}) {
  const t = useTranslations('import');
  const [garbled, setGarbled] = useState(false);
  const [encoding, setEncoding] = useState(preview.encoding);
  const [delimiter, setDelimiter] = useState(preview.delimiter);

  const dataRows = preview.hasHeader ? Math.max(preview.totalRows - 1, 0) : preview.totalRows;

  return (
    <div className="flex flex-col gap-4">
      <h2>{t('fileCheck.title')}</h2>

      <table>
        <caption className="sr-only">{t('fileCheck.title')}</caption>
        <tbody>
          {preview.sample.slice(0, 3).map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <p>{t('fileCheck.rowCount', { total: preview.totalRows, data: dataRows })}</p>

      <fieldset className="flex flex-col gap-2">
        <legend>{t('fileCheck.question')}</legend>
        <p className="text-sm text-text-muted">{t('fileCheck.questionHint')}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => onConfirm({ encoding, delimiter })}>
            {t('fileCheck.yes')}
          </button>
          <button type="button" onClick={() => setGarbled(true)}>
            {t('fileCheck.no')}
          </button>
        </div>
      </fieldset>

      {garbled ? (
        <fieldset className="flex flex-col gap-1">
          <legend>{t('fileCheck.alternatives')}</legend>
          {ALTERNATIVES.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name="encoding"
                value={option.value}
                checked={encoding === option.value}
                onChange={() => setEncoding(option.value)}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      ) : null}

      <label>
        {t('fileCheck.encoding')}
        <input
          name="encoding-value"
          value={encoding}
          onChange={(event) => setEncoding(event.target.value)}
        />
      </label>

      <label>
        {t('fileCheck.delimiter')}
        {/* Když detekce selhala, oddělovač je POVINNÝ. Bez něj se soubor
            nedá přečíst a průvodce by dál jen hádal. */}
        <select
          name="delimiter"
          required={preview.error === 'delimiter_not_detected'}
          value={delimiter}
          onChange={(event) => setDelimiter(event.target.value)}
        >
          {DELIMITERS.map((option) => (
            <option key={option.key} value={option.value}>
              {t(`fileCheck.delimiterOptions.${option.key}`)}
            </option>
          ))}
        </select>
      </label>

      <button type="button" onClick={() => onConfirm({ encoding, delimiter })}>
        {t('fileCheck.continue')}
      </button>
    </div>
  );
}
