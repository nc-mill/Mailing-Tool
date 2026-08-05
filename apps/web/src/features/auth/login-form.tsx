'use client';

import { useActionState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@mlain/i18n/navigation';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import { PasswordField } from '@/lib/forms/password-field';
import { SubmitButton } from '@/lib/forms/submit-button';
import { useFormErrorFocus } from '@/lib/forms/use-form-error-focus';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { AuthCard } from './auth-card';
import { AuthProblem } from './action-problem';

export type LoginFormProps = {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  next?: string | undefined;
  initialState?: ActionState | undefined;
};

export function LoginForm({ action, next, initialState }: LoginFormProps) {
  const t = useTranslations('auth');
  const [state, formAction] = useActionState(action, initialState ?? IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};
  useFormErrorFocus(fieldErrors, formRef);

  const retryAfter = state.status === 'error' ? (state.problem.retry_after ?? 0) : 0;

  /*
   * E-mail po chybě zůstává vyplněný. React 19 formulář po doběhnutí `action`
   * vynuluje, takže překlep v hesle uživatele nutil přepsat i adresu.
   * Heslo se schválně nevrací.
   */
  const email = state.status === 'error' ? (state.values?.['email'] ?? '') : '';

  return (
    <AuthCard
      title={t('login.title')}
      lead={t('login.lead')}
      footer={
        <Link href="/forgot-password" className="underline">
          {t('login.forgotLink')}
        </Link>
      }
    >
      {state.status === 'error' ? (
        <div className="mb-4">
          <AuthProblem problem={state.problem} values={{ seconds: retryAfter }} />
        </div>
      ) : null}

      <form ref={formRef} action={formAction} noValidate>
        {next ? <input type="hidden" name="next" value={next} readOnly /> : null}

        <div className="mb-4">
          <Label htmlFor="email">{t('shared.email')}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            defaultValue={email}
            {...fieldAria('email', fieldErrors)}
          />
          <FieldError name="email" errors={fieldErrors} />
        </div>

        <PasswordField
          name="password"
          label={t('shared.password')}
          autoComplete="current-password"
          errors={fieldErrors}
          showLabel={t('shared.showPassword')}
          hideLabel={t('shared.hidePassword')}
        />

        <SubmitButton label={t('login.submit')} pendingLabel={t('login.submitting')} />
      </form>
    </AuthCard>
  );
}
