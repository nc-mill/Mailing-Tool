'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@mlain/i18n/navigation';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { Textarea } from '@mlain/ui/components/textarea';
import { ReadOnlyValue } from '@mlain/ui/patterns/states';
import { SelectField } from '@/lib/forms/select-field';
import { localeLabel } from '@/lib/i18n/locale-label';
import { SubmitButton } from '@/lib/forms/submit-button';
import { useFormErrorFocus } from '@/lib/forms/use-form-error-focus';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import type { Workspace } from '@/lib/identity/workspace-access';

export type GeneralFormProps = {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  workspace: Workspace;
  locales: readonly string[];
  timezones: readonly string[];
  canWrite: boolean;
  initialState?: ActionState | undefined;
};

/**
 * Vysvětlivku pod hodnotou skládá volající, protože `ReadOnlyValue` z P05
 * bere `value` jako `ReactNode`. Vlastní kopii komponenty si P06 nepíše:
 * dvě jména pro totéž ve dvou balíčcích se dřív nebo později rozejdou.
 */
function valueWithHint(value: string, hint?: string) {
  if (hint === undefined) return value;
  return (
    <>
      {value}
      <span className="mt-1 block text-meta text-text-muted">{hint}</span>
    </>
  );
}

/** Adresa Můj účet. Prefix jazyka doplní `Link` z `@mlain/i18n/navigation`. */
const PROFILE_PATH = '/settings/profile';

/**
 * Odkaz z jazyka projektu na jazyk rozhraní.
 *
 * Zadavatel si přepnul „Jazyk projektu" a čekal, že se přepne celé rozhraní.
 * Jsou to dvě různá nastavení a nápověda sama o sobě člověka jen odmítne;
 * odkaz ho pošle tam, kde to opravdu přepne. Míří se na ADRESU profilu,
 * ne na položku v menu Nastavení, protože ta z nabídky mizí.
 *
 * `Link` je z `@mlain/i18n/navigation`, aby v anglickém rozhraní odkaz mířil
 * na `/en/settings/profile`. S `next/link` by spadl na českou cestu.
 */
function InterfaceLocaleLink({ label }: { label: string }) {
  return (
    <p className="text-meta">
      <Link className="text-accent-text underline underline-offset-4" href={PROFILE_PATH}>
        {label}
      </Link>
    </p>
  );
}

