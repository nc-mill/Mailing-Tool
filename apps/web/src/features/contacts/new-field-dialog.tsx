'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { Select, SelectItem } from '@mlain/ui/components/select';
import { Alert } from '@mlain/ui/patterns/states';
import { useFieldTypeHint, useFieldTypeLabel } from '@/lib/ui/field-type-label';
import { createFieldAction } from './actions';

/**
 * ZALOŽENÍ VLASTNÍHO POLE Z NASTAVENÍ.
 *
 * Dialog vznikl 7. 8. 2026 k nálezu „tlačítko Přidat pole nemá obsluhu".
 * Tabulka polí měla archivaci i mazání, ale založit pole odsud nešlo: jediná
 * cesta k novému poli vedla oklikou přes stavitele polí formuláře.
 *
 * Je to VLASTNÍ komponenta, ne sdílená s `features/forms/field-builder.tsx`,
 * a rozdíl není kosmetický: tam dialog po založení pole rovnou VLOŽÍ do
 * rozestavěného formuláře a volá jinou serverovou akci, která překresluje
 * detail formuláře. Tady po založení stačí překreslit tabulku. Sdílet by šla
 * leda výplň (popisek, klíč, typ), a to je málo na to, aby si dvě obrazovky
 * začaly navzájem diktovat chování po uložení.
 */

/**
 * Typy, které jde založit odsud.
 *
 * `enum` a `multi_enum` mezi nimi NEJSOU, a je to vědomé omezení, ne opomenutí:
 * obojí je bez seznamu povolených hodnot k ničemu a to je samostatný ovládací
 * prvek (přidávání a mazání hodnot, kontrola duplicit). Nabídnout je bez něj by
 * znamenalo založit pole, do kterého nejde uložit nic. Zapsané v STAV-UKOLU.md.
 */
const NEW_FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'boolean',
  'date',
  'datetime',
  'url',
  'email',
  'phone',
] as const;

/** Klíč z popisku: bez diakritiky, malými písmeny, podtržítka místo mezer. */
export function keyFromLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export function NewFieldDialog({
  open,
  onOpenChange,
  workspaceId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  /** Zavolá se po úspěchu. Tabulka si podle toho vyžádá nová data ze serveru. */
  onCreated: () => void;
}) {
  const t = useTranslations('contacts.fields');
  const tc = useTranslations('common.actions');
  const typeLabel = useFieldTypeLabel();
  const typeHint = useFieldTypeHint();
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [type, setType] = useState<string>('text');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const incomplete = label.trim() === '' || key.trim() === '';

  async function submit() {
    setBusy(true);
    setFailure(null);
    try {
      const result = await createFieldAction({ workspaceId, key, label, type });
      if (result.status === 'error') {
        // Věta ze serveru má přednost: „klíč už existuje" a „strop polí" jsou
        // dvě různé příčiny a obecná hláška by je slila do jedné.
        setFailure(result.detail === '' ? t('createFailed') : result.detail);
        return;
      }
      setLabel('');
      setKey('');
      setType('text');
      onOpenChange(false);
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle>{t('createTitle')}</DialogTitle>
      <DialogBody>
        <div className="flex flex-col gap-[var(--spacing-gutter)]">
          <Field label={t('createLabel')}>
            <Input
              data-testid="new-field-label"
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
                // Klíč se odvozuje z popisku, dokud si ho uživatel nepřepíše sám.
                // Psát ho ručně je práce navíc a nejčastější zdroj překlepů.
                setKey(keyFromLabel(event.target.value));
              }}
            />
          </Field>

          <Field label={t('createKey')} hint={t('createKeyHint')}>
            <Input
              data-testid="new-field-key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
          </Field>

          <div data-testid="new-field-type" className="flex flex-col gap-1.5">
            <span aria-hidden className="text-sm font-semibold text-text">
              {t('createType')}
            </span>
            <Select
              value={type}
              onValueChange={setType}
              placeholder={t('createType')}
              aria-label={t('createType')}
            >
              {/* Typy se nabízejí POJMENOVANĚ. `boolean` a `long_text` jsou jména
                  z DDL a uživateli neřeknou, co se do pole zadává. */}
              {NEW_FIELD_TYPES.map((candidate) => (
                <SelectItem key={candidate} value={candidate}>
                  {typeLabel(candidate)}
                </SelectItem>
              ))}
            </Select>
            {typeHint(type) === null ? null : (
              // Nápověda se mění s volbou, takže není v `Field hint`: ten by se
              // přečetl jednou při složení. `aria-live` ji řekne i čtečce.
              <p
                aria-live="polite"
                data-testid="new-field-type-hint"
                className="text-meta text-text-muted"
              >
                {typeHint(type)}
              </p>
            )}
            {/* Volba typu je nevratná, takže to musí zaznít PŘED uložením, ne až
                u pokusu o změnu. API mění typ zakázané (`field_type_immutable`). */}
            <p className="text-meta text-text-muted">{t('createTypeLocked')}</p>
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
            pendingLabel={t('createPending')}
            // Primární tlačítko se v tomhle systému NEZAKAZUJE (princip P5):
            // místo zašedlého tlačítka se řekne, co zbývá udělat. Nevyplněný
            // popisek nebo klíč by jinak skončil na 422 z API.
            {...(incomplete ? { unavailableReason: t('createIncomplete') } : {})}
            onClick={() => void submit()}
          >
            {t('createSubmit')}
          </Button>
        }
      />
    </Dialog>
  );
}
