'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { Select, SelectItem } from '@mlain/ui/components/select';
import { Switch } from '@mlain/ui/components/switch';
import { ArrowDown, ArrowUp, Plus, Save, X } from '@mlain/ui/icons';
import { Alert } from '@mlain/ui/patterns/states';
import { CheckIcon } from '@/lib/ui/status-icons';
import { useContactTargetLabel } from '@/lib/ui/contact-target-label';
import { useFieldTypeHint, useFieldTypeLabel } from '@/lib/ui/field-type-label';
import { createContactFieldAction, saveFormFieldsAction, type FormFieldBody } from './actions';
import { UnstyledFormPreview } from './unstyled-preview';
import type { ContactFieldOption, FormFieldView } from './types';

/** Strop ze schématu (`FormDefinitionSchema.fields.max(15)`). Uživatel ho vidí dřív, než na něj narazí. */
const MAX_FIELDS = 15;

/** Pevná pole kontaktu, do kterých formulář umí zapsat bez katalogu vlastních polí. */
const CONTACT_TARGETS = [
  { target: 'email', type: 'email' },
  { target: 'first_name', type: 'text' },
  { target: 'last_name', type: 'text' },
  { target: 'full_name', type: 'text' },
  { target: 'locale', type: 'text' },
] as const;

/**
 * Typy vlastního pole kontaktu na značku vstupu ve formuláři.
 *
 * Zrcadlí `formFieldTypeFor` z `packages/core/src/contacts/forms/definition.ts`.
 * `multi_enum` tu SCHVÁLNĚ chybí: jeho hodnota je pole, odeslání formuláře přenáší
 * jednu hodnotu na klíč, takže by se tiše uložila jen poslední vybraná. Rozhraní
 * takové pole nenabídne a řekne proč, místo aby vyrobilo formulář, který lže.
 */
const INPUT_TYPE_FOR: Record<string, string> = {
  text: 'text',
  long_text: 'textarea',
  number: 'number',
  boolean: 'checkbox',
  date: 'date',
  datetime: 'datetime',
  enum: 'select',
  url: 'url',
  email: 'email',
  phone: 'tel',
};

export type BuilderField = {
  /** Klíč v rámci obrazovky. U pevných polí je to `target`, u vlastních `attr_<klíč>`. */
  key: string;
  target: string | { attribute: string };
  label: string;
  required: boolean;
  type: string;
  options?: { value: string; label: string }[];
};

function keyOf(field: FormFieldView | BuilderField): string {
  return typeof field.target === 'string' ? field.target : `attr_${field.target.attribute}`;
}

function toBuilder(field: FormFieldView, locale: string): BuilderField {
  const label = field.label[locale] ?? field.label['en'] ?? '';
  return {
    key: keyOf(field),
    target: field.target,
    label,
    required: field.required,
    type: field.type,
    ...(field.options === undefined
      ? {}
      : {
          options: field.options.map((option) => ({
            value: option.value,
            label: option.label[locale] ?? option.label['en'] ?? option.value,
          })),
        }),
  };
}

function toBody(field: BuilderField): FormFieldBody {
  return {
    target: field.target,
    label: field.label,
    required: field.required,
    type: field.type,
    ...(field.options === undefined ? {} : { options: field.options }),
  };
}

/**
 * Stavitel polí formuláře.
 *
 * POŘADÍ SE MĚNÍ TLAČÍTKY, ne táhnutím myší. Je to vědomé rozhodnutí, ne zkratka:
 * táhnutí musí mít klávesovou obdobu, jinak je stavitel pro část lidí nepoužitelný,
 * a dvě cesty k témuž (myš i klávesnice) znamenají dvakrát tolik stavu, který se
 * dá rozbít. Tlačítka „nahoru" a „dolů" umí obojí naráz a čtečka je přečte.
 *
 * UKLÁDÁ SE VÝSLOVNĚ, ne po každém písmenu. Sada polí je jeden celek se stropem
 * a s pořadím; průběžné ukládání po znaku by posílalo desítky nekompletních verzí.
 */
