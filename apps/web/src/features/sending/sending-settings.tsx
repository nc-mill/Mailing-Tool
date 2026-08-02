'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@mlain/i18n/navigation';
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { Alert, EmptyState } from '@mlain/ui/patterns/states';
import { CheckIcon, ClockIcon, SlashIcon, WarningIcon } from '@/lib/ui/status-icons';
import { GuardThresholds, type GuardLimits, type GuardSettings } from './guard-thresholds';

type ProviderActionResult =
  { status: 'success'; detail?: string } | { status: 'error'; code?: string };

export type ProviderView = {
  id: string;
  name: string;
  type: string;
  status: string;
  is_default: boolean;
  config: { kind?: string; region?: string; host?: string; access_key_id_masked?: string } | null;
  quota_max_24h: number | null;
  quota_sent_24h: number | null;
};

export type DomainView = {
  id: string;
  domain: string;
  dkim_ok: boolean | null;
  spf_ok: boolean | null;
  dmarc_ok: boolean | null;
  verified_at: string | null;
};

function statusTone(status: string): 'neutral' | 'accent' | 'success' | 'warning' | 'danger' {
  if (status === 'ready') return 'success';
  if (status === 'degraded') return 'warning';
  if (status === 'blocked') return 'danger';
  if (status === 'verifying') return 'accent';
  return 'neutral';
}

/**
 * Nastavení odesílání: odesílací účty, domény a brzdy doručitelnosti na jedné
 * obrazovce, protože jsou to tři strany téže věci a uživatel je řeší najednou.
 */
