'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { Badge } from '@mlain/ui/components/badge';
import { EmptyState, OverLimitState } from '@mlain/ui/patterns/states';
import { CheckIcon, SlashIcon, WarningIcon } from '@/lib/ui/status-icons';
import type { Result } from '@/lib/api-client/result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { DisabledBanner } from './disabled-banner';

/** Maximum endpointů na projekt podle 3.8 části 1. */
export const WEBHOOK_ENDPOINT_LIMIT = 20;

export type WebhookRow = {
  id: string;
  url: string;
  description: string;
  event_types: string[];
  status: 'active' | 'disabled';
  disabled_reason: string | null;
  disabled_at: string | null;
  consecutive_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
};

export type WebhooksTableProps = {
  endpoints: Result<{ data: WebhookRow[] }>;
  canWrite: boolean;
  workspaceId: string;
  slug: string;
  /** Příznak z URL, který rozliší stav S3 od S1, viz rozhodnutí R8. */
  emptied: boolean;
  enableAction: (formData: FormData) => void;
};

export function WebhooksTable(props: WebhooksTableProps) {
  const t = useTranslations('settings');
  const format = useFormatter();
  const router = useRouter();
  const [now] = useState(() => new Date());

  if (!props.endpoints.ok) {
    return (
      <SettingsProblem
        problem={props.endpoints.problem}
        onRetry={() => {
          window.location.reload();
        }}
      />
    );
  }

  const rows = props.endpoints.data.data;

  if (rows.length === 0) {
    return (
      <EmptyState
        // Varianta rozliší stav S1 od S3, viz rozhodnutí R8. Komponenta ji
        // vypíše do `data-variant`, takže na ni jde v testu sáhnout
        // strukturálně, bez kontroly znění věty.
        variant={props.emptied ? 'emptied' : 'first'}
        title={t('webhooks.title')}
        explanation={props.emptied ? t('webhooks.emptyAfterDelete') : t('webhooks.empty')}
        actions={
          props.canWrite
            ? [
                {
                  label: t('webhooks.emptyAction'),
                  // ODCHYLKA OD PLÁNU: plán mířil na `/settings/webhooks/new`,
                  // jenže taková stránka neexistuje a odkaz by skončil na 404.
                  // Formulář stojí rovnou pod tabulkou, tak do něj akce zaostří.
                  onClick: () => document.getElementById('webhook-url')?.focus(),
                },
              ]
            : [
                {
                  label: t('shared.backToOverview'),
                  onClick: () => router.push(`/w/${props.slug}`),
                  description: t('webhooks.emptyNoPermission'),
                },
              ]
        }
      />
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <caption className="sr-only">{t('webhooks.title')}</caption>
          <thead>
            <tr>
              <th scope="col" className="pb-2 pr-6">
                {t('webhooks.table.url')}
              </th>
              <th scope="col" className="pb-2 pr-6">
                {t('webhooks.table.events')}
              </th>
              <th scope="col" className="pb-2 pr-6">
                {t('webhooks.table.status')}
              </th>
              <th scope="col" className="pb-2 pr-6">
                {t('webhooks.table.lastDelivery')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = `/w/${props.slug}/settings/webhooks/${row.id}`;
              return (
                <tr key={row.id} className="border-t border-border align-top">
                  <td className="py-3 pr-6">
                    <Link href={href} className="font-medium underline">
                      {row.url}
                    </Link>
                    {row.description === '' ? null : (
                      <p className="text-sm text-text-muted">{row.description}</p>
                    )}
                    {row.status === 'disabled' && props.canWrite ? (
                      <form action={props.enableAction} className="mt-2">
                        <input
                          type="hidden"
                          name="workspace_id"
                          value={props.workspaceId}
                          readOnly
                        />
                        <input type="hidden" name="slug" value={props.slug} readOnly />
                        <input type="hidden" name="endpoint_id" value={row.id} readOnly />
                        <DisabledBanner
                          url={row.url}
                          lastStatus={null}
                          since={row.disabled_at}
                          withDetail={false}
                          endpointHref={href}
                          onEnable={() => undefined}
                        />
                      </form>
                    ) : null}
                  </td>
                  <td className="py-3 pr-6 text-sm">{row.event_types.join(', ')}</td>
                  <td className="py-3 pr-6">
                    {row.status === 'disabled' ? (
                      <Badge tone="danger" icon={SlashIcon}>
                        {t('webhooks.status.disabled')}
                      </Badge>
                    ) : row.consecutive_failures > 0 ? (
                      <Badge tone="warning" icon={WarningIcon}>
                        {t('webhooks.status.failing', { count: row.consecutive_failures })}
                      </Badge>
                    ) : (
                      <Badge tone="success" icon={CheckIcon}>
                        {t('webhooks.status.active')}
                      </Badge>
                    )}
                  </td>
                  <td className="py-3 pr-6">
                    {row.last_success_at === null ? (
                      t('shared.never')
                    ) : (
                      <time dateTime={row.last_success_at} title={row.last_success_at}>
                        {format.relativeTime(new Date(row.last_success_at), now)}
                      </time>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length >= WEBHOOK_ENDPOINT_LIMIT ? (
        <div className="mt-6">
          <OverLimitState title={t('webhooks.limitTitle')} body={t('webhooks.limitBody')} />
        </div>
      ) : null}
    </>
  );
}
