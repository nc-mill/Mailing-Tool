'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CardTitle } from '@mlain/ui/components/card';
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
    <section
      aria-labelledby="api-keys-create"
      className="flex flex-col gap-[var(--spacing-gutter)]"
    >
      <div className="flex flex-col gap-[var(--spacing-hairline)]">
        <CardTitle>
          <span id="api-keys-create">{t('apiKeys.create.title')}</span>
        </CardTitle>
        <p className="text-meta text-text-muted">{t('apiKeys.create.lead')}</p>
      </div>

      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <SettingsProblem problem={state.problem} />
      ) : null}

      <form action={formAction} className="flex flex-col gap-[var(--spacing-gutter)]" noValidate>
        <IdempotencyField />
        <input type="hidden" name="workspace_id" value={workspaceId} readOnly />
        <input type="hidden" name="slug" value={slug} readOnly />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="key-name">{t('apiKeys.create.name')}</Label>
          <Input id="key-name" name="name" {...fieldAria('name', fieldErrors)} />
          <p className="text-meta text-text-muted">{t('apiKeys.create.nameHint')}</p>
          <FieldError name="name" errors={fieldErrors} />
        </div>

        <fieldset className="flex flex-col gap-[var(--spacing-hairline)]">
          <legend className="text-sm font-semibold text-text">{t('apiKeys.create.scopes')}</legend>
          <p className="text-meta text-text-muted">{t('apiKeys.create.scopesHint')}</p>
          {/* Oprávnění je přes čtyřicet. Mřížka se řídí šířkou karty, ne pevným
              počtem sloupců: `sm:grid-cols-2` dělalo dva dlouhé sloupce i tam,
              kde se vešly čtyři. Řádek má 44 px, protože je to klikací plocha. */}
          <div className="mt-[var(--spacing-hairline)] grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-[var(--spacing-gutter)]">
            {availableScopes.map((scope) => (
              <label
                key={scope}
                className="flex min-h-[var(--size-target-min)] cursor-pointer items-center gap-[var(--spacing-inline)]"
              >
                <Checkbox name="scopes" value={scope} />
                {/* Jméno oprávnění se čte po znacích, takže mono. */}
                <span className="font-mono text-meta text-text">{scope}</span>
              </label>
            ))}
          </div>
          <FieldError name="scopes" errors={fieldErrors} />
        </fieldset>

        <div className="flex">
          <SubmitButton
            label={t('apiKeys.create.submit')}
            pendingLabel={t('apiKeys.create.submitting')}
          />
        </div>
      </form>
    </section>
  );
}
