'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import type { Workspace } from '@/lib/identity/workspace-access';
import { updateAddressFormFormAction } from './actions-forms';

export type AddressForm = 'formal' | 'informal';

export type AddressFormSectionViewProps = {
  workspace: Workspace;
  canWrite: boolean;
  contactCount: number;
  action: (formData: FormData) => void;
};

const LABEL_KEYS = {
  formal: 'general.addressForm.formal',
  informal: 'general.addressForm.informal',
} as const satisfies Record<AddressForm, string>;

const EXAMPLE_KEYS = {
  formal: 'general.addressForm.formalExample',
  informal: 'general.addressForm.informalExample',
} as const satisfies Record<AddressForm, string>;

/**
 * Tvar do věty, tedy malým písmenem: „Nechat vykání", ne „Nechat Vykání".
 * Vlastní klíč, ne `toLowerCase()` nad popiskem: jazyk, který podstatná
 * jména píše velkým písmenem, by se tím rozbil a nikdo by si toho nevšiml.
 */
const INLINE_LABEL_KEYS = {
  formal: 'general.addressForm.formalInline',
  informal: 'general.addressForm.informalInline',
} as const satisfies Record<AddressForm, string>;

/**
 * ODCHYLKA OD PLÁNU, vynucená chováním Radixu: plán obaloval dvojici voleb
 * komponentou `RadioGroup` z P05 a **uvnitř** kreslil nativní `<input
 * type="radio">`. Radix `RadioGroup.Root` je `role="radiogroup"` se svou
 * vlastní obsluhou klávesnice a nativní přepínače uvnitř by mu braly fokus,
 * takže by šipky nefungovaly ani v jednom z obou mechanismů. Test žádá
 * `type="radio"`, tedy nativní prvek; obal se proto nepoužívá a skupinu
 * drží `<fieldset>` s legendou, což čtečce říká totéž.
 */
export function AddressFormSectionView({
  workspace,
  canWrite,
  contactCount,
  action,
}: AddressFormSectionViewProps) {
  const t = useTranslations('settings');
  const confirmLabels = useConfirmDialogLabels();
  const formRef = useRef<HTMLFormElement>(null);
  const [pendingValue, setPendingValue] = useState<AddressForm | null>(null);
  const current = workspace.address_form;

  if (!canWrite) {
    return (
      <section aria-labelledby="general-address-form">
        <h2 id="general-address-form" className="text-xl font-semibold">
          {t('general.addressForm.label')}
        </h2>
        <p className="mt-2 text-text-muted">{t('general.addressForm.hint')}</p>
        <p className="mt-4 font-medium">{t(LABEL_KEYS[current])}</p>
      </section>
    );
  }

  const target: AddressForm = pendingValue ?? (current === 'formal' ? 'informal' : 'formal');

  return (
    <section aria-labelledby="general-address-form">
      <h2 id="general-address-form" className="text-xl font-semibold">
        {t('general.addressForm.label')}
      </h2>
      <p className="mt-2 text-text-muted">{t('general.addressForm.hint')}</p>

      <form ref={formRef} action={action} className="mt-4">
        <input type="hidden" name="workspace_id" value={workspace.id} readOnly />
        <input type="hidden" name="slug" value={workspace.slug} readOnly />
        <input type="hidden" name="address_form" value={target} readOnly />

        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{t('general.addressForm.label')}</legend>
          {(['formal', 'informal'] as const).map((option) => (
            <label
              key={option}
              className="flex items-start gap-3 rounded-md border border-border p-3"
            >
              <input
                type="radio"
                name="address_form_choice"
                value={option}
                checked={(pendingValue ?? current) === option}
                onChange={() => {
                  if (option !== current) setPendingValue(option);
                }}
              />
              <span>
                <span className="font-medium">{t(LABEL_KEYS[option])}</span>
                <span className="mt-1 block text-sm text-text-muted">
                  {t(EXAMPLE_KEYS[option])}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <ConfirmDialog
          open={pendingValue !== null}
          onOpenChange={(open: boolean) => {
            if (!open) setPendingValue(null);
          }}
          level="N2"
          title={t('general.addressForm.dialogTitle', { target: t(INLINE_LABEL_KEYS[target]) })}
          consequences={[
            t('general.addressForm.dialogConsequence1', { count: contactCount }),
            t('general.addressForm.dialogConsequence2'),
            t('general.addressForm.dialogConsequence3'),
          ]}
          confirmLabel={t('general.addressForm.dialogConfirm', {
            target: t(INLINE_LABEL_KEYS[target]),
          })}
          cancelLabel={t('general.addressForm.dialogCancel', {
            current: t(INLINE_LABEL_KEYS[current]),
          })}
          // Přepnutí oslovení je vratné: přepne se zpátky a přepočet doběhne znovu.
          irreversible={false}
          onConfirm={() => formRef.current?.requestSubmit()}
          labels={confirmLabels}
        />
      </form>
    </section>
  );
}

/** Serverová obálka, aby stránka nemusela znát akci. */
export function AddressFormSection(props: Omit<AddressFormSectionViewProps, 'action'>) {
  return <AddressFormSectionView {...props} action={updateAddressFormFormAction} />;
}
