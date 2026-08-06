'use client';

import { Button } from '@mlain/ui/components/button';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { Collapsible } from '@mlain/ui/components/collapsible';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { RadioGroup, RadioGroupItem } from '@mlain/ui/components/radio-group';
import { Select, SelectItem } from '@mlain/ui/components/select';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

export type OptionsEstimate = {
  totalRows: number;
  errorRows: number;
  duplicates: number;
};

export type ListOption = {
  id: string;
  name: string;
  optIn: 'single' | 'double';
  /** Výchozí seznam projektu. Průvodce ho má předvybraný, viz `useState` níž. */
  isDefault?: boolean;
};

export type ImportOptionsValue = {
  /**
   * Seznam je POVINNÝ, proto `string` a ne `string | null`. Kontakt bez seznamu
   * nemá co dostat a nemá se z čeho odhlásit, takže „do žádného seznamu" byla
   * volba, která tiše vyráběla nepoužitelné kontakty: publikum kampaně se bere
   * ze seznamů a odhlašovací odkaz taky. Zákaz je v typu, ne jen na obrazovce.
   */
  listId: string;
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

/** Hodnota, kterou v rozbalovátku nese volba „Založit nový seznam". */
const CREATE_LIST = '__create__';

function datedTag(today: Date): string {
  const iso = today.toISOString().slice(0, 10);
  return `import-${iso}`;
}

const CONFLICT_MODES = ['skip', 'update', 'overwrite'] as const;

const SUBSCRIPTION_CHOICES = [
  { value: 'confirmed', label: 'subscriptionConfirmed', hint: 'subscriptionConfirmedHint' },
  { value: 'pending', label: 'subscriptionPending', hint: 'subscriptionPendingHint' },
] as const;

/**
 * Krok 5. Volby popsané DŮSLEDKEM, ne názvem: „Doplníme, co chybí" místo
 * „merge". Výchozí je doplnění, protože přepis je jediná volba, která umí
 * nenávratně smazat data, která uživatel v aplikaci má.
 *
 * ZAŘAZENÍ DO SEZNAMU JE POVINNÉ. Dřív tu byla volba „Do žádného seznamu"
 * a byla dokonce výchozí, takže se běžný import odbyl kontakty, kterým pak
 * nešlo nic poslat. Kdo ještě žádný seznam nemá, založí ho rovnou tady:
 * odejít z rozdělaného importu do jiné části aplikace znamená začít znovu,
 * protože průvodce běží nad konkrétním nahraným souborem.
 */
export function StepOptions({
  estimate,
  lists,
  onCreateList,
  onSubmit,
  today = new Date(),
}: {
  estimate: OptionsEstimate;
  lists: ListOption[];
  /** Založení seznamu drží průvodce, stejně jako založení štítku. Vrací `null` při selhání. */
  onCreateList: (name: string) => Promise<ListOption | null>;
  onSubmit: (value: ImportOptionsValue) => void;
  today?: Date;
}) {
  const t = useTranslations('import');
  const [available, setAvailable] = useState<ListOption[]>(lists);
  const [createdName, setCreatedName] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newListName, setNewListName] = useState('');
  // Kdo nemá ani jeden seznam, dostane políčko pro založení rovnou otevřené.
  // Prázdné rozbalovátko s jedinou volbou „Založit nový" je zbytečné kliknutí
  // navíc přesně v tu chvíli, kdy uživatel nejmíň chápe, co se po něm chce.
  const [showCreate, setShowCreate] = useState(lists.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState<ImportOptionsValue>({
    /*
     * VÝCHOZÍ SEZNAM PROJEKTU JE PŘEDVYBRANÝ. Prázdný řetězec znamená
     * „ještě nevybráno" a tlačítko „Naimportovat" se s ním nehne dál.
     * Předvybrat NÁHODNÝ seznam by za uživatele rozhodlo, kam jeho kontakty
     * půjdou, kdežto výchozí seznam projektu je volba, kterou už jednou udělal.
     */
    listId: lists.find((list) => list.isDefault === true)?.id ?? '',
    subscriptionStatus: 'pending',
    tag: datedTag(today),
    onConflict: 'update',
    declaration: false,
  });

  // `Select` z P05 ref nepřijímá, takže se spouštěč hledá v obalu. Tentýž
  // postup má `SelectField`; do `packages/ui` tahle část zapisovat nesmí.
  const listWrapperRef = useRef<HTMLDivElement>(null);
  const focusList = (): void => {
    const trigger = listWrapperRef.current?.querySelector('[role="combobox"]');
    if (trigger instanceof HTMLElement) trigger.focus();
  };
  const declarationRef = useRef<HTMLButtonElement>(null);
  const newListRef = useRef<HTMLInputElement>(null);

  const importable = Math.max(estimate.totalRows - estimate.errorRows - estimate.duplicates, 0);
  const duplicateErrorAvailable = estimate.totalRows <= DUPLICATE_ERROR_LIMIT;
  const selectedList = available.find((list) => list.id === value.listId);
  const declarationRequired =
    selectedList?.optIn === 'double' && value.subscriptionStatus === 'confirmed';

  const set = <K extends keyof ImportOptionsValue>(key: K, next: ImportOptionsValue[K]) =>
    setValue((previous) => ({ ...previous, [key]: next }));

  async function createList(): Promise<void> {
    const name = newListName.trim();
    if (name === '') {
      setError(t('options.newListNameRequired'));
      newListRef.current?.focus();
      return;
    }
    setCreating(true);
    const created = await onCreateList(name);
    setCreating(false);
    if (created === null) {
      setError(t('options.newListFailed'));
      return;
    }
    setAvailable((previous) => [...previous, created]);
    setCreatedName(created.name);
    setShowCreate(false);
    setNewListName('');
    setError(null);
    set('listId', created.id);
  }

  /**
   * Tlačítko primární akce NIKDY nemá `disabled`: mrtvé tlačítko neřekne proč.
   * Kontrola je tady, po kliknutí, a posadí fokus tam, kde se dá chyba opravit.
   *
   * Prohlášení hlídá i server (`assertOptionsConsistent` vrátí 422
   * `declaration_required`), takže se obejít nedá. Tahle kontrola je jen ta
   * dřívější a srozumitelnější polovina: uživatel se to dozví u zaškrtávátka,
   * ne jako technické selhání uložení voleb.
   */
  function submit(): void {
    if (value.listId === '') {
      setError(t('options.listRequired'));
      focusList();
      return;
    }
    if (declarationRequired && !value.declaration) {
      setError(t('options.declarationRequired'));
      declarationRef.current?.focus();
      return;
    }
    setError(null);
    onSubmit(value);
  }

  return (
    <div className="flex max-w-[var(--container-prose)] flex-col gap-[var(--spacing-gutter)]">
      <CardTitle>{t('options.title')}</CardTitle>

      {/*
        Výběr seznamu ZÁMĚRNĚ nesedí v `Field`. Ta komponenta klonuje svého
        potomka a dosazuje mu `id`, na které pak ukazuje `htmlFor` popisku;
        u `Select` z P05 by `id` skončilo na obalu, ne na spouštěči, a popisek
        by neukazoval na nic. Přístupné jméno proto nese `aria-label`, stejně
        jako to dělá `SelectField` ve zbytku aplikace, a viditelný text je
        `<span>`, ne `<label>`, aby čtečka jméno nepředčítala dvakrát.
      */}
      <div ref={listWrapperRef} className="flex flex-col gap-1.5">
        <span aria-hidden className="text-sm font-semibold text-text">
          {t('options.list')}
        </span>
        <Select
          aria-label={t('options.list')}
          placeholder={t('options.listPlaceholder')}
          {...(value.listId === '' ? {} : { value: value.listId })}
          onValueChange={(next) => {
            if (next === CREATE_LIST) {
              setShowCreate(true);
              setError(null);
              // Fokus do políčka s názvem, aby se dalo rovnou psát.
              window.setTimeout(() => newListRef.current?.focus(), 0);
              return;
            }
            setShowCreate(false);
            setError(null);
            set('listId', next);
          }}
        >
          {available.map((list) => (
            <SelectItem key={list.id} value={list.id}>
              {list.name}
            </SelectItem>
          ))}
          <SelectItem value={CREATE_LIST}>{t('options.createList')}</SelectItem>
        </Select>
        <p className="text-meta text-text-muted">{t('options.listHint')}</p>
      </div>

      {createdName === null ? null : (
        <p role="status" className="font-mono text-meta text-text-muted">
          {t('options.newListCreated', { name: createdName })}
        </p>
      )}

      {showCreate ? (
        <Card as="div" padding="sm">
          <Field label={t('options.newListName')} hint={t('options.newListNameHint')}>
            <Input
              ref={newListRef}
              value={newListName}
              maxLength={120}
              data-testid="import-new-list-name"
              onChange={(event) => setNewListName(event.target.value)}
            />
          </Field>
          <Button
            type="button"
            variant="secondary"
            className="self-start"
            onClick={() => void createList()}
          >
            {creating ? t('options.newListCreating') : t('options.newListCreate')}
          </Button>
        </Card>
      ) : null}

      <fieldset className="flex flex-col gap-[var(--spacing-stack)]">
        <legend className="mb-[var(--spacing-inline)] text-ui font-semibold text-text">
          {t('options.subscriptionStatus')}
        </legend>
        <RadioGroup
          name="import-subscription"
          value={value.subscriptionStatus}
          onValueChange={(next: string) => {
            set('subscriptionStatus', next === 'confirmed' ? 'confirmed' : 'pending');
            setError(null);
          }}
        >
          {SUBSCRIPTION_CHOICES.map((option) => (
            <div key={option.value} className="flex items-start gap-3">
              <RadioGroupItem
                value={option.value}
                id={`import-subscription-${option.value}`}
                aria-labelledby={`import-subscription-label-${option.value}`}
              />
              <div className="flex flex-col gap-1">
                <span
                  id={`import-subscription-label-${option.value}`}
                  className="text-ui font-semibold text-text"
                >
                  {t(`options.${option.label}`)}
                </span>
                <span className="text-meta text-text-muted">{t(`options.${option.hint}`)}</span>
              </div>
            </div>
          ))}
        </RadioGroup>
      </fieldset>

      {/* Předvyplněný datový štítek je náhrada za „vrátit tento import"
          (rozhodnutí R5): podle něj se skupina dá kdykoli najít a hromadně
          upravit, což mrtvé tlačítko Undo neumí. */}
      <Field
        label={t('options.tag')}
        optionalLabel={t('options.tagOptional')}
        hint={t('options.tagHint')}
      >
        <Input
          value={value.tag}
          maxLength={120}
          onChange={(event) => set('tag', event.target.value)}
        />
      </Field>

      <fieldset className="flex flex-col gap-[var(--spacing-stack)]">
        <legend className="mb-[var(--spacing-inline)] text-ui font-semibold text-text">
          {t('options.conflict')}
        </legend>
        <RadioGroup
          name="import-conflict"
          value={value.onConflict}
          onValueChange={(next: string) => {
            // Zašedlá volba se nesmí dát vybrat ani klávesnicí: dávka nad
            // milionem řádků druhý výskyt téže adresy spolehlivě nepozná.
            if (next === 'error' && !duplicateErrorAvailable) return;
            set('onConflict', next as ImportOptionsValue['onConflict']);
          }}
        >
          {CONFLICT_MODES.map((mode) => {
            const suffix = `${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;
            return (
              <div key={mode} className="flex items-start gap-3">
                <RadioGroupItem
                  value={mode}
                  id={`import-conflict-${mode}`}
                  aria-labelledby={`import-conflict-label-${mode}`}
                />
                <div className="flex flex-col gap-1">
                  <span
                    id={`import-conflict-label-${mode}`}
                    className="text-ui font-semibold text-text"
                  >
                    {t(`options.conflict${suffix}`)}
                  </span>
                  <span className="text-meta text-text-muted">
                    {t(`options.conflict${suffix}Hint`)}
                  </span>
                </div>
              </div>
            );
          })}
          <div className="flex items-start gap-3">
            <RadioGroupItem
              value="error"
              id="import-conflict-error"
              aria-labelledby="import-conflict-label-error"
              aria-disabled={!duplicateErrorAvailable}
            />
            <div className="flex flex-col gap-1">
              <span id="import-conflict-label-error" className="text-ui font-semibold text-text">
                {t('options.conflictError')}
              </span>
              <span className="text-meta text-text-muted">{t('options.conflictErrorHint')}</span>
            </div>
          </div>
        </RadioGroup>
        {duplicateErrorAvailable ? null : (
          <p className="text-meta text-text-muted">{t('options.duplicateErrorUnavailable')}</p>
        )}
      </fieldset>

      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-3">
          <Checkbox
            ref={declarationRef}
            id="import-declaration"
            checked={value.declaration}
            aria-describedby="import-declaration-evidence"
            onCheckedChange={(next) => {
              set('declaration', next === true);
              setError(null);
            }}
          />
          <label htmlFor="import-declaration" className="text-ui text-text">
            {t('options.declaration')}
          </label>
        </div>
        <p id="import-declaration-evidence" className="text-meta text-text-muted">
          {t('options.declarationEvidence')}
        </p>
        {/* Tlačítko „Co to znamená" bylo mrtvé: nemělo `onClick`, takže nedělalo
            nic. Teď rozbalí vysvětlení přímo pod prohlášením, protože kdo se ptá,
            co potvrzuje, nechce kvůli odpovědi opustit rozdělaný import. */}
        <Collapsible summary={t('options.declarationLink')} className="self-start">
          <Card
            as="div"
            tone="muted"
            padding="sm"
            className="max-w-[var(--container-prose)] text-ui text-text"
          >
            <strong>{t('options.declarationExplainTitle')}</strong>
            <p>{t('options.declarationExplainBody')}</p>
            <p className="text-meta text-text-muted">{t('options.declarationExplainWhen')}</p>
          </Card>
        </Collapsible>
      </div>

      {error === null ? null : (
        <p role="alert" className="text-meta text-danger-text">
          {error}
        </p>
      )}

      {/* CÍLOVÝ SEZNAM JE VIDĚT U TLAČÍTKA. Výchozí seznam projektu je
          předvybraný, takže kdo klikne bez čtení, musí poznat z obrazovky, kam
          import půjde, ne až z výsledku. */}
      {selectedList === undefined ? null : (
        <p className="text-meta text-text-muted">
          {t('options.submitTarget', {
            list: selectedList.name,
            status: t(
              value.subscriptionStatus === 'confirmed'
                ? 'options.subscriptionConfirmed'
                : 'options.subscriptionPending',
            ).toLowerCase(),
          })}
        </p>
      )}

      {/* Na tlačítku je SKUTEČNÉ číslo, tedy řádky mínus chybné mínus duplicity.
          Kdyby tam byl počet řádků souboru, uživatel by po importu nechápal,
          proč se čísla neshodují. */}
      <Button type="button" variant="primary" className="self-start" onClick={submit}>
        {t('options.submit', { count: importable })}
      </Button>
    </div>
  );
}
