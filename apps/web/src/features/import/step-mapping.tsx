'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

export type MappingColumn = { name: string; sample: string; target: string };

export type MappingPreview = { columns: MappingColumn[] };

const TARGETS = [
  'email',
  'first_name',
  'last_name',
  'full_name',
  'title_prefix',
  'title_suffix',
  'gender',
  'locale',
  'phone',
  'list',
  'tag',
] as const;

/**
 * Krok 3. U každého sloupce je UKÁZKA hodnoty ze souboru, ne jen jeho název:
 * hlavičky bývají zkratky, kterým po půl roce nerozumí ani ten, kdo je psal.
 */
export function StepMapping({
  preview,
  onNext,
}: {
  preview: MappingPreview;
  onNext: (mapping: Record<string, string>) => void;
}) {
  const t = useTranslations('import');
  const [mapping, setMapping] = useState<Record<string, string>>(
    Object.fromEntries(preview.columns.map((column) => [column.name, column.target])),
  );
  const [showNoEmail, setShowNoEmail] = useState(false);
  const selects = useRef(new Map<string, HTMLSelectElement>());

  const emailColumn = Object.entries(mapping).find(([, target]) => target === 'email')?.[0];

  const duplicates = Object.entries(mapping).reduce<Record<string, string[]>>(
    (acc, [column, target]) => {
      if (target === 'ignore' || target === '') return acc;
      acc[target] = [...(acc[target] ?? []), column];
      return acc;
    },
    {},
  );
  const duplicate = Object.entries(duplicates).find(([, columns]) => columns.length > 1);

  const unmapped = preview.columns.filter(
    (column) => mapping[column.name] === 'ignore' || mapping[column.name] === '',
  );

  return (
    <div className="flex flex-col gap-4">
      <h2>{t('mapping.title')}</h2>

      <table>
        <caption className="sr-only">{t('mapping.title')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('mapping.columnInFile')}</th>
            <th scope="col">{t('mapping.sample')}</th>
            <th scope="col">{t('mapping.saveAs')}</th>
          </tr>
        </thead>
        <tbody>
          {preview.columns.map((column) => (
            <tr key={column.name}>
              <th scope="row">
                <label htmlFor={`map-${column.name}`}>{column.name}</label>
              </th>
              <td>{column.sample}</td>
              <td>
                <select
                  id={`map-${column.name}`}
                  ref={(node) => {
                    if (node) selects.current.set(column.name, node);
                  }}
                  value={mapping[column.name] ?? 'ignore'}
                  onChange={(event) =>
                    setMapping((previous) => ({ ...previous, [column.name]: event.target.value }))
                  }
                >
                  <option value="ignore">{t('mapping.ignore')}</option>
                  {TARGETS.map((target) => (
                    <option key={target} value={target}>
                      {t(`mapping.targets.${target}`)}
                    </option>
                  ))}
                </select>
                {mapping[column.name] === 'full_name' ? <p>{t('mapping.willSplit')}</p> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {unmapped.map((column) => (
        <button key={column.name} type="button">
          {t('mapping.createField', { name: column.name })}
        </button>
      ))}

      {duplicate ? (
        <p role="alert">
          {t('mapping.duplicateTarget', {
            field: t(`mapping.targets.${duplicate[0]}`),
            columns: duplicate[1].join(' a '),
          })}
        </p>
      ) : null}

      {showNoEmail ? <p role="alert">{t('mapping.noEmail')}</p> : null}

      {/* Tlačítko primární akce NIKDY nemá disabled. Mrtvé tlačítko neřekne
          proč; tohle po kliknutí vysvětlí důvod a posadí fokus tam, kde se
          dá chyba opravit. */}
      <button
        type="button"
        onClick={() => {
          if (emailColumn === undefined) {
            setShowNoEmail(true);
            const first = preview.columns[0];
            if (first) selects.current.get(first.name)?.focus();
            return;
          }
          onNext(mapping);
        }}
      >
        {t('mapping.next')}
      </button>
    </div>
  );
}
