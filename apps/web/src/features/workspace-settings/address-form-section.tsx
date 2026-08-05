'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import type { Workspace } from '@/lib/identity/workspace-access';
import { updateAddressFormAction } from './actions';

export type AddressForm = 'formal' | 'informal';

export type AddressFormSectionViewProps = {
  workspace: Workspace;
  canWrite: boolean;
  contactCount: number;
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  initialState?: ActionState | undefined;
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
 *
 * OPRAVA VADY „tlačítko Přepnout nic nedělá". Sekce se skládala ze tří
 * nezávislých chyb, které dohromady daly přesně to, co uživatel popsal:
 *
 * 1. Výsledek akce se zahazoval. Obálka `updateAddressFormFormAction` vracela
 *    `void`, takže se nevykreslil ani úspěch (`general.addressForm.started`
 *    byl mrtvý klíč v katalogu), ani odmítnutí ze serveru.
 * 2. Po potvrzení nikdo nevynuloval `pendingValue`, takže dialog zůstal viset
 *    otevřený nad stránkou. Uživatel neviděl vůbec nic, ani kdyby se dole
 *    něco změnilo.
 * 3. Odesílalo se přes `<form action={…}>` a `requestSubmit()`. React 19 po
 *    doběhnutí akce formulář VYNULUJE (`form.reset()`), a protože atribut
 *    `checked` u řízeného přepínače React po připojení už nepřepisuje, reset
 *    vrátil tečku na původní volbu. Naměřeno: skryté pole mělo po odeslání
 *    `informal`, ale `input[value=formal].checked` bylo `true`.
 *
 * Sekce proto volá serverovou akci PŘÍMO v `useTransition`, stejně jako to
 * dělá `features/ai/credentials-section.tsx`. Transakce je podmínka toho, aby
 * `revalidatePath` uvnitř akce serverovou stránku opravdu překreslil; žádný
 * `<form>` v cestě není, takže není co nulovat, a hodnota se do `FormData`
 * skládá výslovně, ne podle toho, co zrovna zbylo v DOM.
 */
export function AddressFormSectionView({
  workspace,
  canWrite,
  contactCount,
  action,
  initialState,
}: AddressFormSectionViewProps) {
  const t = useTranslations('settings');
  const confirmLabels = useConfirmDialogLabels();
  const [state, setState] = useState<ActionState>(initialState ?? IDLE);
  const [pendingValue, setPendingValue] = useState<AddressForm | null>(null);
  /** Potvrzená volba, dokud se nevrátí ze serveru. Bez ní by tečka skočila zpátky. */
  const [chosen, setChosen] = useState<AddressForm | null>(null);
  const [, startTransition] = useTransition();
  const current = workspace.address_form;

  function submit(next: AddressForm) {
    setPendingValue(null);
    setChosen(next);
    setState(IDLE);
    startTransition(async () => {
      const formData = new FormData();
      formData.set('workspace_id', workspace.id);
      formData.set('address_form', next);
      const result = await action(IDLE, formData);
      setState(result);
      // Odmítnutou hodnotu přepínač dál ukazovat nesmí, byla by to tichá lež.
      if (result.status === 'error') setChosen(null);
    });
  }

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
  const selected: AddressForm = pendingValue ?? chosen ?? current;

  return (
    <section aria-labelledby="general-address-form">
      <h2 id="general-address-form" className="text-xl font-semibold">
        {t('general.addressForm.label')}
      </h2>
      <p className="mt-2 text-text-muted">{t('general.addressForm.hint')}</p>

      {state.status === 'success' ? (
        <p role="status" className="mt-4 text-text-muted">
          {t(state.messageKey)}
        </p>
      ) : null}
      {state.status === 'error' ? (
        <div className="mt-4">
          <SettingsProblem problem={state.problem} />
        </div>
      ) : null}

      <fieldset className="mt-4 flex flex-col gap-2">
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
              checked={selected === option}
              onChange={() => {
                if (option !== selected) setPendingValue(option);
              }}
            />
            <span>
              <span className="font-medium">{t(LABEL_KEYS[option])}</span>
              <span className="mt-1 block text-sm text-text-muted">{t(EXAMPLE_KEYS[option])}</span>
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
        onConfirm={() => submit(target)}
        labels={confirmLabels}
      />
    </section>
  );
}

/**
 * Obálka, která sekci dodá serverovou akci, aby ji stránka nemusela znát.
 *
 * Akce se předává v tvaru `(předchozí stav, FormData)`, tedy tak, jak ji píše
 * `./actions`. Dřív se předával mezitvar z `actions-forms.ts`, který výsledek
 * zahodil, takže se ani úspěch, ani chyba neměly kde vykreslit.
 */
export function AddressFormSection(props: Omit<AddressFormSectionViewProps, 'action'>) {
  return <AddressFormSectionView {...props} action={updateAddressFormAction} />;
}
