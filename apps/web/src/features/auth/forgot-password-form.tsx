'use client';

import { useActionState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@mlain/i18n/navigation';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import { SubmitButton } from '@/lib/forms/submit-button';
import { useFormErrorFocus } from '@/lib/forms/use-form-error-focus';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { AuthCard } from './auth-card';
import { AuthProblem } from './action-problem';

export type ForgotPasswordFormProps = {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  initialState?: ActionState | undefined;
};

export function ForgotPasswordForm({ action, initialState }: ForgotPasswordFormProps) {
  const t = useTranslations('auth');
  const [state, formAction] = useActionState(action, initialState ?? IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};
  useFormErrorFocus(fieldErrors, formRef);

  const footer = (
    <Link href="/login" className="underline">
      {t('shared.backToLogin')}
    </Link>
  );

  if (state.status === 'success') {
    return (
      <AuthCard title={t('forgot.sentTitle')} footer={footer}>
        <p role="status" className="text-text-muted">
          {t('forgot.sentBody')}
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('forgot.title')} lead={t('forgot.lead')} footer={footer}>
      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <div className="mb-4">
          <AuthProblem
            problem={state.problem}
            values={{ seconds: state.problem.retry_after ?? 0 }}
          />
        </div>
      ) : null}

      <form ref={formRef} action={formAction} noValidate>
        <div className="mb-6">
          <Label htmlFor="email">{t('shared.email')}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            {...fieldAria('email', fieldErrors)}
          />
          <FieldError name="email" errors={fieldErrors} />
        </div>
        <SubmitButton label={t('forgot.submit')} pendingLabel={t('forgot.submitting')} />
      </form>
    </AuthCard>
  );
}
