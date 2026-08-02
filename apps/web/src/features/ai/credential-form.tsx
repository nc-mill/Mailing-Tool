'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { Alert } from '@mlain/ui/patterns/states';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import { SubmitButton } from '@/lib/forms/submit-button';
import { IdempotencyField } from '@/lib/feedback/idempotency-field';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { createAiCredentialAction } from './actions';

export type ProviderChoice = {
  id: string;
  label: string;
  allowsBaseUrl: boolean;
  requiresBaseUrl: boolean;
  defaultModel: string;
  signupUrl: string;
};

export type CredentialFormProps = {
  workspaceId: string;
  slug: string;
  providers: readonly ProviderChoice[];
  action?:
    | ((
        previous: ActionState<{ id: string }>,
        formData: FormData,
      ) => Promise<ActionState<{ id: string }>>)
    | undefined;
};

/**
 * Formulář pro uložení klíče. Klíč vidí uživatel **jednou, právě tady**:
 * po uložení se z něj v aplikaci nechávají poslední čtyři znaky a hodnota se
 * z API nikdy nevrací. Pole je proto `type="password"` s možností zobrazení,
 * ne obyčejný text: nechceme, aby klíč zůstal čitelný na sdílené obrazovce.
 */
export function CredentialForm({ workspaceId, slug, providers, action }: CredentialFormProps) {
  const t = useTranslations('ai');
  const [state, formAction] = useActionState(action ?? createAiCredentialAction, IDLE);
  const [providerId, setProviderId] = useState(providers[0]?.id ?? 'anthropic');
  const [revealed, setRevealed] = useState(false);

  const provider = providers.find((item) => item.id === providerId) ?? providers[0];
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};

  return (
    <section aria-labelledby="ai-credential-create" className="max-w-xl">
      <h2 id="ai-credential-create" className="text-xl font-semibold text-text">
        {t('credentials.add')}
      </h2>

      {state.status === 'success' ? (
        <div className="mt-4">
          <Alert tone="success" title={t('credentials.saved')} />
        </div>
      ) : null}

      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <div className="mt-4">
          <SettingsProblem problem={state.problem} />
        </div>
      ) : null}

      <form action={formAction} className="mt-4 flex flex-col gap-4" noValidate>
        <IdempotencyField />
        <input type="hidden" name="workspace_id" value={workspaceId} readOnly />
        <input type="hidden" name="slug" value={slug} readOnly />

        <div>
          <Label htmlFor="ai-credential-provider">{t('credentials.provider')}</Label>
          {/*
           * Nativní `<select>`, ne `Select` z P05: formulář se odesílá serverovou
           * akcí přes `FormData`, a Radix Select hodnotu do formuláře nedává.
           * Skrytý zrcadlící input by byl druhý zdroj pravdy pro totéž pole.
           */}
          <select
            id="ai-credential-provider"
            name="provider"
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
            className="min-h-11 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-sm text-text"
          >
            {providers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          {provider !== undefined && provider.signupUrl !== '' ? (
            <p className="mt-1 text-sm text-text-muted">
              <a
                className="text-accent-text underline underline-offset-4"
                href={provider.signupUrl}
                rel="noreferrer noopener"
                target="_blank"
              >
                {t('errors.noCredentialHowTo')}
              </a>
            </p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="ai-credential-label">{t('credentials.label')}</Label>
          <Input id="ai-credential-label" name="label" {...fieldAria('label', fieldErrors)} />
          <FieldError name="label" errors={fieldErrors} />
        </div>

        <div>
          <Label htmlFor="ai-credential-key">{t('credentials.apiKey')}</Label>
          <div className="flex gap-2">
            <Input
              id="ai-credential-key"
              name="api_key"
              type={revealed ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              {...fieldAria('api_key', fieldErrors)}
            />
            <Button type="button" variant="secondary" onClick={() => setRevealed((on) => !on)}>
              {revealed ? t('credentials.hide') : t('credentials.reveal')}
            </Button>
          </div>
          <p className="mt-1 text-sm text-text-muted">{t('credentials.apiKeyOnce')}</p>
          <FieldError name="api_key" errors={fieldErrors} />
        </div>

        {provider?.allowsBaseUrl === true ? (
          <div>
            <Label htmlFor="ai-credential-base-url">{t('credentials.baseUrl')}</Label>
            <Input
              id="ai-credential-base-url"
              name="base_url"
              type="url"
              inputMode="url"
              {...fieldAria('base_url', fieldErrors)}
            />
            <FieldError name="base_url" errors={fieldErrors} />
          </div>
        ) : null}

        <div>
          <Label htmlFor="ai-credential-model">{t('credentials.defaultModel')}</Label>
          <Input
            id="ai-credential-model"
            name="default_model"
            key={provider?.id ?? 'none'}
            defaultValue={provider?.defaultModel ?? ''}
            {...fieldAria('default_model', fieldErrors)}
          />
          <FieldError name="default_model" errors={fieldErrors} />
        </div>

        <div>
          <SubmitButton label={t('credentials.save')} pendingLabel={t('credentials.save')} />
        </div>
      </form>
    </section>
  );
}
