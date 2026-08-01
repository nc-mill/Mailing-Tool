'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { EmptyState, FilteredEmptyState } from '@mlain/ui/patterns/states';
import { CheckIcon, ClockIcon, RunningIcon, SlashIcon, WarningIcon } from '@/lib/ui/status-icons';
import { buildListHref, type Paginated } from '@/lib/api-client/cursor';
import type { Result } from '@/lib/api-client/result';
import { SettingsProblem } from '@/features/settings/settings-problem';

export type DeliveryStatus = 'pending' | 'delivering' | 'succeeded' | 'failed' | 'abandoned';

export type DeliveryRow = {
  id: string;
  event_id: string;
  event_type: string;
  status: DeliveryStatus;
  attempt: number;
  next_attempt_at: string | null;
  response_status: number | null;
  response_body_snippet: string | null;
  duration_ms: number | null;
  error_code: string | null;
  delivered_at: string | null;
  created_at: string;
};

const STATUS_KEYS = {
  pending: 'webhooks.deliveries.status.pending',
  delivering: 'webhooks.deliveries.status.delivering',
  succeeded: 'webhooks.deliveries.status.succeeded',
  failed: 'webhooks.deliveries.status.failed',
  abandoned: 'webhooks.deliveries.status.abandoned',
} as const satisfies Record<DeliveryStatus, string>;

// `Badge` zná jen neutral, accent, success, warning a danger. Tón `info` neexistuje.
const STATUS_TONES = {
  pending: 'neutral',
  delivering: 'accent',
  succeeded: 'success',
  failed: 'danger',
  abandoned: 'danger',
} as const;

const DELIVERY_ICONS: Record<DeliveryStatus, React.ReactNode> = {
  pending: ClockIcon,
  delivering: RunningIcon,
  succeeded: CheckIcon,
  failed: WarningIcon,
  abandoned: SlashIcon,
};

const RETRYABLE: DeliveryStatus[] = ['failed', 'abandoned'];

export type DeliveriesTableProps = {
  deliveries: Result<Paginated<DeliveryRow>>;
  filters: Record<string, string>;
  basePath: string;
  cursorDropped: boolean;
  canWrite: boolean;
  workspaceId: string;
  slug: string;
  endpointId: string;
  retryAction: (formData: FormData) => void;
};

export function DeliveriesTable(props: DeliveriesTableProps) {
  const t = useTranslations('settings');
  const format = useFormatter();
  const router = useRouter();

  if (!props.deliveries.ok) {
    return (
      <SettingsProblem
        problem={props.deliveries.problem}
        onRetry={() => {
          window.location.reload();
        }}
      />
    );
  }

  const { data: rows, pagination } = props.deliveries.data;
  const hasFilters = Object.keys(props.filters).length > 0;

  const filterSummary = Object.entries(props.filters)
    .map(([key, value]) => (key === 'status' ? t(STATUS_KEYS[value as DeliveryStatus]) : value))
    .join(', ');

  return (
    <section aria-labelledby="webhook-deliveries">
      <h2 id="webhook-deliveries" className="text-xl font-semibold">
        {t('webhooks.deliveries.title')}
      </h2>
      <p className="mt-2 text-text-muted">{t('webhooks.deliveries.lead')}</p>

      {props.cursorDropped ? (
        <p role="status" className="mt-4 rounded-md bg-surface-muted p-3 text-sm">
          {t('shared.cursorDropped')}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <div className="mt-4">
          {hasFilters ? (
            <FilteredEmptyState
              title={t('webhooks.deliveries.emptyFiltered')}
              explanation={t('webhooks.deliveries.emptyFilteredBody')}
              // Filtr se zopakuje slovy, ne jménem parametru v URL (6.5).
              filterDescription={t('shared.filtersApplied', { summary: filterSummary })}
              clearFiltersLabel={t('shared.clearFilters')}
              onClearFilters={() => router.push(props.basePath)}
            />
          ) : (
            <EmptyState
              variant="first"
              title={t('webhooks.deliveries.title')}
              explanation={t('webhooks.deliveries.empty')}
              actions={[
                {
                  label: t('webhooks.deliveries.emptyAction'),
                  onClick: () => router.refresh(),
                },
              ]}
            />
          )}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="mt-4 w-full text-left">
              <caption className="sr-only">{t('webhooks.deliveries.title')}</caption>
              <thead>
                <tr>
                  <th scope="col" className="pb-2 pr-6">
                    {t('webhooks.deliveries.table.eventType')}
                  </th>
                  <th scope="col" className="pb-2 pr-6">
                    {t('webhooks.deliveries.table.status')}
                  </th>
                  <th scope="col" className="pb-2 pr-6">
                    {t('webhooks.deliveries.table.attempt')}
                  </th>
                  <th scope="col" className="pb-2 pr-6">
                    {t('webhooks.deliveries.table.responseStatus')}
                  </th>
                  <th scope="col" className="pb-2 pr-6">
                    {t('webhooks.deliveries.table.createdAt')}
                  </th>
                  <th scope="col" className="pb-2 pr-6">
                    {t('members.table.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-border align-top">
                    <td className="py-3 pr-6">
                      <code className="text-sm">{row.event_type}</code>
                    </td>
                    <td className="py-3 pr-6">
                      <Badge tone={STATUS_TONES[row.status]} icon={DELIVERY_ICONS[row.status]}>
                        {t(STATUS_KEYS[row.status])}
                      </Badge>
                      {row.error_code === 'blocked_target' ? (
                        <p className="mt-1 text-sm text-danger-text">
                          {t('webhooks.deliveries.blockedTarget')}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-3 pr-6">{row.attempt}</td>
                    <td className="py-3 pr-6">
                      {row.response_status === null ? '' : row.response_status}
                      {row.response_body_snippet === null ? null : (
                        <details className="mt-1 text-sm">
                          <summary className="cursor-pointer">
                            {t('webhooks.deliveries.responseSnippet')}
                          </summary>
                          <pre className="mt-1 whitespace-pre-wrap break-all">
                            {row.response_body_snippet}
                          </pre>
                        </details>
                      )}
                    </td>
                    <td className="py-3 pr-6">
                      <time dateTime={row.created_at} title={row.created_at}>
                        {format.dateTime(new Date(row.created_at), 'short')}
                      </time>
                    </td>
                    <td className="py-3 pr-6">
                      {props.canWrite && RETRYABLE.includes(row.status) ? (
                        <form action={props.retryAction}>
                          <input
                            type="hidden"
                            name="workspace_id"
                            value={props.workspaceId}
                            readOnly
                          />
                          <input type="hidden" name="slug" value={props.slug} readOnly />
                          <input
                            type="hidden"
                            name="endpoint_id"
                            value={props.endpointId}
                            readOnly
                          />
                          <input type="hidden" name="delivery_id" value={row.id} readOnly />
                          <Button type="submit" variant="secondary">
                            {t('webhooks.deliveries.retry')}
                          </Button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav aria-label={t('webhooks.deliveries.title')} className="mt-4 flex gap-4">
            {pagination.prev_cursor ? (
              <Link
                href={buildListHref(props.basePath, props.filters, pagination.prev_cursor)}
                className="underline"
              >
                {t('shared.previousPage')}
              </Link>
            ) : null}
            {pagination.next_cursor ? (
              <Link
                href={buildListHref(props.basePath, props.filters, pagination.next_cursor)}
                className="underline"
              >
                {t('shared.nextPage')}
              </Link>
            ) : null}
          </nav>
        </>
      )}
    </section>
  );
}
