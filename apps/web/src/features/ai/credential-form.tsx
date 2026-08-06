'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { CardTitle } from '@mlain/ui/components/card';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { Alert } from '@mlain/ui/patterns/states';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import { SelectField } from '@/lib/forms/select-field';
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
    <section
      aria-labelledby="ai-credential-create"
      className="flex max-w-[var(--size-text-column)] flex-col gap-[var(--spacing-gutter)]"
    >
      <CardTitle>
        <span id="ai-credential-create">{t('credentials.add')}</span>
      </CardTitle>

      {state.status === 'success' ? <Alert tone="success" title={t('credentials.saved')} /> : null}

      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <SettingsProblem problem={state.problem} />
      ) : null}

      <form action={formAction} className="flex flex-col gap-[var(--spacing-gutter)]" noValidate>
        <IdempotencyField />
        <input type="hidden" name="workspace_id" value={workspaceId} readOnly />
        <input type="hidden" name="slug" value={slug} readOnly />

        <div className="flex flex-col gap-1.5">
          {/*
           * `SelectField`, ne nativní `<select>`. Původní komentář tu tvrdil, že
           * Radix Select hodnotu do `FormData` nedá a skryté zrcadlící pole by
           * bylo druhý zdroj pravdy. To zrcadlící pole ale používá `SelectField`
           * v celé aplikaci, od jazyka projektu po roli člena, takže tenhle
           * jediný nativní výběr vypadal jako prvek z jiné aplikace: jinou
           * výšku, jiný rámeček, systémovou šipku.
           *
           * `min-h-11` navíc nebyl token: 44 px z výchozí škály Tailwindu je
           * náhoda, změna `--size-target-min` by ho minula.
           */}
          <SelectField
            name="provider"
            label={t('credentials.provider')}
            placeholder={t('credentials.provider')}
            defaultValue={providerId}
            options={providers.map((item) => ({ value: item.id, label: item.label }))}
            errors={fieldErrors}
            onSelected={setProviderId}
          />
          {provider !== undefined && provider.signupUrl !== '' ? (
            <p className="text-meta text-text-muted">
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

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-credential-label">{t('credentials.label')}</Label>
          <Input id="ai-credential-label" name="label" {...fieldAria('label', fieldErrors)} />
          <FieldError name="label" errors={fieldErrors} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-credential-key">{t('credentials.apiKey')}</Label>
          <div className="flex gap-[var(--spacing-inline)]">
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
          <p className="text-meta text-text-muted">{t('credentials.apiKeyOnce')}</p>
          <FieldError name="api_key" errors={fieldErrors} />
        </div>

        {provider?.allowsBaseUrl === true ? (
          <div className="flex flex-col gap-1.5">
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

        <div className="flex flex-col gap-1.5">
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

        <div className="flex">
          <SubmitButton label={t('credentials.save')} pendingLabel={t('credentials.save')} />
        </div>
      </form>
    </section>
  );
}
