'use client';

import { useActionState, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { EmptyState } from '@mlain/ui/patterns/states';
import { DeviceIcon } from '@/lib/ui/status-icons';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import type { Result } from '@/lib/api-client/result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { describeDevice } from './describe-device';
import { logoutAllAction, revokeSessionAction } from './actions';

export type SessionRow = {
  id: string;
  ip: string | null;
  user_agent: string;
  last_used_at: string;
  created_at: string;
  current: boolean;
};

export type RevokeSessionAction = (
  previous: ActionState,
  formData: FormData,
) => Promise<ActionState>;

export type SessionsSectionViewProps = {
  sessions: Result<{ data: SessionRow[] }>;
  revokeAction: RevokeSessionAction;
  onLogoutAll: () => void | Promise<void>;
  /**
   * Okamžik, ke kterému se počítá „před 3 minutami". Posílá ho server, aby se
   * relativní čas nespočítal na serveru z jednoho času a při hydrataci
   * z jiného. Bez něj next-intl hlásí `ENVIRONMENT_FALLBACK` a text se může
   * na hranici minuty rozejít. Ověřeno v prohlížeči: chyba v konzoli zmizí.
   */
  now?: Date | undefined;
};

/**
 * ODCHYLKA OD PLÁNU, oprava chyby ve výpisu: plán předával akci přímo formuláři
 * přes `action={revokeAction as never}`. Akce má ale tvar `(previous, formData)`,
 * takže by jí React předal `FormData` jako první argument a druhý by zůstal
 * prázdný; `formData.get` by spadlo. Řádek proto drží vlastní `useActionState`
 * a chybu vykreslí u sebe, čímž zůstává jeden kanál zpětné vazby na akci.
 */
function RevokeSessionForm({
  action,
  sessionId,
  label,
}: {
  action: RevokeSessionAction;
  sessionId: string;
  label: string;
}) {
  const [state, formAction] = useActionState(action, IDLE);

  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="session_id" value={sessionId} readOnly />
        <Button type="submit" variant="secondary">
          {label}
        </Button>
      </form>
      {state.status === 'error' ? (
        <div className="mt-2">
          <SettingsProblem problem={state.problem} />
        </div>
      ) : null}
    </div>
  );
}

export function SessionsSectionView({
  sessions,
  revokeAction,
  onLogoutAll,
  now,
}: SessionsSectionViewProps) {
  const t = useTranslations('settings');
  const confirmLabels = useConfirmDialogLabels();
  const format = useFormatter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [fallbackNow] = useState(() => new Date());
  const reference = now ?? fallbackNow;

  const rows = sessions.ok ? sessions.data.data : [];

  return (
    <section aria-labelledby="profile-sessions">
      <div className="flex items-baseline justify-between">
        <h2 id="profile-sessions" className="text-xl font-semibold">
          {t('profile.sessions.title')}
        </h2>
        {sessions.ok && rows.length > 0 ? (
          // ODCHYLKA OD PLÁNU: `Button` z P05 má destruktivní variantu
          // pojmenovanou `destructive`, ne `danger`.
          <Button type="button" variant="destructive" onClick={() => setDialogOpen(true)}>
            {t('profile.sessions.logoutAll')}
          </Button>
        ) : null}
      </div>
      <p className="mt-2 text-text-muted">{t('profile.sessions.lead')}</p>

      {!sessions.ok ? (
        <div className="mt-4">
          <SettingsProblem
            problem={sessions.problem}
            onRetry={() => {
              window.location.reload();
            }}
          />
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            variant="first"
            title={t('profile.sessions.title')}
            explanation={t('profile.sessions.empty')}
            actions={[
              {
                label: t('profile.sessions.emptyAction'),
                onClick: () => {
                  window.location.reload();
                },
              },
            ]}
          />
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {rows.map((session) => (
            <li key={session.id} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="font-medium">
                  {describeDevice(session.user_agent, t('profile.sessions.unknownDevice'))}
                  {session.current ? (
                    <Badge className="ml-2" tone="accent" icon={DeviceIcon}>
                      {t('profile.sessions.thisSession')}
                    </Badge>
                  ) : null}
                </p>
                <p className="text-sm text-text-muted">
                  {session.ip ?? ''} {t('profile.sessions.lastUsed')}{' '}
                  <time dateTime={session.last_used_at} title={session.last_used_at}>
                    {format.relativeTime(new Date(session.last_used_at), reference)}
                  </time>
                </p>
              </div>
              {session.current ? null : (
                <RevokeSessionForm
                  action={revokeAction}
                  sessionId={session.id}
                  label={t('profile.sessions.revoke')}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        level="N2"
        title={t('profile.sessions.logoutAllDialogTitle')}
        consequences={[
          t('profile.sessions.logoutAllConsequence', { count: rows.length }),
          t('profile.sessions.logoutAllConsequenceWork'),
        ]}
        confirmLabel={t('profile.sessions.logoutAllConfirm')}
        cancelLabel={t('profile.sessions.logoutAllCancel')}
        onConfirm={onLogoutAll}
        labels={confirmLabels}
      />
    </section>
  );
}

/** Serverová obálka, aby stránka nemusela znát akce. */
export function SessionsSection({
  sessions,
  now,
}: {
  sessions: Result<{ data: SessionRow[] }>;
  now: Date;
}) {
  return (
    <SessionsSectionView
      sessions={sessions}
      revokeAction={revokeSessionAction}
      onLogoutAll={logoutAllAction}
      now={now}
    />
  );
}