export function FieldBuilder({
  formId,
  workspaceId,
  fields,
  contactFields,
  locale,
  canEdit,
}: {
  formId: string;
  workspaceId: string;
  fields: FormFieldView[];
  /** Katalog vlastních polí kontaktu, ze kterého se vybírá cíl. */
  contactFields: ContactFieldOption[];
  locale: string;
  canEdit: boolean;
}) {
  const t = useTranslations('forms.fields');
  const tc = useTranslations('common.actions');
  const typeLabel = useFieldTypeLabel();

  const [items, setItems] = useState<BuilderField[]>(() =>
    fields.map((field) => toBuilder(field, locale)),
  );
  const [dirty, setDirty] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newFieldOpen, setNewFieldOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const used = useMemo(() => new Set(items.map((item) => item.key)), [items]);
  const left = MAX_FIELDS - items.length;

  function change(next: BuilderField[]) {
    setItems(next);
    setDirty(true);
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const moved = next[index]!;
    next[index] = next[target]!;
    next[target] = moved;
    change(next);
  }

  function addField(field: BuilderField) {
    if (used.has(field.key) || items.length >= MAX_FIELDS) return;
    change([...items, field]);
    setAddOpen(false);
  }

  async function save() {
    setBusy(true);
    setFailure(null);
    try {
      const result = await saveFormFieldsAction({
        workspaceId,
        id: formId,
        fields: items.map(toBody),
      });
      if (result.status === 'error') {
        setFailure(result.detail === '' ? t('saveFailed') : result.detail);
        return;
      }
      setDirty(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card gap="gutter" data-testid="field-builder">
      <CardTitle>{t('title')}</CardTitle>

      <div className="flex flex-col gap-[var(--spacing-hairline)]">
        <p className="text-meta text-text-muted">{t('lead')}</p>
        {/* Strop je číslo, které se čte po číslicích, proto mono. */}
        <p className="font-mono text-meta text-text-muted" data-testid="field-limit">
          {left > 0 ? t('limit', { max: MAX_FIELDS, left }) : t('limitReached')}
        </p>
      </div>

      {failure !== null && (
        <Alert tone="error" data-testid="field-builder-error">
          {failure}
        </Alert>
      )}

      {/* Pole vlevo, náhled vpravo. Náhled musí být vidět zároveň se seznamem,
          jinak se uživatel proklikává nahoru a dolů a nepozná, co která změna
          udělala. Pod 360 px na sloupec se to sesype pod sebe. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(360px,100%),1fr))] items-start gap-[var(--spacing-gutter)]">
        <div className="flex flex-col gap-[var(--spacing-stack)]">
          {/* `role="list"` na `div`u, protože položkou je karta a `Card` vykresluje
              `section`, `div`, `article` nebo `aside`, ne `li`. Čtečka díky rolím
              přečte totéž co u `ul`/`li`. */}
          <div
            role="list"
            className="flex flex-col gap-[var(--spacing-stack)]"
            data-testid="field-list"
          >
            {items.map((item, index) => {
              const locked = item.target === 'email';
              return (
                <Card
                  as="div"
                  tone="muted"
                  padding="sm"
                  key={item.key}
                  data-testid={`field-${item.key}`}
                  className="gap-3"
                  role="listitem"
                >
                  <div className="flex flex-wrap items-center gap-[var(--spacing-inline)]">
                    {/* Klíč je technický údaj do API, čte se po znacích. */}
                    <span className="font-mono text-meta text-text-muted">{item.key}</span>
                    {/* Typ vedle klíče, a to POJMENOVANÝ. Uložená definice nese
                        značku vstupu (`checkbox`, `textarea`), takže bez převodu
                        by tu stálo `checkbox` u pole, které se zakládalo jako
                        „Ano/ne". */}
                    <span className="text-meta text-text-muted">{typeLabel(item.type)}</span>
                    {locked && (
                      <Badge tone="neutral" icon={CheckIcon} className="ml-auto">
                        {t('required')}
                      </Badge>
                    )}
                  </div>

                  <Field label={t('labelInput', { name: item.key })}>
                    <Input
                      data-testid={`field-label-${item.key}`}
                      value={item.label}
                      disabled={!canEdit}
                      onChange={(event) => {
                        const next = [...items];
                        next[index] = { ...item, label: event.target.value };
                        change(next);
                      }}
                    />
                  </Field>

                  <div className="flex flex-wrap items-center gap-[var(--spacing-gutter)]">
                    <label className="flex items-center gap-[var(--spacing-inline)] text-ui text-text">
                      <Switch
                        checked={item.required}
                        disabled={!canEdit || locked}
                        aria-label={t('requiredToggle', { name: item.key })}
                        onCheckedChange={(next) => {
                          const copy = [...items];
                          copy[index] = { ...item, required: next };
                          change(copy);
                        }}
                      />
                      {item.required ? t('required') : t('optional')}
                    </label>

                    {canEdit && (
                      <div className="ml-auto flex items-center gap-[var(--spacing-inline)]">
                        {/* Pořadí klávesnicí i myší jednou cestou, viz hlavička.
                            Šipky jsou ikony z Lucide, ne znaky ↑ a ↓: znak se
                            kreslí písmem a v jiné velikosti než zbytek rozhraní. */}
                        <Button
                          variant="ghost"
                          size="sm"
                          data-testid={`field-up-${item.key}`}
                          aria-label={t('moveUp', { label: item.label })}
                          onClick={() => move(index, -1)}
                        >
                          <ArrowUp aria-hidden className="icon-sm" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          data-testid={`field-down-${item.key}`}
                          aria-label={t('moveDown', { label: item.label })}
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDown aria-hidden className="icon-sm" />
                        </Button>
                        {!locked && (
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`field-remove-${item.key}`}
                            aria-label={t('remove', { label: item.label })}
                            onClick={() =>
                              change(items.filter((_, position) => position !== index))
                            }
                          >
                            <X aria-hidden className="icon-sm" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Důvod stojí u pole, ne v nápovědě: uživatel ho hledá tam, kde
                      čeká tlačítko na odebrání. */}
                  {locked && (
                    <p className="text-meta text-text-muted" data-testid="email-locked">
                      {t('emailLocked')}
                    </p>
                  )}

                  {item.options !== undefined && (
                    <p className="text-meta text-text-muted">{t('optionsFromField')}</p>
                  )}
                </Card>
              );
            })}
          </div>

          {canEdit && (
            <div className="flex flex-wrap items-center gap-[var(--spacing-inline)]">
              <Button
                variant="secondary"
                data-testid="add-field"
                disabled={left <= 0}
                onClick={() => setAddOpen(true)}
              >
                <Plus aria-hidden className="icon-md" />
                {t('add')}
              </Button>
              <Button
                variant="primary"
                data-testid="save-fields"
                pending={busy}
                pendingLabel={tc('save')}
                // Primární tlačítko `disabled` nepřijímá (princip P5): zůstane
                // klikatelné a uložení bez změn prostě nic neposílá.
                onClick={() => {
                  if (!dirty) return;
                  void save();
                }}
              >
                <Save aria-hidden className="icon-md" />
                {tc('save')}
              </Button>
            </div>
          )}
        </div>

        <UnstyledFormPreview items={items} />
      </div>

      <AddFieldDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        contactFields={contactFields}
        used={used}
        locale={locale}
        onPick={addField}
        onCreateNew={() => {
          setAddOpen(false);
          setNewFieldOpen(true);
        }}
      />

      <NewContactFieldDialog
        open={newFieldOpen}
        onOpenChange={setNewFieldOpen}
        workspaceId={workspaceId}
        onCreated={(field) => {
          setNewFieldOpen(false);
          addField(field);
        }}
      />
    </Card>
  );
}

function AddFieldDialog({
  open,
  onOpenChange,
  contactFields,
  used,
  locale,
  onPick,
  onCreateNew,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactFields: ContactFieldOption[];
  used: Set<string>;
  locale: string;
  onPick: (field: BuilderField) => void;
  onCreateNew: () => void;
}) {
  const t = useTranslations('forms.fields');
  const tc = useTranslations('common.actions');
  const typeLabel = useFieldTypeLabel();
  const targetLabel = useContactTargetLabel();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle>{t('addTitle')}</DialogTitle>
      <DialogBody>
        <div className="flex max-h-[52vh] flex-col gap-[var(--spacing-gutter)] overflow-y-auto pr-1">
          <section className="flex flex-col gap-[var(--spacing-inline)]">
            <h3 className="meta-caps text-text-muted">{t('targetContact')}</h3>
            {CONTACT_TARGETS.map((candidate) => {
              const label = targetLabel(candidate.target);
              const taken = used.has(candidate.target);
              return (
                <Button
                  key={candidate.target}
                  variant="secondary"
                  className="justify-start"
                  data-testid={`pick-${candidate.target}`}
                  disabled={taken}
                  onClick={() => {
                    if (taken) return;
                    onPick({
                      key: candidate.target,
                      target: candidate.target,
                      // POPISEK JE ČESKY, ne `first_name`. Tahle hodnota není
                      // jen do nabídky: jde rovnou do definice formuláře a
                      // veřejná stránka ji ukazuje návštěvníkovi u vstupu.
                      label,
                      required: candidate.target === 'email',
                      type: candidate.type,
                    });
                  }}
                >
                  {/* Zašedlá volba říká DŮVOD, stejně jako u vlastních polí:
                      jinak uživatel hledá, proč pole nejde vybrat. */}
                  {label}
                  {taken ? ` · ${t('alreadyUsed')}` : ''}
                </Button>
              );
            })}
          </section>

          <section className="flex flex-col gap-[var(--spacing-inline)]">
            <h3 className="meta-caps text-text-muted">{t('targetCustom')}</h3>
            {contactFields.map((field) => {
              const inputType = INPUT_TYPE_FOR[field.type];
              const key = `attr_${field.key}`;
              // Nepodporovaný typ se nabídne ZAŠEDLE s důvodem, ne že by zmizel:
              // uživatel jinak hledá pole, které v katalogu vidí.
              const reason =
                inputType === undefined
                  ? t('multiEnumUnsupported')
                  : used.has(key)
                    ? t('alreadyUsed')
                    : undefined;
              const values = (field.options['values'] as string[] | undefined) ?? [];
              return (
                <Button
                  key={field.id}
                  variant="secondary"
                  className="justify-start"
                  data-testid={`pick-attr-${field.key}`}
                  disabled={reason !== undefined}
                  onClick={() => {
                    if (reason !== undefined || inputType === undefined) return;
                    onPick({
                      key,
                      target: { attribute: field.key },
                      label: field.label[locale] ?? field.label['en'] ?? field.key,
                      required: field.required,
                      type: inputType,
                      // Hodnoty se PŘEBÍRAJÍ z vlastního pole. Kdyby je uživatel psal
                      // podruhé a rozešly se, zápis by neprošel `coerceValue`.
                      ...(inputType === 'select'
                        ? { options: values.map((value) => ({ value, label: value })) }
                        : {}),
                    });
                  }}
                >
                  {/* Zašedlá volba musí říct DŮVOD, jinak uživatel hledá, proč
                      pole z katalogu nejde vybrat. Typ stojí vedle popisku
                      pojmenovaný: ze samotného „VIP" nepoznám, jestli do
                      formuláře přibude zaškrtávátko, nebo řádek na text. */}
                  {field.label[locale] ?? field.label['en'] ?? field.key}
                  {` · ${typeLabel(field.type)}`}
                  {reason === undefined ? '' : ` · ${reason}`}
                </Button>
              );
            })}
          </section>

          <section className="flex flex-col gap-[var(--spacing-inline)]">
            <h3 className="meta-caps text-text-muted">{t('newFieldGroup')}</h3>
            <Button
              variant="secondary"
              className="justify-start"
              data-testid="new-contact-field"
              onClick={onCreateNew}
            >
              <Plus aria-hidden className="icon-md" />
              {t('newField')}
            </Button>
          </section>
        </div>
      </DialogBody>
      <DialogFooter
        retreat={
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
        }
        confirm={<span />}
      />
    </Dialog>
  );
}

/** Typy vlastního pole, které jde formulářem sbírat. `multi_enum` mezi nimi není. */
const NEW_FIELD_TYPES = ['text', 'long_text', 'number', 'boolean', 'date', 'url', 'phone'] as const;

function NewContactFieldDialog({
  open,
  onOpenChange,
  workspaceId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  onCreated: (field: BuilderField) => void;
}) {
  const t = useTranslations('forms.fields');
  const tc = useTranslations('common.actions');
  const typeLabel = useFieldTypeLabel();
  const typeHint = useFieldTypeHint();
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [type, setType] = useState<string>('text');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setFailure(null);
    try {
      const result = await createContactFieldAction({ workspaceId, key, label, type });
      if (result.status === 'error') {
        setFailure(result.detail === '' ? t('newFieldFailed') : result.detail);
        return;
      }
      onCreated({
        key: `attr_${result.key}`,
        target: { attribute: result.key },
        label,
        required: false,
        type: INPUT_TYPE_FOR[type] ?? 'text',
      });
      setLabel('');
      setKey('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle>{t('newFieldTitle')}</DialogTitle>
      <DialogBody>
        <div className="flex flex-col gap-[var(--spacing-gutter)]">
          <Field label={t('newFieldLabel')}>
            <Input
              data-testid="new-field-label"
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
                // Klíč se odvozuje z popisku, dokud si ho uživatel nepřepíše sám.
                // Psát ho ručně je práce navíc a nejčastější zdroj překlepů.
                setKey(
                  event.target.value
                    .normalize('NFD')
                    .replace(/[̀-ͯ]/g, '')
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '_')
                    .replace(/^_+|_+$/g, '')
                    .slice(0, 40),
                );
              }}
            />
          </Field>

          <Field label={t('newFieldKey')} hint={t('newFieldKeyHint')}>
            <Input
              data-testid="new-field-key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
          </Field>

          <div data-testid="new-field-type" className="flex flex-col gap-1.5">
            <span aria-hidden className="text-sm font-semibold text-text">
              {t('newFieldType')}
            </span>
            <Select
              value={type}
              onValueChange={setType}
              placeholder={t('newFieldType')}
              aria-label={t('newFieldType')}
            >
              {/* V nabídce stálo `boolean`, `long_text` a `url`, tedy jména z DDL.
                  Uživatel u `boolean` nevěděl, co se do pole zadává. Nabízí se
                  proto česky („Ano/ne"), a co typ znamená, řekne řádek pod
                  výběrem, ne až chyba při ukládání. */}
              {NEW_FIELD_TYPES.map((candidate) => (
                <SelectItem key={candidate} value={candidate}>
                  {typeLabel(candidate)}
                </SelectItem>
              ))}
            </Select>
            {/* Nápověda se mění s volbou, takže NENÍ v `Field hint`: ten by ji
                přečetl jednou při složení a u výběru je smysl volby to jediné,
                co uživatel hledá. `aria-live` ji řekne i čtečce. */}
            {typeHint(type) === null ? null : (
              <p
                aria-live="polite"
                data-testid="new-field-type-hint"
                className="text-meta text-text-muted"
              >
                {typeHint(type)}
              </p>
            )}
          </div>

          {failure !== null && (
            <Alert tone="error" data-testid="new-field-error">
              {failure}
            </Alert>
          )}
        </div>
      </DialogBody>
      <DialogFooter
        retreat={
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
        }
        confirm={
          <Button
            variant="primary"
            data-testid="new-field-submit"
            pending={busy}
            pendingLabel={t('newFieldPending')}
            onClick={() => void submit()}
          >
            {t('newFieldSubmit')}
          </Button>
        }
      />
    </Dialog>
  );
}