export function SendingSettings({
  providers,
  domains,
  guards,
  limits,
  basePath,
  onSaveGuards,
  onAddProvider,
  onAddDomain,
  onTestProvider,
  onMakeDefault,
}: {
  providers: ProviderView[];
  domains: DomainView[];
  guards: GuardSettings;
  limits: GuardLimits;
  basePath: string;
  onSaveGuards?: (next: GuardSettings) => Promise<{ status: 'success' | 'error'; code?: string }>;
  onAddProvider?: () => void;
  onAddDomain?: () => void;
  onTestProvider?: (providerId: string) => Promise<ProviderActionResult>;
  onMakeDefault?: (providerId: string) => Promise<ProviderActionResult>;
}) {
  const t = useTranslations('campaigns');
  const format = useFormatter();
  const hasSmtp = providers.some((p) => p.type === 'smtp');
  // Klíčováno podle id účtu: výsledek testu jednoho účtu nesmí přepsat druhý,
  // seznam se v jednom projektu běžně skládá z víc účtů najednou.
  const [testResult, setTestResult] = useState<Record<string, ProviderActionResult>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [defaulting, setDefaulting] = useState<Record<string, boolean>>({});

  async function runTest(id: string) {
    if (!onTestProvider) return;
    setTesting((prev) => ({ ...prev, [id]: true }));
    try {
      const result = await onTestProvider(id);
      setTestResult((prev) => ({ ...prev, [id]: result }));
    } finally {
      setTesting((prev) => ({ ...prev, [id]: false }));
    }
  }

  async function runMakeDefault(id: string) {
    if (!onMakeDefault) return;
    setDefaulting((prev) => ({ ...prev, [id]: true }));
    try {
      await onMakeDefault(id);
    } finally {
      setDefaulting((prev) => ({ ...prev, [id]: false }));
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="providers-title" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="providers-title" className="text-lg font-semibold">
            {t('sending.providersTitle')}
          </h2>
          {/* Druhý účet se zakládá stejně často jako první, například záložní SMTP
              vedle SES. Dokud tlačítko viselo jen v prázdném stavu, nebylo po
              založení prvního účtu kam kliknout. */}
          {onAddProvider && providers.length > 0 && (
            <Button variant="primary" data-testid="add-provider" onClick={onAddProvider}>
              {t('sending.addProvider')}
            </Button>
          )}
        </div>

        {providers.length === 0 ? (
          <EmptyState
            variant="first"
            title={t('sending.providersEmpty')}
            explanation={t('sending.providersEmptyExplanation')}
            actions={[{ label: t('sending.addProvider'), onClick: () => onAddProvider?.() }]}
          />
        ) : (
          <ul className="flex flex-col gap-3" data-testid="provider-list">
            {providers.map((p) => {
              const result = testResult[p.id];
              return (
                <li
                  key={p.id}
                  className="flex flex-col gap-2 rounded-[var(--radius-surface)] border border-border p-4"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-medium">{p.name}</span>
                    <Badge
                      tone={statusTone(p.status)}
                      icon={
                        p.status === 'ready'
                          ? CheckIcon
                          : p.status === 'blocked'
                            ? SlashIcon
                            : ClockIcon
                      }
                    >
                      {t(`sending.providerStatus.${p.status}`)}
                    </Badge>
                    {p.is_default && (
                      <Badge tone="accent" icon={CheckIcon}>
                        {t('sending.defaultBadge')}
                      </Badge>
                    )}
                    <span className="text-sm text-text-muted">
                      {p.type === 'ses' ? (p.config?.region ?? 'ses') : (p.config?.host ?? 'smtp')}
                    </span>
                    {p.quota_max_24h !== null && (
                      <span className="text-sm text-text-muted">
                        {t('deliverability.dailyQuota')}: {format.number(p.quota_sent_24h ?? 0)} /{' '}
                        {format.number(p.quota_max_24h)}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {onTestProvider && (
                      <Button
                        data-testid={`test-provider-${p.id}`}
                        pending={testing[p.id] === true}
                        onClick={() => void runTest(p.id)}
                      >
                        {t('sending.testConnection')}
                      </Button>
                    )}
                    {onMakeDefault && !p.is_default && (
                      <Button
                        data-testid={`make-default-${p.id}`}
                        pending={defaulting[p.id] === true}
                        onClick={() => void runMakeDefault(p.id)}
                      >
                        {t('sending.makeDefault')}
                      </Button>
                    )}
                    {result && (
                      <span
                        data-testid={`test-result-${p.id}`}
                        className={result.status === 'success' ? 'text-success' : 'text-danger'}
                      >
                        {result.status === 'success'
                          ? (result.detail ?? t('sending.testOk'))
                          : t('sending.testFailed')}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* U SMTP se seznam blokovaných adres nedoplňuje sám. Musí to být vidět trvale,
            ne jen jednou při zakládání účtu. */}
        {hasSmtp && (
          <Alert tone="warning" data-testid="smtp-warning">
            {t('smtpWarning')}
          </Alert>
        )}
      </section>

      <section aria-labelledby="domains-title" className="flex flex-col gap-4">
        <h2 id="domains-title" className="text-lg font-semibold">
          {t('sending.domainsTitle')}
        </h2>

        {domains.length === 0 ? (
          <EmptyState
            variant="first"
            title={t('sending.domainsEmpty')}
            explanation={t('sending.domainsEmptyExplanation')}
            actions={[{ label: t('sending.addDomain'), onClick: () => onAddDomain?.() }]}
          />
        ) : (
          <ul className="flex flex-col gap-3" data-testid="domain-list">
            {domains.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-3 rounded-[var(--radius-surface)] border border-border p-4"
              >
                <span className="font-mono">{d.domain}</span>
                <Badge
                  tone={d.dkim_ok === true ? 'success' : d.dkim_ok === false ? 'danger' : 'neutral'}
                  icon={
                    d.dkim_ok === true ? CheckIcon : d.dkim_ok === false ? WarningIcon : ClockIcon
                  }
                >
                  {t('dns.status.dkim')}
                </Badge>
                <Link
                  href={`${basePath}/settings/sending/domains/${d.id}`}
                  className="text-accent-text underline underline-offset-4"
                >
                  {t('sending.openDomain')}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <GuardThresholds
        settings={guards}
        limits={limits}
        {...(onSaveGuards ? { onSave: onSaveGuards } : {})}
      />
    </div>
  );
}
