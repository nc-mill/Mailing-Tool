'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import { SubmitButton } from '@/lib/forms/submit-button';
import { IdempotencyField } from '@/lib/feedback/idempotency-field';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { SecretReveal } from './secret-reveal';
import { createApiKeyAction, type SecretResult } from './actions';

export type CreateKeyPanelProps = {
  workspaceId: string;
  slug: string;
  /** Scopes, které smí aktér klíči udělit. Nikdy víc, než má sám. */
  availableScopes: readonly string[];
  action?:
    | ((
        previous: ActionState<SecretResult>,
        formData: FormData,
      ) => Promise<ActionState<SecretResult>>)
    | undefined;
};

export function CreateKeyPanel({
  workspaceId,
  slug,
  availableScopes,
  action,
}: CreateKeyPanelProps) {
  const t = useTranslations('settings');
  const [state, formAction] = useActionState(action ?? createApiKeyAction, IDLE);
  const [dismissed, setDismissed] = useState(false);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};

  const created = state.status === 'success' ? state.data : undefined;

  if (created && !dismissed) {
    return (
      <SecretReveal
        secret={created.secret}
        titleKey="apiKeys.secret.title"
        warningKey="apiKeys.secret.warning"
        onClose={() => setDismissed(true)}
      />
    );
  }

  return (
    <section aria-labelledby="api-keys-create">
      <h2 id="api-keys-create" className="text-xl font-semibold">
        {t('apiKeys.create.title')}
      </h2>
      <p className="mt-2 text-text-muted">{t('apiKeys.create.lead')}</p>

      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <div className="mt-4">
          <SettingsProblem problem={state.problem} />
        </div>
      ) : null}

      <form action={formAction} className="mt-4" noValidate>
        <IdempotencyField />
        <input type="hidden" name="workspace_id" value={workspaceId} readOnly />
        <input type="hidden" name="slug" value={slug} readOnly />

        <div className="mb-4">
          <Label htmlFor="key-name">{t('apiKeys.create.name')}</Label>
          <Input id="key-name" name="name" {...fieldAria('name', fieldErrors)} />
          <p className="mt-1 text-sm text-text-muted">{t('apiKeys.create.nameHint')}</p>
          <FieldError name="name" errors={fieldErrors} />
        </div>

        <fieldset className="mb-6">
          <legend className="font-medium">{t('apiKeys.create.scopes')}</legend>
          <p className="mt-1 text-sm text-text-muted">{t('apiKeys.create.scopesHint')}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {availableScopes.map((scope) => (
              <label key={scope} className="flex items-center gap-2">
                <Checkbox name="scopes" value={scope} />
                <code className="text-sm">{scope}</code>
              </label>
            ))}
          </div>
          <FieldError name="scopes" errors={fieldErrors} />
        </fieldset>

        <SubmitButton
          label={t('apiKeys.create.submit')}
          pendingLabel={t('apiKeys.create.submitting')}
        />
      </form>
    </section>
  );
}
