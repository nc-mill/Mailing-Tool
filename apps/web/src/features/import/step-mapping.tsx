'use client';

import { Button } from '@mlain/ui/components/button';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { Plus } from '@mlain/ui/icons';
import { Alert } from '@mlain/ui/patterns/states';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

export type MappingColumn = { name: string; sample: string; target: string };

export type MappingPreview = { columns: MappingColumn[] };

/**
 * Klíč vlastního pole z názvu sloupce.
 *
 * Server na klíč trvá tvarem `^[a-z][a-z0-9_]{0,39}$` (`FIELD_KEY`
 * v `contact-fields.routes.ts`), takže „Číslo smlouvy" se musí přeložit
 * na `cislo_smlouvy`. Prázdný nebo číslicí začínající výsledek dostane
 * předponu, jinak by ho server odmítl s `invalid_format`.
 */
export function fieldKeyFrom(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return /^[a-z]/.test(base) ? base : `pole_${base}`.slice(0, 40);
}

/**
 * Cíle, které server DOOPRAVDY přijme, tedy `MAPPING_TARGETS` z
 * `packages/core/src/contacts/import/mapping.ts`.
 *
 * „Telefon" a „Seznam" tady stály a byly to slepé uličky: `ImportMappingSchema`
 * žádný cíl `phone` nezná a `list` po sobě žádá i `list_id`, které obrazovka
 * neposílá. Uložení mapování proto skončilo na 422 a průvodce vypsal „Náhled
 * souboru se nepodařilo načíst", tedy hlášku, ze které se příčina poznat nedá.
 * Telefon navíc kontakt jako pole nemá; patřil by mezi vlastní pole.
 */
const TARGETS = [
  'email',
  'first_name',
  'last_name',
  'full_name',
  'title_prefix',
  'title_suffix',
  'gender',
  'locale',
  'tag',
] as const;

/**
 * Krok 3. U každého sloupce je UKÁZKA hodnoty ze souboru, ne jen jeho název:
 * hlavičky bývají zkratky, kterým po půl roce nerozumí ani ten, kdo je psal.
 */
