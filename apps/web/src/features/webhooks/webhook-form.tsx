'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { Textarea } from '@mlain/ui/components/textarea';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import { SubmitButton } from '@/lib/forms/submit-button';
import { IdempotencyField } from '@/lib/feedback/idempotency-field';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { SecretReveal } from '@/features/api-keys/secret-reveal';
import { groupEventTypes } from './event-types';
import { createWebhookAction, updateWebhookAction, type WebhookSecretResult } from './actions';
import type { WebhookRow } from './webhooks-table';

export type WebhookFormViewProps = {
  mode: 'create' | 'edit';
  workspaceId: string;
  slug: string;
  availableEventTypes: readonly string[];
  endpoint?: WebhookRow | undefined;
  action: (
    previous: ActionState<WebhookSecretResult>,
    formData: FormData,
  ) => Promise<ActionState<WebhookSecretResult>>;
  initialState?: ActionState<WebhookSecretResult> | undefined;
};

export function WebhookFormView(props: WebhookFormViewProps) {
  const t = useTranslations('settings');
  const [state, formAction] = useActionState(props.action, props.initialState ?? IDLE);
  const [dismissed, setDismissed] = useState(false);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};

  const created = state.status === 'success' ? state.data : undefined;
  if (created && !dismissed) {
    return (
      <SecretReveal
        secret={created.secret}
        titleKey="webhooks.secret.title"
        warningKey="webhooks.secret.warning"
        hintKey="webhooks.secret.hint"
        onClose={() => setDismissed(true)}
      />
    );
  }

  const groups = groupEventTypes(props.availableEventTypes);
  const selected = new Set(props.endpoint?.event_types ?? []);

  return (
    <section aria-labelledby="webhook-form">
      <h2 id="webhook-form" className="text-xl font-semibold">
        {props.mode === 'create' ? t('webhooks.form.createTitle') : t('webhooks.form.editTitle')}
      </h2>

      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <div className="mt-4">
          <SettingsProblem problem={state.problem} />
        </div>
      ) : null}

      <form action={formAction} className="mt-4" noValidate>
        {props.mode === 'create' ? <IdempotencyField /> : null}
        <input type="hidden" name="workspace_id" value={props.workspaceId} readOnly />
        <input type="hidden" name="slug" value={props.slug} readOnly />
        {props.endpoint ? (
          <input type="hidden" name="endpoint_id" value={props.endpoint.id} readOnly />
        ) : null}

        <div className="mb-4">
          <Label htmlFor="webhook-url">{t('webhooks.form.url')}</Label>
          <Input
            id="webhook-url"
            name="url"
            type="url"
            defaultValue={props.endpoint?.url}
            {...fieldAria('url', fieldErrors)}
          />
          <p className="mt-1 text-sm text-text-muted">{t('webhooks.form.urlHint')}</p>
          <FieldError name="url" errors={fieldErrors} />
        </div>

        <div className="mb-4">
          <Label htmlFor="webhook-description">{t('webhooks.form.description')}</Label>
          <Textarea
            id="webhook-description"
            name="description"
            rows={2}
            defaultValue={props.endpoint?.description}
            {...fieldAria('description', fieldErrors)}
          />
          <p className="mt-1 text-sm text-text-muted">{t('webhooks.form.descriptionHint')}</p>
          <FieldError name="description" errors={fieldErrors} />
        </div>

        <fieldset className="mb-4">
          <legend className="font-medium">{t('webhooks.form.events')}</legend>
          <p className="mt-1 text-sm text-text-muted">{t('webhooks.form.eventsHint')}</p>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            {groups.map((group) => (
              <fieldset key={group.prefix} aria-label={group.prefix}>
                <legend className="text-sm font-medium">{group.prefix}</legend>
                {group.types.map((type) => (
                  <label key={type} className="mt-1 flex items-center gap-2">
                    <Checkbox name="event_types" value={type} defaultChecked={selected.has(type)} />
                    <code className="text-sm">{type}</code>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <FieldError name="event_types" errors={fieldErrors} />
        </fieldset>

        <p className="mb-4 rounded-md bg-surface-muted p-3 text-sm">
          {t('webhooks.form.duplicateNote')}
        </p>

        <SubmitButton
          label={
            props.mode === 'create' ? t('webhooks.form.submit') : t('webhooks.form.saveSubmit')
          }
          pendingLabel={
            props.mode === 'create' ? t('webhooks.form.submitting') : t('shared.saving')
          }
        />
      </form>
    </section>
  );
}

/** Serverová obálka, aby stránka nemusela znát akce. */
export function WebhookForm(
  props: Omit<WebhookFormViewProps, 'action' | 'availableEventTypes'> & {
    availableEventTypes?: readonly string[];
  },
) {
  return (
    <WebhookFormView
      {...props}
      availableEventTypes={props.availableEventTypes ?? []}
      action={props.mode === 'create' ? createWebhookAction : updateWebhookAction}
    />
  );
}
