'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { Alert } from '@mlain/ui/patterns/states';
import { renameFieldAction } from './actions';
import { nextFieldLabels } from './field-labels';
import type { ContactFieldRow } from './fields-table';

/**
 * PŘEJMENOVÁNÍ VLASTNÍHO POLE.
 *
 * Nález z ostrého provozu: v projektu leželo pole pojmenované „boolen", které
 * nešlo ani přejmenovat, ani smazat, protože obrazovka správy polí neměla trasu.
 * Trasa už je; přejmenování je druhá půlka téže opravy. Bez něj je každé omylem
 * založené pole v projektu napořád.
 *
 * MĚNÍ SE POPISEK, NIKDY KLÍČ A NIKDY TYP. Klíč je jméno v API a v importu, takže
 * jeho změna by rozbila každý běžící import a každé volání zvenčí; typ přetypovat
 * nejde vůbec (`field_type_immutable`). Obojí proto zůstává v dialogu vidět jako
 * text, ne jako pole k úpravě: uživatel musí vědět, co se nemění, jinak bude
 * hledat, proč se „to druhé" nepřepsalo.
 */
export function RenameFieldDialog({
  field,
  workspaceId,
  locale,
  onOpenChange,
  onRenamed,
}: {
  /** Pole k přejmenování, nebo `null`, když je dialog zavřený. */
  field: ContactFieldRow | null;
  workspaceId: string;
  /** Jazyk rozhraní. Přepisuje se JEN tenhle jazyk popisku, viz `field-labels.ts`. */
  locale: string;
  onOpenChange: (open: boolean) => void;
  onRenamed: () => void;
}) {
  const t = useTranslations('contacts.fields');
  const tc = useTranslations('common.actions');
  const [value, setValue] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Předvyplní se dosavadní jméno, jakmile se dialog otevře nad jiným polem.
  // Bez toho by v poli zůstal text z minulého otevření a přejmenování by tiše
  // přepsalo jiné pole týmž jménem.
  useEffect(() => {
    setValue(field?.label ?? '');
    setFailure(null);
  }, [field]);

  async function submit() {
    if (field === null) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await renameFieldAction({
        workspaceId,
        id: field.id,
        label: nextFieldLabels(field.labels, locale, value.trim()),
      });
      if (result.status === 'error') {
        setFailure(result.detail === '' ? t('renameFailed') : result.detail);
        return;
      }
      onOpenChange(false);
      onRenamed();
    } finally {
      setBusy(false);
    }
  }

  const unchanged = value.trim() === '' || value.trim() === field?.label;

  return (
    <Dialog open={field !== null} onOpenChange={onOpenChange}>
      <DialogTitle>{t('renameTitle', { label: field?.label ?? '' })}</DialogTitle>
      <DialogBody>
        <div className="flex flex-col gap-[var(--spacing-gutter)]">
          <Field label={t('createLabel')}>
            <Input
              data-testid="rename-field-label"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </Field>
          {/* Co se NEMĚNÍ, musí být vidět tady, ne až v chybě po uložení. */}
          <p className="text-meta text-text-muted" data-testid="rename-field-locked">
            {t('renameLocked', { key: field?.key ?? '' })}
          </p>

          {failure !== null && (
            <Alert tone="error" data-testid="rename-field-error">
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
            data-testid="rename-field-submit"
            pending={busy}
            pendingLabel={t('renamePending')}
            // Primární akce se nezakazuje (princip P5): řekne se, co zbývá.
            {...(unchanged ? { unavailableReason: t('renameUnchanged') } : {})}
            onClick={() => void submit()}
          >
            {t('renameSubmit')}
          </Button>
        }
      />
    </Dialog>
  );
}
