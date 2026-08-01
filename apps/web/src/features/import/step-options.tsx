'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

export type OptionsEstimate = {
  totalRows: number;
  errorRows: number;
  duplicates: number;
};

export type ListOption = { id: string; name: string; optIn: 'single' | 'double' };

export type ImportOptionsValue = {
  listId: string | null;
  subscriptionStatus: 'confirmed' | 'pending';
  tag: string;
  onConflict: 'skip' | 'update' | 'overwrite' | 'error';
  declaration: boolean;
};

/**
 * Práh, nad kterým se nedá spolehlivě poznat druhý výskyt téže adresy.
 * Množina viděných adres by u většího souboru nevešla do paměti workeru.
 */
const DUPLICATE_ERROR_LIMIT = 1_000_000;

function datedTag(today: Date): string {
  const iso = today.toISOString().slice(0, 10);
  return `import-${iso}`;
}

/**
 * Krok 5. Volby popsané DŮSLEDKEM, ne názvem: „Doplníme, co chybí" místo
 * „merge". Výchozí je doplnění, protože přepis je jediná volba, která umí
 * nenávratně smazat data, která uživatel v aplikaci má.
 */
export function StepOptions({
  estimate,
  lists,
  onSubmit,
  today = new Date(),
}: {
  estimate: OptionsEstimate;
  lists: ListOption[];
  onSubmit: (value: ImportOptionsValue) => void;
  today?: Date;
}) {
  const t = useTranslations('import');
  const [value, setValue] = useState<ImportOptionsValue>({
    listId: null,
    subscriptionStatus: 'pending',
    tag: datedTag(today),
    onConflict: 'update',
    declaration: false,
  });

  const importable = Math.max(estimate.totalRows - estimate.errorRows - estimate.duplicates, 0);
  const duplicateErrorAvailable = estimate.totalRows <= DUPLICATE_ERROR_LIMIT;
  const selectedList = lists.find((list) => list.id === value.listId);
  const declarationRequired =
    selectedList?.optIn === 'double' && value.subscriptionStatus === 'confirmed';

  const set = <K extends keyof ImportOptionsValue>(key: K, next: ImportOptionsValue[K]) =>
    setValue((previous) => ({ ...previous, [key]: next }));

  return (
    <div className="flex flex-col gap-4">
      <h2>{t('options.title')}</h2>

      <label htmlFor="import-list">{t('options.list')}</label>
      <select
        id="import-list"
        value={value.listId ?? ''}
        onChange={(event) => set('listId', event.target.value === '' ? null : event.target.value)}
      >
        <option value="">{t('options.noList')}</option>
        {lists.map((list) => (
          <option key={list.id} value={list.id}>
            {list.name}
          </option>
        ))}
      </select>

      {value.listId !== null ? (
        <fieldset className="flex flex-col gap-1">
          <legend>{t('options.subscriptionStatus')}</legend>
          <label>
            <input
              type="radio"
              name="subscription"
              checked={value.subscriptionStatus === 'confirmed'}
              onChange={() => set('subscriptionStatus', 'confirmed')}
            />
            {t('options.subscriptionConfirmed')}
          </label>
          <label>
            <input
              type="radio"
              name="subscription"
              checked={value.subscriptionStatus === 'pending'}
              onChange={() => set('subscriptionStatus', 'pending')}
            />
            {t('options.subscriptionPending')}
          </label>
        </fieldset>
      ) : null}

      <label htmlFor="import-tag">{t('options.tag')}</label>
      {/* Předvyplněný datový štítek je náhrada za „vrátit tento import"
          (rozhodnutí R5): podle něj se skupina dá kdykoli najít a hromadně
          upravit, což mrtvé tlačítko Undo neumí. */}
      <input
        id="import-tag"
        value={value.tag}
        onChange={(event) => set('tag', event.target.value)}
      />
      <p className="text-sm text-text-muted">{t('options.tagHint')}</p>

      <fieldset className="flex flex-col gap-1">
        <legend>{t('options.conflict')}</legend>
        {(['skip', 'update', 'overwrite'] as const).map((mode) => (
          <label key={mode}>
            <input
              type="radio"
              name="conflict"
              checked={value.onConflict === mode}
              onChange={() => set('onConflict', mode)}
            />
            {t(`options.conflict${mode.charAt(0).toUpperCase()}${mode.slice(1)}`)}
            <span>{t(`options.conflict${mode.charAt(0).toUpperCase()}${mode.slice(1)}Hint`)}</span>
          </label>
        ))}
        <label>
          <input
            type="radio"
            name="conflict"
            checked={value.onConflict === 'error'}
            aria-disabled={!duplicateErrorAvailable}
            onChange={() => {
              if (duplicateErrorAvailable) set('onConflict', 'error');
            }}
          />
          {t('options.conflictError')}
          <span>{t('options.conflictErrorHint')}</span>
        </label>
        {duplicateErrorAvailable ? null : <p>{t('options.duplicateErrorUnavailable')}</p>}
      </fieldset>

      <label>
        <input
          type="checkbox"
          required={declarationRequired}
          checked={value.declaration}
          onChange={(event) => set('declaration', event.target.checked)}
        />
        {t('options.declaration')}
      </label>
      <p className="text-sm text-text-muted">{t('options.declarationEvidence')}</p>
      <button type="button" className="self-start text-sm underline">
        {t('options.declarationLink')}
      </button>

      {/* Na tlačítku je SKUTEČNÉ číslo, tedy řádky mínus chybné mínus duplicity.
          Kdyby tam byl počet řádků souboru, uživatel by po importu nechápal,
          proč se čísla neshodují. */}
      <button type="button" onClick={() => onSubmit(value)}>
        {t('options.submit', { count: importable })}
      </button>
    </div>
  );
}
