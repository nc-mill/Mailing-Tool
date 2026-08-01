'use client';

import { useActionState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { PasswordField } from '@/lib/forms/password-field';
import { SubmitButton } from '@/lib/forms/submit-button';
import { useFormErrorFocus } from '@/lib/forms/use-form-error-focus';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { changePasswordAction } from './actions';

export type ChangePasswordFormViewProps = {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  /**
   * Skryté pole s přihlašovacím jménem. Prohlížeč ho u formuláře s hesly
   * vyžaduje, jinak správce hesel neví, ke kterému účtu heslo patří, a Chrome
   * to hlásí v konzoli jako přístupnostní problém. Ověřeno v prohlížeči.
   */
  email?: string | undefined;
  initialState?: ActionState | undefined;
};

export function ChangePasswordFormView({
  action,
  email,
  initialState,
}: ChangePasswordFormViewProps) {
  const t = useTranslations('settings');
  const [state, formAction] = useActionState(action, initialState ?? IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};
  useFormErrorFocus(fieldErrors, formRef);

  return (
    <section aria-labelledby="profile-password">
      <h2 id="profile-password" className="text-xl font-semibold">
        {t('profile.password.title')}
      </h2>
      <p className="mt-2 text-text-muted">{t('profile.password.lead')}</p>

      {state.status === 'success' ? (
        <div
          role="status"
          className="mt-4 rounded-[var(--radius-surface)] border border-success bg-success-surface p-4"
        >
          <p className="font-medium">{t('profile.password.doneTitle')}</p>
          <p className="mt-1 text-sm text-text-muted">{t('profile.password.doneBody')}</p>
        </div>
      ) : null}

      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <div className="mt-4">
          <SettingsProblem problem={state.problem} />
        </div>
      ) : null}

      <form ref={formRef} action={formAction} className="mt-4" noValidate>
        {email ? (
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={email}
            readOnly
            hidden
          />
        ) : null}
        <PasswordField
          name="current_password"
          label={t('profile.password.current')}
          autoComplete="current-password"
          errors={fieldErrors}
          showLabel={t('shared.showPassword')}
          hideLabel={t('shared.hidePassword')}
        />
        <PasswordField
          name="new_password"
          label={t('profile.password.next')}
          autoComplete="new-password"
          errors={fieldErrors}
          showLabel={t('shared.showPassword')}
          hideLabel={t('shared.hidePassword')}
        />
        <SubmitButton
          label={t('profile.password.submit')}
          pendingLabel={t('profile.password.submitting')}
        />
      </form>
    </section>
  );
}

/** Serverová obálka, aby stránka nemusela znát akci. */
export function ChangePasswordForm({ email }: { email: string }) {
  return <ChangePasswordFormView action={changePasswordAction} email={email} />;
}
