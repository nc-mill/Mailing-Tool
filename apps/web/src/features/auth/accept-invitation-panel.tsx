'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@mlain/i18n/navigation';
import { SubmitButton } from '@/lib/forms/submit-button';
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
  token: string;
  initialState?: ActionState | undefined;
};

const INVALID_CODES = new Set(['not_found', 'gone', 'conflict']);

export function AcceptInvitationPanel({
  view,
  action,
  token,
  initialState,
}: AcceptInvitationPanelProps) {
  const t = useTranslations('auth');
  const [state, formAction] = useActionState(action, initialState ?? IDLE);

  const invalid =
    view.kind === 'invalid' || (state.status === 'error' && INVALID_CODES.has(state.problem.code));

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
    return (
      <AuthCard title={t('login.title')} lead={t('invitation.leadSignedOut')}>
        <Link href={`/login?next=${next}`} className="underline">
          {t('invitation.signIn')}
        </Link>
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
