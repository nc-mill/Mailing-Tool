'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { Input } from '@mlain/ui/components/input';
import { CardTitle } from '@mlain/ui/components/card';
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

  const selected = new Set(props.endpoint?.event_types ?? []);

  /*
   * Typ, který endpoint UŽ ODEBÍRÁ, se nabídne i tehdy, když ho katalog
   * nezná. Bez toho by úprava adresy nebo popisu tiše smazala odběr, který se
   * v zaškrtávátkách neobjevil, a majitel by o události přišel, aniž by na to
   * sáhl. Takhle je odběr vidět a odhlásit se dá jedině vědomě.
   */
  const groups = groupEventTypes([...new Set([...props.availableEventTypes, ...selected])]);

  /*
   * Popisky se dohledávají PODMÍNĚNĚ. Klíč nemá typ, který katalog nezná, a
   * takový se sem dostane pokaždé, když endpoint odebírá vysloužilý typ.
   * Bez `t.has` by na tom formulář spadl a majitel by svůj webhook neupravil.
   */
  const groupLabel = (prefix: string) =>
    t.has(`webhooks.eventGroups.${prefix}`) ? t(`webhooks.eventGroups.${prefix}`) : prefix;
  const typeDescription = (type: string) =>
    t.has(`webhooks.events.${type}`) ? t(`webhooks.events.${type}`) : null;

  return (
    <section aria-labelledby="webhook-form" className="flex flex-col gap-[var(--spacing-gutter)]">
      <CardTitle>
        <span id="webhook-form">
          {props.mode === 'create' ? t('webhooks.form.createTitle') : t('webhooks.form.editTitle')}
        </span>
      </CardTitle>

      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <div>
          <SettingsProblem problem={state.problem} />
        </div>
      ) : null}

      <form action={formAction} className="flex flex-col gap-[var(--spacing-gutter)]" noValidate>
        {props.mode === 'create' ? <IdempotencyField /> : null}
        <input type="hidden" name="workspace_id" value={props.workspaceId} readOnly />
        <input type="hidden" name="slug" value={props.slug} readOnly />
        {props.endpoint ? (
          <input type="hidden" name="endpoint_id" value={props.endpoint.id} readOnly />
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="webhook-url">{t('webhooks.form.url')}</Label>
          <Input
            id="webhook-url"
            name="url"
            type="url"
            defaultValue={props.endpoint?.url}
            {...fieldAria('url', fieldErrors)}
          />
          <p className="text-meta text-text-muted">{t('webhooks.form.urlHint')}</p>
          <FieldError name="url" errors={fieldErrors} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="webhook-description">{t('webhooks.form.description')}</Label>
          <Textarea
            id="webhook-description"
            name="description"
            rows={2}
            defaultValue={props.endpoint?.description}
            {...fieldAria('description', fieldErrors)}
          />
          <p className="text-meta text-text-muted">{t('webhooks.form.descriptionHint')}</p>
          <FieldError name="description" errors={fieldErrors} />
        </div>

        <fieldset className="flex flex-col gap-[var(--spacing-hairline)]">
          <legend className="text-ui font-semibold text-text">{t('webhooks.form.events')}</legend>
          <p className="text-meta text-text-muted">{t('webhooks.form.eventsHint')}</p>
          {/* 260 px, ne 200: do užšího sloupce se popis události nevejde na dva řádky. */}
          <div className="mt-[var(--spacing-hairline)] grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-[var(--spacing-gutter)]">
            {groups.map((group) => (
              <fieldset key={group.prefix} aria-label={groupLabel(group.prefix)}>
                <legend className="text-sm font-semibold text-text">
                  {groupLabel(group.prefix)}
                </legend>
                {group.types.map((type) => {
                  const description = typeDescription(type);
                  return (
                    // 44 px klikací plochy i u zaškrtávátka v seznamu.
                    <label
                      key={type}
                      className="flex min-h-[var(--size-target-min)] cursor-pointer items-start gap-[var(--spacing-inline)] py-[var(--spacing-hairline)]"
                    >
                      <Checkbox
                        name="event_types"
                        value={type}
                        defaultChecked={selected.has(type)}
                        className="mt-0.5"
                      />
                      <span className="flex flex-col">
                        <code className="font-mono text-meta">{type}</code>
                        {description === null ? null : (
                          <span className="text-meta text-text-muted">{description}</span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            ))}
          </div>
          <FieldError name="event_types" errors={fieldErrors} />
        </fieldset>

        <p className="rounded-[var(--radius-control)] bg-surface-muted p-[var(--spacing-inline)] text-meta">
          {t('webhooks.form.duplicateNote')}
        </p>

        {/* Obal `flex`, aby se tlačítko neroztáhlo přes celou šířku formuláře. */}
        <div className="flex">
          <SubmitButton
            label={
              props.mode === 'create' ? t('webhooks.form.submit') : t('webhooks.form.saveSubmit')
            }
            pendingLabel={
              props.mode === 'create' ? t('webhooks.form.submitting') : t('shared.saving')
            }
          />
        </div>
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
