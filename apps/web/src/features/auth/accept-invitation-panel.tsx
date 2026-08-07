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

export type InvitationView =
  | { kind: 'invalid' }
  | { kind: 'signedOut' }
  | {
      kind: 'signedIn';
      email: string;
      invitedEmail?: string | undefined;
      workspaceName: string;
      roleLabel: string;
    };

export type AcceptInvitationPanelProps = {
  view: InvitationView;
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  /**
   * Založení účtu z pozvánky. Bez ní nabídne odhlášenému návštěvníkovi
   * obrazovka jen přihlášení, tedy přesně tu slepou uličku, kvůli které tenhle
   * formulář vznikl: pozvaný člověk žádný účet nemá a neměl ho kde založit.
   */
  signupAction: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  token: string;
  initialState?: ActionState | undefined;
  signupInitialState?: ActionState | undefined;
};

const INVALID_CODES = new Set(['not_found', 'gone', 'conflict']);

export function AcceptInvitationPanel({
  view,
  action,
  signupAction,
  token,
  initialState,
  signupInitialState,
}: AcceptInvitationPanelProps) {
  const t = useTranslations('auth');
  const [state, formAction] = useActionState(action, initialState ?? IDLE);
  const [signupState, signupFormAction] = useActionState(signupAction, signupInitialState ?? IDLE);
  const signupFormRef = useRef<HTMLFormElement>(null);
  const signupFieldErrors = signupState.status === 'error' ? signupState.fieldErrors : {};
  useFormErrorFocus(signupFieldErrors, signupFormRef);

  /**
   * `conflict` z registrace do neplatnosti pozvánky NEPATŘÍ. Znamená jedinou
   * věc: na tuhle adresu už účet existuje, takže se má člověk přihlásit.
   * Kdyby spadl do společné množiny níž, obrazovka by mu tvrdila, že pozvánka
   * vypršela, a poslala by ho shánět novou, která by dopadla stejně.
   */
  const accountExists = signupState.status === 'error' && signupState.problem.code === 'conflict';

  const invalid =
    view.kind === 'invalid' ||
    (state.status === 'error' && INVALID_CODES.has(state.problem.code)) ||
    (signupState.status === 'error' &&
      !accountExists &&
      INVALID_CODES.has(signupState.problem.code));

  if (invalid) {
    return (
      <AuthCard title={t('invitation.invalidTitle')}>
        <p className="text-text-muted">{t('invitation.invalidBody')}</p>
        <p className="mt-4">
          <Link href="/login" className="underline">
            {t('invitation.invalidAction')}
          </Link>
        </p>
      </AuthCard>
    );
  }

  if (view.kind === 'signedOut') {
    const next = encodeURIComponent(`/invitations/accept?token=${token}`);
    const signIn = (
      <Link href={`/login?next=${next}`} className="underline">
        {t('invitation.signIn')}
      </Link>
    );

    return (
      <AuthCard
        title={t('invitation.signupTitle')}
        lead={t('invitation.signupLead')}
        footer={signIn}
      >
        {signupState.status === 'error' && Object.keys(signupFieldErrors).length === 0 ? (
          <div className="mb-4">
            <AuthProblem problem={signupState.problem} />
          </div>
        ) : null}

        <form ref={signupFormRef} action={signupFormAction} noValidate>
          <input type="hidden" name="token" value={token} readOnly />
          {/*
            E-mail tu POLE NENÍ, a je to bezpečnostní rozhodnutí, ne úspora
            místa. Adresu nového účtu bere server z pozvánky, takže držitel
            cizího odkazu si na něj nezaloží účet na svou adresu.
          */}
          <div className="mb-4">
            <Label htmlFor="signup-name">{t('shared.fullName')}</Label>
            <Input
              id="signup-name"
              name="name"
              autoComplete="name"
              defaultValue={
                signupState.status === 'error' ? (signupState.values?.['name'] ?? '') : ''
              }
              {...fieldAria('name', signupFieldErrors)}
            />
            <FieldError name="name" errors={signupFieldErrors} />
          </div>
          <PasswordField
            name="password"
            label={t('shared.password')}
            hint={t('passwordRules.hint')}
            autoComplete="new-password"
            errors={signupFieldErrors}
            showLabel={t('shared.showPassword')}
            hideLabel={t('shared.hidePassword')}
          />
          <SubmitButton
            label={t('invitation.signupSubmit')}
            pendingLabel={t('invitation.signupSubmitting')}
          />
        </form>
      </AuthCard>
    );
  }

  const invitedEmail = view.invitedEmail;
  const differentEmail = invitedEmail !== undefined && invitedEmail !== view.email;

  return (
    <AuthCard
      title={t('invitation.title', { projectName: view.workspaceName })}
      lead={t('invitation.leadSignedIn', {
        email: view.email,
        projectName: view.workspaceName,
        role: view.roleLabel,
      })}
    >
      {state.status === 'error' ? (
        <div className="mb-4">
          <AuthProblem problem={state.problem} />
        </div>
      ) : null}

      {differentEmail ? (
        <p className="mb-4 rounded-[var(--radius-surface)] bg-surface-muted p-3 text-sm">
          {t('invitation.otherEmailNote', { invitedEmail, email: view.email })}
        </p>
      ) : null}

      <form action={formAction}>
        <input type="hidden" name="token" value={token} readOnly />
        <SubmitButton label={t('invitation.accept')} pendingLabel={t('invitation.accepting')} />
      </form>
    </AuthCard>
  );
}
