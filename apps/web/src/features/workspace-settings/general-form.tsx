'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { ReadOnlyValue } from '@mlain/ui/patterns/states';
import { SelectField } from '@/lib/forms/select-field';
import { localeLabel } from '@/lib/i18n/locale-label';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
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
      <span className="mt-1 block text-sm text-text-muted">{hint}</span>
    </>
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
      <section aria-labelledby="general-identity">
        <h2 id="general-identity" className="text-xl font-semibold">
          {t('general.title')}
        </h2>
        <p className="mt-2 text-text-muted">{t('states.readOnlyTitle')}</p>
        <div className="mt-4 space-y-4">
          <ReadOnlyValue label={t('general.name')} value={workspace.name} />
          <ReadOnlyValue label={t('general.slug')} value={workspace.slug} />
          <ReadOnlyValue
            label={t('general.locale')}
            value={valueWithHint(workspace.locale, t('general.localeHint'))}
          />
          <ReadOnlyValue
            label={t('general.timezone')}
            value={valueWithHint(workspace.timezone, t('general.timezoneHint'))}
          />
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="general-identity">
      <div className="flex items-baseline justify-between">
        <h2 id="general-identity" className="text-xl font-semibold">
          {t('general.title')}
        </h2>
        <p role="status" className="text-sm text-text-muted">
          {savedVisible ? t('shared.saved') : ''}
        </p>
      </div>

      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <div className="mt-4">
          <SettingsProblem problem={state.problem} />
        </div>
      ) : null}

      <form ref={formRef} action={formAction} className="mt-4" noValidate>
        <input type="hidden" name="workspace_id" value={workspace.id} readOnly />
        <input type="hidden" name="current_slug" value={workspace.slug} readOnly />

        <div className="mb-4">
          <Label htmlFor="name">{t('general.name')}</Label>
          <Input
            id="name"
            name="name"
            defaultValue={workspace.name}
            {...fieldAria('name', fieldErrors)}
          />
          <FieldError name="name" errors={fieldErrors} />
        </div>

        <div className="mb-4">
          <Label htmlFor="slug">{t('general.slug')}</Label>
          <Input
            id="slug"
            name="slug"
            defaultValue={workspace.slug}
            {...fieldAria('slug', fieldErrors)}
          />
          <p className="mt-1 text-sm text-text-muted">
            {t('general.slugHint', { slug: workspace.slug })}
          </p>
          <p className="mt-1 text-sm text-warning-text">{t('general.slugChangeWarning')}</p>
          <FieldError name="slug" errors={fieldErrors} />
        </div>

        <div className="mb-4">
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
        </div>

        <div className="mb-6">
          <SelectField
            name="timezone"
            label={t('general.timezone')}
            placeholder={t('shared.selectPlaceholder')}
            defaultValue={workspace.timezone}
            options={timezones.map((zone) => ({ value: zone, label: zone }))}
            hint={t('general.timezoneHint')}
            errors={fieldErrors}
          />
        </div>

        <SubmitButton label={t('shared.save')} pendingLabel={t('shared.saving')} />
      </form>
    </section>
  );
}
