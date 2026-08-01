'use client';

import { useActionState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@mlain/i18n/navigation';
import { PasswordField } from '@/lib/forms/password-field';
import { SubmitButton } from '@/lib/forms/submit-button';
import { useFormErrorFocus } from '@/lib/forms/use-form-error-focus';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { AuthCard } from './auth-card';
import { AuthProblem } from './action-problem';

export type ResetPasswordFormProps = {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  token?: string | undefined;
  initialState?: ActionState | undefined;
};

/** Kódy, které znamenají „odkaz už neplatí", ne obecnou chybu. */
const INVALID_TOKEN_CODES = new Set(['unauthenticated', 'not_found', 'gone']);

export function ResetPasswordForm({ action, token, initialState }: ResetPasswordFormProps) {
  const t = useTranslations('auth');
  const [state, formAction] = useActionState(action, initialState ?? IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};
  useFormErrorFocus(fieldErrors, formRef);

  const backToLogin = (
    <Link href="/login" className="underline">
      {t('shared.backToLogin')}
    </Link>
  );

  const tokenInvalid =
    token === undefined ||
    (state.status === 'error' && INVALID_TOKEN_CODES.has(state.problem.code));

  if (tokenInvalid) {
    return (
      <AuthCard title={t('reset.invalidTitle')} footer={backToLogin}>
        <p className="text-text-muted">{t('reset.invalidBody')}</p>
        <p className="mt-4">
          <Link href="/forgot-password" className="underline">
            {t('reset.invalidAction')}
          </Link>
        </p>
      </AuthCard>
    );
  }

  if (state.status === 'success') {
    return (
      <AuthCard title={t('reset.doneTitle')} footer={backToLogin}>
        <p role="status" className="text-text-muted">
          {t('reset.doneBody')}
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('reset.title')} lead={t('reset.lead')} footer={backToLogin}>
      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <div className="mb-4">
          <AuthProblem problem={state.problem} />
        </div>
      ) : null}

      <form ref={formRef} action={formAction} noValidate>
        <input type="hidden" name="token" value={token} readOnly />
        <PasswordField
          name="new_password"
          label={t('shared.newPassword')}
          hint={t('passwordRules.hint')}
          autoComplete="new-password"
          errors={fieldErrors}
          showLabel={t('shared.showPassword')}
          hideLabel={t('shared.hidePassword')}
        />
        <SubmitButton label={t('reset.submit')} pendingLabel={t('reset.submitting')} />
      </form>
    </AuthCard>
  );
}
