'use client';

import { useActionState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { CardTitle } from '@mlain/ui/components/card';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { Alert } from '@mlain/ui/patterns/states';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { addTrackingDomainAction, removeTrackingDomainAction } from './actions';

export type TrackingDomainView = {
  id: string;
  host: string;
  includeSubdomains: boolean;
  /** ISO řetězec, protože serverová komponenta nesmí posílat Date do klienta. */
  verifiedAt: string | null;
  /** Vnitřní adresa, na kterou cizí prohlížeč nedosáhne. */
  internal: boolean;
};

export type TrackingDomainsProps = {
  workspaceSlug: string;
  domains: readonly TrackingDomainView[];
  canWrite: boolean;
  domainLimit: number;
};

/**
 * Seznam měřicích domén a formulář na přidání.
 *
 * Bez jediné domény se měření NESPUSTÍ NIKDE, protože `/e/track` odmítá každý
 * `Origin`, který v seznamu není. Prázdný stav to proto říká rovnou, ne až
 * v nápovědě: je to nejčastější důvod, proč po vložení úryvku nic nechodí.
 */
export function TrackingDomains({
  workspaceSlug,
  domains,
  canWrite,
  domainLimit,
}: TrackingDomainsProps) {
  const t = useTranslations('tracking');
  const format = useFormatter();
  const [addState, addAction] = useActionState<ActionState, FormData>(
    addTrackingDomainAction,
    IDLE,
  );
  const [, removeAction] = useActionState<ActionState, FormData>(removeTrackingDomainAction, IDLE);

  const errorText = (code: string): string => {
    // Klíč se neskládá za běhu, viz zákaz v 7.2 části 6.
    if (code === 'tracking_domain_limit_reached') {
      return t('settings.errors.tracking_domain_limit_reached', { limit: domainLimit });
    }
    if (code === 'tracking_domain_invalid') return t('settings.errors.tracking_domain_invalid');
    if (code === 'forbidden') return t('settings.errors.forbidden');
    return t('settings.errors.unexpected');
  };

  return (
    <section
      aria-labelledby="tracking-domains"
      className="flex flex-col gap-[var(--spacing-gutter)]"
    >
      <CardTitle>
        <span id="tracking-domains">{t('settings.domains.title')}</span>
      </CardTitle>
      <p className="text-meta text-text-muted">{t('settings.domains.description')}</p>

      {addState.status === 'error' ? (
        <div>
          <Alert tone="error" data-error-code={addState.problem.code}>
            {errorText(addState.problem.code)}
          </Alert>
        </div>
      ) : null}

      {domains.length === 0 ? (
        <div>
          <Alert tone="warning">{t('settings.domains.empty')}</Alert>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-[var(--radius-surface)] border border-border">
          {domains.map((domain) => (
            <li key={domain.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <p className="text-ui font-semibold text-text">
                  {domain.includeSubdomains ? `*.${domain.host}` : domain.host}
                </p>
                <p className="text-meta text-text-muted">
                  {domain.verifiedAt === null
                    ? t('settings.domains.unverified')
                    : t('settings.domains.verified', {
                        date: format.dateTime(new Date(domain.verifiedAt), 'short'),
                      })}
                </p>
                {domain.internal ? (
                  <p className="text-meta text-warning-text">{t('settings.domains.internal')}</p>
                ) : null}
              </div>
              {canWrite ? (
                <form action={removeAction}>
                  <input type="hidden" name="workspace_slug" value={workspaceSlug} readOnly />
                  <input type="hidden" name="id" value={domain.id} readOnly />
                  <Button type="submit" variant="secondary">
                    {t('settings.domains.remove')}
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canWrite ? (
        <form
          action={addAction}
          className="flex flex-wrap items-end gap-[var(--spacing-gutter)]"
          noValidate
        >
          <input type="hidden" name="workspace_slug" value={workspaceSlug} readOnly />
          <div className="min-w-64">
            <Label htmlFor="tracking-domain-host">{t('settings.domains.host_label')}</Label>
            <Input
              id="tracking-domain-host"
              name="host"
              placeholder={t('settings.domains.host_placeholder')}
            />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Checkbox id="tracking-domain-subdomains" name="include_subdomains" />
            <Label htmlFor="tracking-domain-subdomains">
              {t('settings.domains.include_subdomains')}
            </Label>
          </div>
          <Button type="submit" variant="primary">
            {t('settings.domains.add')}
          </Button>
        </form>
      ) : null}
    </section>
  );
}
