'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { Select, SelectItem } from '@mlain/ui/components/select';
import { Alert } from '@mlain/ui/patterns/states';
import type { FormActionResult } from './actions';
import type { ListOption } from './types';

/**
 * Hodnota „zatím do žádného seznamu". Prázdný řetězec by `Select` z radix-ui
 * odmítl: prázdnou hodnotu si drží pro stav „nevybráno" a položka s ní vyhodí
 * výjimku. Sentinel je proto slovo, které se nikdy nepotká s UUID seznamu.
 */
const NO_LIST = 'none';

/**
 * Dialog na založení formuláře.
 *
 * Ptá se na DVĚ VĚCI, ne na celou definici. Formulář má patnáct nastavení, ale
 * rozhodnutí, které nejde odložit, je jediné: do kterého seznamu zapisuje. Zbytek
 * má výchozí hodnotu z domény (zapnuté potvrzování e-mailem, pole pro e-mail,
 * vypnuté ochrany od cizích firem) a mění se na detailu, kde k tomu je místo
 * a vysvětlení.
 */
export function CreateFormDialog({
  open,
  onOpenChange,
  lists,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lists: ListOption[];
  onSubmit: (body: { name: string; list_ids: string[] }) => Promise<FormActionResult>;
}) {
  const t = useTranslations('forms.create');
  const tc = useTranslations('common.actions');
  const [name, setName] = useState('');
  // Výchozí je první seznam projektu, ne „nikam": formulář, který nikoho nikam
  // nepřihlásí, je skoro vždycky omyl, ne úmysl.
  const [listId, setListId] = useState<string>(lists[0]?.id ?? NO_LIST);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Dialog zůstává namountovaný i zavřený, takže by druhé otevření ukázalo
  // hodnoty z prvního. Stav se proto sype při každém otevření.
  useEffect(() => {
    if (!open) return;
    setName('');
    setListId(lists[0]?.id ?? NO_LIST);
    setErrors({});
    setFailure(null);
    // `lists` do závislostí nepatří: je to nové pole při každém renderu rodiče,
    // takže by se stav sypal i uprostřed vyplňování.
  }, [open]);

  async function submit() {
    if (name.trim() === '') {
      setErrors({ name: t('failed') });
      return;
    }
    setErrors({});
    setFailure(null);
    setPending(true);
    try {
      const result = await onSubmit({
        name: name.trim(),
        list_ids: listId === NO_LIST ? [] : [listId],
      });
      if (result.status === 'error') {
        if (Object.keys(result.fieldErrors).length > 0) setErrors(result.fieldErrors);
        else setFailure(result.detail === '' ? t('failed') : result.detail);
        return;
      }
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle>{t('title')}</DialogTitle>
      <DialogBody>
        <div className="flex flex-col gap-[var(--spacing-gutter)]">
          <Field
            label={t('name')}
            hint={t('nameHint')}
            {...(errors['name'] === undefined ? {} : { error: errors['name'] })}
          >
            <Input
              data-testid="form-name"
              autoComplete="off"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>

          <div data-testid="form-list-select" className="flex flex-col gap-1.5">
            {/* `Select` z radix-ui popisek nepřijímá, proto vlastní `span` se stejným
                řezem, jaký dodává `Field` u ostatních polí. Vazbu na čtečku drží
                `aria-label` na samotné nabídce, `span` je jen vidět. */}
            <span aria-hidden className="text-sm font-semibold text-text">
              {t('list')}
            </span>
            <Select
              value={listId}
              onValueChange={setListId}
              placeholder={t('listNone')}
              aria-label={t('list')}
            >
              <SelectItem value={NO_LIST}>{t('listNone')}</SelectItem>
              {lists.map((list) => (
                <SelectItem key={list.id} value={list.id}>
                  {list.name}
                </SelectItem>
              ))}
            </Select>
            <p className="text-meta text-text-muted">{t('listHint')}</p>
          </div>

          {failure !== null && (
            <Alert tone="error" data-testid="create-form-error">
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
            data-testid="create-form-submit"
            pending={pending}
            pendingLabel={t('pending')}
            onClick={() => void submit()}
          >
            {t('submit')}
          </Button>
        }
      />
    </Dialog>
  );
}
