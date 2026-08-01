'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { SubmitButton } from '@/lib/forms/submit-button';
import { IdempotencyField } from '@/lib/feedback/idempotency-field';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { logoutAction } from '@/features/profile/actions';
import { AuthCard } from './auth-card';
import { AuthProblem } from './action-problem';

export type NoWorkspacePanelProps = {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  /** `SIGNUP_MODE` a role rozhodují, jestli si uživatel smí projekt založit. */
  canCreate: boolean;
  initialState?: ActionState | undefined;
};

/**
 * ODCHYLKA OD PLÁNU, vynucená chováním prohlížeče: plán odhlašoval nativním
 * `<form action="/api/v1/auth/logout" method="post">`. Endpoint vrací 204 bez
 * těla, takže by prohlížeč po odeslání zůstal na prázdné stránce a uživatel
 * by nevěděl, jestli se něco stalo. Odhlášení proto vede přes Server Action
 * `logoutAction`, která po zavolání API přesměruje na `/login`.
 */
export function NoWorkspacePanel({ action, canCreate, initialState }: NoWorkspacePanelProps) {
  const t = useTranslations('auth');
  const [state, formAction] = useActionState(action, initialState ?? IDLE);

  return (
    <AuthCard
      title={t('noWorkspace.title')}
      footer={
        <form action={logoutAction}>
          <Button type="submit" variant="ghost">
            {t('noWorkspace.signOut')}
          </Button>
        </form>
      }
    >
      <p className="text-text-muted">{t('noWorkspace.body')}</p>

      {state.status === 'error' ? (
        <div className="mt-4">
          <AuthProblem problem={state.problem} />
        </div>
      ) : null}

      {canCreate ? (
        <form action={formAction} className="mt-6">
          <IdempotencyField />
          <div className="mb-4">
            <Label htmlFor="name">{t('noWorkspace.workspaceName')}</Label>
            <Input id="name" name="name" />
          </div>
          <SubmitButton label={t('noWorkspace.create')} pendingLabel={t('noWorkspace.creating')} />
        </form>
      ) : (
        <p className="mt-6">
          <Link href="/no-workspace" className="underline">
            {t('noWorkspace.refresh')}
          </Link>
        </p>
      )}
    </AuthCard>
  );
}
