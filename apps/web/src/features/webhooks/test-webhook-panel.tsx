'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { CardTitle } from '@mlain/ui/components/card';
import { SubmitButton } from '@/lib/forms/submit-button';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { testWebhookAction } from './actions';

export type TestWebhookPanelViewProps = {
  workspaceId: string;
  slug: string;
  endpointId: string;
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  initialState?: ActionState | undefined;
};

/**
 * Třída A3 podle 5.1 části 6: inline průběh v místě akce a inline výsledek,
 * který zůstává. Toast je pro výsledek kontroly v 5.4 části 6 zakázaný.
 */
export function TestWebhookPanelView(props: TestWebhookPanelViewProps) {
  const t = useTranslations('settings');
  const [state, formAction] = useActionState(props.action, props.initialState ?? IDLE);

  return (
    <section aria-labelledby="webhook-test" className="flex flex-col gap-[var(--spacing-gutter)]">
      <CardTitle>
        <span id="webhook-test">{t('webhooks.test.button')}</span>
      </CardTitle>

      <form action={formAction} className="flex">
        <input type="hidden" name="workspace_id" value={props.workspaceId} readOnly />
        <input type="hidden" name="slug" value={props.slug} readOnly />
        <input type="hidden" name="endpoint_id" value={props.endpointId} readOnly />
        <SubmitButton label={t('webhooks.test.button')} pendingLabel={t('webhooks.test.running')} />
      </form>

      {state.status === 'success' ? (
        <div
          role="status"
          className="mt-[var(--spacing-stack)] rounded-[var(--radius-surface)] border border-success p-[var(--spacing-gutter)]"
        >
          <p className="text-ui font-semibold text-text">{t('webhooks.test.successTitle')}</p>
          <p className="text-meta text-text-muted">{t('webhooks.test.successBody')}</p>
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div>
          <SettingsProblem problem={state.problem} />
        </div>
      ) : null}
    </section>
  );
}

/** Serverová obálka, aby stránka nemusela znát akci. */
export function TestWebhookPanel(props: Omit<TestWebhookPanelViewProps, 'action'>) {
  return <TestWebhookPanelView {...props} action={testWebhookAction} />;
}