export function StepMapping({
  preview,
  onCreateField,
  onNext,
}: {
  preview: MappingPreview;
  /**
   * Založí vlastní pole a vrátí jeho klíč, nebo `null` při selhání. Volání drží
   * průvodce, stejně jako u štítku a seznamu.
   */
  onCreateField: (input: { key: string; label: string }) => Promise<string | null>;
  onNext: (mapping: Record<string, string>) => void;
}) {
  const t = useTranslations('import');
  const [mapping, setMapping] = useState<Record<string, string>>(
    Object.fromEntries(preview.columns.map((column) => [column.name, column.target])),
  );
  const [showNoEmail, setShowNoEmail] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [createFailed, setCreateFailed] = useState<string | null>(null);
  /** Popisky založených polí podle klíče, ať je v rozbalovátku vidět jméno, ne klíč. */
  const [createdFields, setCreatedFields] = useState<Record<string, string>>({});
  const selects = useRef(new Map<string, HTMLSelectElement>());

  /**
   * Založení vlastního pole pro sloupec, který nepatří k ničemu známému.
   *
   * Tlačítko tady bylo od začátku, ale nemělo `onClick`, takže nedělalo nic
   * a sloupec navíc se dal jedině zahodit. Pole se zakládá jako TEXT: import
   * čte hodnoty ze souboru jako text a přísnější typ by celý řádek shodil na
   * chybě přetypování. Typ jde změnit v nastavení kontaktů, obráceně by to
   * znamenalo přepsat hodnoty u všech kontaktů.
   */
  async function createField(columnName: string): Promise<void> {
    setCreating(columnName);
    setCreateFailed(null);
    const key = await onCreateField({ key: fieldKeyFrom(columnName), label: columnName });
    setCreating(null);
    if (key === null) {
      setCreateFailed(columnName);
      return;
    }
    setCreatedFields((previous) => ({ ...previous, [key]: columnName }));
    setMapping((previous) => ({ ...previous, [columnName]: `attribute:${key}` }));
  }

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
    <div className="flex flex-col gap-[var(--spacing-gutter)]">
      <CardTitle>{t('mapping.title')}</CardTitle>

      {/* Tabulka mapování. Rozbalovátko je NATIVNÍ `select`, ne komponenta
          `Select`: krok si na něj drží `ref` a při chybějícím e-mailu na něj
          posadí fokus, což přes portálovanou nabídku udělat nejde. Vzhled se
          proto dorovnává třídami pole, ne výměnou prvku. */}
      <Card as="div" padding="none" gap="none" className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left">
          <caption className="sr-only">{t('mapping.title')}</caption>
          <thead>
            <tr className="border-b border-border bg-surface-muted">
              <th scope="col" className="meta-caps px-[var(--spacing-row-x)] py-3 text-text-muted">
                {t('mapping.columnInFile')}
              </th>
              <th scope="col" className="meta-caps px-[var(--spacing-row-x)] py-3 text-text-muted">
                {t('mapping.sample')}
              </th>
              <th scope="col" className="meta-caps px-[var(--spacing-row-x)] py-3 text-text-muted">
                {t('mapping.saveAs')}
              </th>
            </tr>
          </thead>
          <tbody>
            {preview.columns.map((column) => (
              <tr key={column.name} className="border-b border-border last:border-b-0">
                <th
                  scope="row"
                  className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)] align-top"
                >
                  <label htmlFor={`map-${column.name}`} className="text-ui font-semibold text-text">
                    {column.name}
                  </label>
                </th>
                {/* Ukázka je obsah cizího souboru, čte se po znacích. */}
                <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)] align-top font-mono text-meta text-text-muted">
                  {column.sample}
                </td>
                <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)] align-top">
                  <select
                    id={`map-${column.name}`}
                    ref={(node) => {
                      if (node) selects.current.set(column.name, node);
                    }}
                    className="min-h-[var(--size-target-min)] w-full min-w-[180px] rounded-[var(--radius-control)] border border-border-strong bg-field px-3.5 py-2.5 text-ui text-text"
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
                    {/* Založená vlastní pole. Bez téhle položky by se hodnota
                        `attribute:<klíč>` v rozbalovátku neměla čím zobrazit
                        a prohlížeč by spadl zpátky na první možnost. */}
                    {Object.entries(createdFields).map(([key, label]) => (
                      <option key={key} value={`attribute:${key}`}>
                        {t('mapping.customField', { name: label })}
                      </option>
                    ))}
                  </select>
                  {mapping[column.name] === 'full_name' ? (
                    <p className="mt-1.5 text-meta text-text-muted">{t('mapping.willSplit')}</p>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Tlačítko dřív nemělo obsluhu a nedělalo nic. Teď založí vlastní pole
          a rovnou na něj sloupec namapuje, takže sloupec navíc nemusí skončit
          v koši. */}
      {unmapped.length > 0 ? (
        <div className="flex flex-wrap gap-[var(--spacing-inline)]">
          {unmapped.map((column) => (
            <Button
              key={column.name}
              variant="secondary"
              size="sm"
              pending={creating === column.name}
              pendingLabel={t('mapping.creatingField', { name: column.name })}
              onClick={() => void createField(column.name)}
            >
              <Plus aria-hidden className="icon-sm" />
              {t('mapping.createField', { name: column.name })}
            </Button>
          ))}
        </div>
      ) : null}

      {createFailed === null ? null : (
        <Alert tone="error">{t('mapping.createFieldFailed', { name: createFailed })}</Alert>
      )}

      {duplicate ? (
        <Alert tone="warning">
          {t('mapping.duplicateTarget', {
            field: t(`mapping.targets.${duplicate[0]}`),
            columns: duplicate[1].join(' a '),
          })}
        </Alert>
      ) : null}

      {showNoEmail ? <Alert tone="error">{t('mapping.noEmail')}</Alert> : null}

      {/* Tlačítko primární akce NIKDY nemá disabled. Mrtvé tlačítko neřekne
          proč; tohle po kliknutí vysvětlí důvod a posadí fokus tam, kde se
          dá chyba opravit. */}
      <Button
        variant="primary"
        className="self-start"
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
      </Button>
    </div>
  );
}
