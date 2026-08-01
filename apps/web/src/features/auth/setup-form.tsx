'use client';

import { useActionState, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@mlain/i18n/navigation';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { SelectField } from '@/lib/forms/select-field';
import { localeLabel } from '@/lib/i18n/locale-label';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import { FormErrorSummary } from '@/lib/forms/form-error-summary';
import { PasswordField } from '@/lib/forms/password-field';
import { SubmitButton } from '@/lib/forms/submit-button';
import { useFormErrorFocus } from '@/lib/forms/use-form-error-focus';
import { IdempotencyField } from '@/lib/feedback/idempotency-field';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { AuthCard } from './auth-card';
import { AuthProblem } from './action-problem';

export type SetupFormProps = {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  locales: readonly string[];
  initialState?: ActionState | undefined;
};

/**
 * ODCHYLKA OD PLÁNU, sjednocení s konvencí repozitáře: odkazy používají `Link`
 * z `@mlain/i18n/navigation`, ne `next/link`. Ten sám doplní jazykový prefix,
 * takže odkaz v anglickém rozhraní neskončí na české cestě. V češtině, což je
 * výchozí jazyk s `localePrefix: 'as-needed'`, je výsledné `href` totožné.
 */
export function SetupForm({ action, locales, initialState }: SetupFormProps) {
  const t = useTranslations('auth');
  const uiLocale = useLocale();
  const [state, formAction] = useActionState(action, initialState ?? IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};
  useFormErrorFocus(fieldErrors, formRef);

  const alreadyCompleted =
    state.status === 'error' && state.problem.code === 'setup_already_completed';

  return (
    <AuthCard
      title={t('setup.title')}
      lead={t('setup.lead')}
      {...(alreadyCompleted
        ? {
            footer: (
              <Link href="/login" className="underline">
                {t('shared.backToLogin')}
              </Link>
            ),
          }
        : {})}
    >
      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <div className="mb-4">
          <AuthProblem problem={state.problem} />
        </div>
      ) : null}

      <form ref={formRef} action={formAction} noValidate>
        <IdempotencyField />
        <FormErrorSummary
          errors={fieldErrors}
          fieldCount={5}
          heading={t('errors.validationFailed.title')}
        />

        <div className="mb-4">
          <Label htmlFor="name">{t('shared.fullName')}</Label>
          <Input id="name" name="name" autoComplete="name" {...fieldAria('name', fieldErrors)} />
          <FieldError name="name" errors={fieldErrors} />
        </div>

        <div className="mb-4">
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

        <PasswordField
          name="password"
          label={t('shared.password')}
          hint={t('passwordRules.hint')}
          autoComplete="new-password"
          errors={fieldErrors}
          showLabel={t('shared.showPassword')}
          hideLabel={t('shared.hidePassword')}
        />

        <div className="mb-4">
          <Label htmlFor="workspace_name">{t('setup.workspaceName')}</Label>
          <Input
            id="workspace_name"
            name="workspace_name"
            {...fieldAria('workspace_name', fieldErrors)}
          />
          <p className="mt-1 text-sm text-text-muted">{t('setup.workspaceHint')}</p>
          <FieldError name="workspace_name" errors={fieldErrors} />
        </div>

        <div className="mb-6">
          <SelectField
            name="locale"
            label={t('setup.locale')}
            placeholder={t('shared.selectPlaceholder')}
            defaultValue={locales[0] ?? ''}
            options={locales.map((locale) => ({
              value: locale,
              label: localeLabel(locale, uiLocale),
            }))}
            errors={fieldErrors}
          />
        </div>

        <SubmitButton label={t('setup.submit')} pendingLabel={t('setup.submitting')} />
      </form>
    </AuthCard>
  );
}