export function GeneralForm({
  action,
  workspace,
  locales,
  timezones,
  canWrite,
  initialState,
}: GeneralFormProps) {
  const t = useTranslations('settings');
  const uiLocale = useLocale();
  const [state, formAction] = useActionState(action, initialState ?? IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};
  useFormErrorFocus(fieldErrors, formRef);

  const [savedVisible, setSavedVisible] = useState(state.status === 'success');
  useEffect(() => {
    if (state.status !== 'success') return;
    setSavedVisible(true);
    const timer = window.setTimeout(() => setSavedVisible(false), 3000);
    return () => window.clearTimeout(timer);
  }, [state]);

  if (!canWrite) {
    return (
      <Card aria-labelledby="general-identity" gap="gutter">
        <div className="flex flex-col gap-[var(--spacing-hairline)]">
          <CardTitle>
            <span id="general-identity">{t('general.identityTitle')}</span>
          </CardTitle>
          <p className="text-meta text-text-muted">{t('states.readOnlyTitle')}</p>
        </div>
        <div className="flex flex-col gap-[var(--spacing-stack)]">
          <ReadOnlyValue label={t('general.name')} value={workspace.name} />
          <ReadOnlyValue label={t('general.slug')} value={workspace.slug} />
          <div className="flex flex-col gap-[var(--spacing-hairline)]">
            <ReadOnlyValue
              label={t('general.locale')}
              value={valueWithHint(workspace.locale, t('general.localeHint'))}
            />
            <InterfaceLocaleLink label={t('general.localeUiLink')} />
          </div>
          <ReadOnlyValue
            label={t('general.timezone')}
            value={valueWithHint(workspace.timezone, t('general.timezoneHint'))}
          />
          {/* Nevyplněná adresa se NEskrývá. Je to údaj, který musí obchodní
              sdělení nést, takže i ten, kdo ho měnit nesmí, má vidět, že chybí. */}
          <ReadOnlyValue
            label={t('general.postalAddress')}
            value={valueWithHint(
              workspace.postal_address === ''
                ? t('general.postalAddressEmpty')
                : workspace.postal_address,
              t('general.postalAddressHint'),
            )}
          />
        </div>
      </Card>
    );
  }

  return (
    // Karta odpovídá sekci „Základní údaje" na detailu seznamu: okraj 30 px,
    // mezera 20 px mezi nadpisem a poli, nadpis 19 px.
    <Card aria-labelledby="general-identity" gap="gutter">
      <div className="flex items-baseline gap-[var(--spacing-stack)]">
        <CardTitle>
          <span id="general-identity">{t('general.identityTitle')}</span>
        </CardTitle>
        {/* Hlásič musí být v DOM pořád, i prázdný: čtečka ohlásí až změnu
            obsahu živé oblasti, ne její vznik. */}
        <p role="status" className="ml-auto font-mono text-meta text-text-muted">
          {savedVisible ? t('shared.saved') : ''}
        </p>
      </div>

      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <SettingsProblem problem={state.problem} />
      ) : null}

      <form
        ref={formRef}
        action={formAction}
        className="flex flex-col gap-[var(--spacing-gutter)]"
        noValidate
      >
        <input type="hidden" name="workspace_id" value={workspace.id} readOnly />
        <input type="hidden" name="current_slug" value={workspace.slug} readOnly />

        {/* `Field` propojí popisek, nápovědu i chybu sám. Dřív se tu skládal
            popisek, dvě nápovědy a chyba ručně a `aria-describedby` mířilo
            jenom na chybu, takže nápovědu čtečka nikdy nepřečetla. */}
        <Field
          label={t('general.name')}
          {...(fieldErrors['name'] ? { error: fieldErrors['name'].join(' ') } : {})}
        >
          <Input name="name" defaultValue={workspace.name} />
        </Field>

        <div className="flex flex-col gap-[var(--spacing-hairline)]">
          <Field
            label={t('general.slug')}
            hint={t('general.slugHint', { slug: workspace.slug })}
            {...(fieldErrors['slug'] ? { error: fieldErrors['slug'].join(' ') } : {})}
          >
            <Input name="slug" defaultValue={workspace.slug} />
          </Field>
          {/* Varování stojí mimo `Field`, protože nese vlastní tón. Není to
              nápověda k vyplnění, ale následek změny. */}
          <p className="text-meta text-warning-text">{t('general.slugChangeWarning')}</p>
        </div>

        {/* Odkaz stojí mimo `SelectField` ze stejného důvodu jako varování
            u adresy: `hint` je řetězec, ne uzel, a nápověda k vyplnění není
            totéž co rozcestník jinam. */}
        <div className="flex flex-col gap-[var(--spacing-hairline)]">
          <SelectField
            name="locale"
            label={t('general.locale')}
            placeholder={t('shared.selectPlaceholder')}
            defaultValue={workspace.locale}
            options={locales.map((locale) => ({
              value: locale,
              label: localeLabel(locale, uiLocale),
            }))}
            hint={t('general.localeHint')}
            errors={fieldErrors}
          />
          <InterfaceLocaleLink label={t('general.localeUiLink')} />
        </div>

        <SelectField
          name="timezone"
          label={t('general.timezone')}
          placeholder={t('shared.selectPlaceholder')}
          defaultValue={workspace.timezone}
          options={timezones.map((zone) => ({ value: zone, label: zone }))}
          hint={t('general.timezoneHint')}
          errors={fieldErrors}
        />

        {/* Poštovní adresa odesílatele. Je to víceřádkový údaj (firma, ulice,
            město), proto textové pole, a sází se do patičky přesně tak, jak ji
            uživatel napíše. Hodnotu bere merge tag `{{ workspace.sender_address }}`
            ve výchozí patičce; dokud je prázdná, odchází patička bez adresy
            a kontrolní seznam před odesláním na to upozorní. */}
        <Field
          label={t('general.postalAddress')}
          hint={t('general.postalAddressHint')}
          {...(fieldErrors['postal_address']
            ? { error: fieldErrors['postal_address'].join(' ') }
            : {})}
        >
          <Textarea
            name="postal_address"
            rows={3}
            maxLength={500}
            defaultValue={workspace.postal_address}
            placeholder={t('general.postalAddressPlaceholder')}
          />
        </Field>

        {/* Hlavní akce karty stojí vlevo dole, jako „Nastavit jako výchozí"
            v sekci Výchozí seznam projektu na detailu seznamu. */}
        <div className="flex">
          <SubmitButton label={t('shared.save')} pendingLabel={t('shared.saving')} />
        </div>
      </form>
    </Card>
  );
}
