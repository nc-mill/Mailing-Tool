'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { SelectField } from '@/lib/forms/select-field';
import { localeLabel } from '@/lib/i18n/locale-label';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import { SubmitButton } from '@/lib/forms/submit-button';
import { useFormErrorFocus } from '@/lib/forms/use-form-error-focus';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';

export type ProfileUser = {
  id: string;
  email: string;
  name: string;
  locale: string;
  timezone: string;
};

export type ProfileFormProps = {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  user: ProfileUser;
  locales: readonly string[];
  timezones: readonly string[];
  initialState?: ActionState | undefined;
};

export function ProfileForm({ action, user, locales, timezones, initialState }: ProfileFormProps) {
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

  return (
    <section aria-labelledby="profile-identity">
      <div className="flex items-baseline justify-between">
        <h2 id="profile-identity" className="text-xl font-semibold">
          {t('profile.identity.title')}
        </h2>
        <p role="status" className="text-sm text-text-muted">
          {savedVisible ? t('profile.identity.saved') : ''}
        </p>
      </div>

      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <div className="mt-4">
          <SettingsProblem problem={state.problem} />
        </div>
      ) : null}

      <form ref={formRef} action={formAction} className="mt-4" noValidate>
        <div className="mb-4">
          <Label htmlFor="name">{t('profile.identity.name')}</Label>
          <Input
            id="name"
            name="name"
            defaultValue={user.name}
            autoComplete="name"
            {...fieldAria('name', fieldErrors)}
          />
          <p className="mt-1 text-sm text-text-muted">{t('profile.identity.nameHint')}</p>
          <FieldError name="name" errors={fieldErrors} />
        </div>

        <div className="mb-4">
          <p className="font-medium">{t('profile.identity.email')}</p>
          <p className="mt-1">{user.email}</p>
          <p className="mt-1 text-sm text-text-muted">{t('profile.identity.emailHint')}</p>
        </div>

        <div className="mb-4">
          <SelectField
            name="locale"
            label={t('profile.identity.locale')}
            placeholder={t('shared.selectPlaceholder')}
            defaultValue={user.locale}
            options={locales.map((locale) => ({
              value: locale,
              label: localeLabel(locale, uiLocale),
            }))}
            errors={fieldErrors}
          />
        </div>

        <div className="mb-6">
          <SelectField
            name="timezone"
            label={t('profile.identity.timezone')}
            placeholder={t('shared.selectPlaceholder')}
            defaultValue={user.timezone}
            options={timezones.map((zone) => ({ value: zone, label: zone }))}
            hint={t('profile.identity.timezoneHint')}
            errors={fieldErrors}
          />
        </div>

        <SubmitButton label={t('shared.save')} pendingLabel={t('shared.saving')} />
      </form>
    </section>
  );
}
