'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { EmptyState } from '@mlain/ui/patterns/states';
import { CheckIcon, SlashIcon } from '@/lib/ui/status-icons';

export type PublicCredential = {
  id: string;
  provider: string;
  label: string;
  key_hint: string;
  base_url: string | null;
  default_model: string;
  default_credential: boolean;
  last_used_at: string | null;
  last_error_at: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
};

export type ProviderOption = { id: string; label: string; signupUrl: string };

/**
 * Kódy, ke kterým umíme napsat konkrétní větu. Neznámý kód se NEPŘEKLÁDÁ na
 * výpadek poskytovatele, ale ukáže se sám, ať je co dohledat. Viz `ERROR_KEYS`
 * v `assistant-panel.tsx`, kde byl tentýž lživý výchozí překlad.
 */
const ERROR_LABEL: Record<string, string> = {
  ai_invalid_credentials: 'invalidKey',
  ai_insufficient_credit: 'quota',
  ai_provider_unavailable: 'providerDown',
  ai_rate_limited: 'rateLimited',
  ai_model_not_found: 'modelNotFound',
  ai_unsupported_parameter: 'unsupportedParameter',
  ai_request_failed: 'requestFailed',
};

/**
 * Seznam uložených klíčů. Hodnota klíče se sem nikdy nedostane: server vydává
 * jen `key_hint` o čtyřech znacích (kritérium 66). Klíč vidí uživatel jednou,
 * ve chvíli, kdy ho zadává.
 */
export function CredentialList({
  credentials,
  providers,
  onAdd,
  onTest,
  onDelete,
  onMakeDefault,
}: {
  credentials: readonly PublicCredential[];
  providers: readonly ProviderOption[];
  onAdd?: () => void;
  onTest?: (id: string) => void;
  onDelete?: (id: string) => void;
  onMakeDefault?: (id: string) => void;
}) {
  const t = useTranslations('ai');
  const format = useFormatter();

  if (credentials.length === 0) {
    return (
      <EmptyState
        variant="first"
        title={t('byok.emptyTitle')}
        explanation={t('byok.emptyHint')}
        actions={[
          {
            label: t('credentials.add'),
            onClick: onAdd ?? (() => document.getElementById('ai-credential-label')?.focus()),
          },
        ]}
        hint={t('byok.noContactData')}
        secondary={
          <ul className="flex flex-wrap justify-center gap-4">
            {providers
              .filter((provider) => provider.signupUrl !== '')
              .map((provider) => (
                <li key={provider.id}>
                  <a
                    className="text-accent-text underline underline-offset-4"
                    href={provider.signupUrl}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    {provider.label}
                  </a>
                </li>
              ))}
          </ul>
        }
      />
    );
  }

  return (
    <ul className="divide-y divide-border" data-testid="credential-list">
      {credentials.map((credential) => (
        <li key={credential.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-text">{credential.label}</span>
              {credential.default_credential ? (
                <Badge tone="success" icon={CheckIcon}>
                  {t('credentials.isDefault')}
                </Badge>
              ) : null}
              {credential.last_error_code !== null ? (
                <span data-testid={`credential-error-${credential.id}`}>
                  <Badge tone="danger" icon={SlashIcon}>
                    {t(`errors.${ERROR_LABEL[credential.last_error_code] ?? 'unknownShort'}`, {
                      provider: credential.provider,
                      seconds: 20,
                      code: credential.last_error_code,
                    })}
                  </Badge>
                </span>
              ) : null}
            </div>
            <p className="mt-1 truncate text-sm text-text-muted">
              {credential.provider} {'·'} <code>{credential.default_model}</code> {'·'}{' '}
              {t('credentials.hint', { hint: credential.key_hint })}
            </p>
            <p className="text-sm text-text-muted">
              {credential.last_used_at === null
                ? t('credentials.neverUsed')
                : t('credentials.lastUsed', {
                    time: format.dateTime(new Date(credential.last_used_at), 'short'),
                  })}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {onTest === undefined ? null : (
              <Button type="button" variant="secondary" onClick={() => onTest(credential.id)}>
                {t('credentials.test')}
              </Button>
            )}
            {onMakeDefault === undefined || credential.default_credential ? null : (
              <Button
                type="button"
                variant="secondary"
                onClick={() => onMakeDefault(credential.id)}
              >
                {t('credentials.makeDefault')}
              </Button>
            )}
            {onDelete === undefined ? null : (
              <Button type="button" variant="destructive" onClick={() => onDelete(credential.id)}>
                {t('credentials.delete')}
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
