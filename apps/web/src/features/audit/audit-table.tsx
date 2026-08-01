'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import {
  EmptyState,
  FilteredEmptyState,
  StaleBanner,
  StaleContent,
} from '@mlain/ui/patterns/states';
import { buildListHref, type Paginated } from '@/lib/api-client/cursor';
import type { Result } from '@/lib/api-client/result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { auditActionKey } from './audit-actions';

export type AuditRow = {
  id: string;
  actor_type: 'user' | 'api_key' | 'system';
  actor_id: string | null;
  actor_label: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  request_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

const ACTOR_TYPE_KEYS = {
  user: 'audit.actorType.user',
  api_key: 'audit.actorType.apiKey',
  system: 'audit.actorType.system',
} as const satisfies Record<AuditRow['actor_type'], string>;

export type AuditTableProps = {
  entries: Result<Paginated<AuditRow>>;
  filters: Record<string, string>;
  basePath: string;
  cursorDropped: boolean;
  /**
   * Stav S7. Obnova na pozadí selhala, takže se ukazují starší záznamy.
   * ISO čas posledního úspěšného načtení; `null` znamená, že data jsou čerstvá.
   */
  staleSince?: string | null | undefined;
};

/** Ztlumí obsah jen tehdy, když je zastaralý. Jinak ho nechá být. */
function StaleContentWhenStale({ stale, children }: { stale: boolean; children: React.ReactNode }) {
  return stale ? <StaleContent>{children}</StaleContent> : <>{children}</>;
}

export function AuditTable(props: AuditTableProps) {
  const t = useTranslations('settings');
  const format = useFormatter();
  const router = useRouter();

  if (!props.entries.ok) {
    return (
      <SettingsProblem
        problem={props.entries.problem}
        onRetry={() => {
          window.location.reload();
        }}
      />
    );
  }

  const { data: rows, pagination } = props.entries.data;
  const hasFilters = Object.keys(props.filters).length > 0;

  if (rows.length === 0) {
    return hasFilters ? (
      <FilteredEmptyState
        title={t('audit.emptyFiltered')}
        explanation={t('audit.emptyFilteredBody')}
        filterDescription={t('shared.filtersApplied', {
          summary: Object.values(props.filters).join(', '),
        })}
        clearFiltersLabel={t('shared.clearFilters')}
        onClearFilters={() => router.push(props.basePath)}
      />
    ) : (
      <EmptyState
        variant="first"
        title={t('audit.title')}
        explanation={t('audit.empty')}
        actions={[{ label: t('audit.emptyAction'), onClick: () => router.refresh() }]}
      />
    );
  }

  const stale = props.staleSince !== undefined && props.staleSince !== null;

  return (
    <>
      {props.cursorDropped ? (
        <p role="status" className="mb-4 rounded-md bg-surface-muted p-3 text-sm">
          {t('shared.cursorDropped')}
        </p>
      ) : null}

      {/*
        Stav S7: zastaralá data se **nezahazují ani neschovávají**. Zůstanou
        čitelná a použitelná, jen ztlumená, a nad nimi je vidět, jak jsou stará
        a jak zkusit obnovu znovu. Zobrazit čerstvě vypadající staré číslo je
        horší než přiznat stáří.
      */}
      {stale && props.staleSince ? (
        <div className="mb-4">
          <StaleBanner
            lastUpdatedLabel={t('states.staleTitle', {
              time: format.dateTime(new Date(props.staleSince), 'short'),
            })}
            retryAction={
              <Button type="button" variant="secondary" onClick={() => router.refresh()}>
                {t('shared.tryAgain')}
              </Button>
            }
          />
        </div>
      ) : null}

      <StaleContentWhenStale stale={stale}>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <caption className="sr-only">{t('audit.title')}</caption>
            <thead>
              <tr>
                <th scope="col" className="pb-2 pr-6">
                  {t('audit.table.when')}
                </th>
                <th scope="col" className="pb-2 pr-6">
                  {t('audit.table.actor')}
                </th>
                <th scope="col" className="pb-2 pr-6">
                  {t('audit.table.action')}
                </th>
                <th scope="col" className="pb-2 pr-6">
                  {t('audit.table.target')}
                </th>
                <th scope="col" className="pb-2 pr-6">
                  {t('audit.table.requestId')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const actionKey = auditActionKey(row.action);
                return (
                  <tr key={row.id} className="border-t border-border align-top">
                    <td className="py-3 pr-6">
                      <time dateTime={row.created_at} title={row.created_at}>
                        {format.dateTime(new Date(row.created_at), 'short')}
                      </time>
                    </td>
                    <td className="py-3 pr-6">
                      <p>{row.actor_label}</p>
                      <p className="text-sm text-text-muted">
                        {t(ACTOR_TYPE_KEYS[row.actor_type])}
                      </p>
                    </td>
                    <td className="py-3 pr-6">
                      {actionKey ? (
                        t(actionKey as 'audit.actions.user.login')
                      ) : (
                        <code className="text-sm">{row.action}</code>
                      )}
                    </td>
                    <td className="py-3 pr-6 text-sm">
                      {row.target_type === null ? '' : <code>{row.target_type}</code>}{' '}
                      {row.target_id === null ? '' : <code>{row.target_id}</code>}
                    </td>
                    <td className="py-3 pr-6">
                      {row.request_id === null ? (
                        ''
                      ) : (
                        <code className="text-sm">{row.request_id}</code>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </StaleContentWhenStale>

      <p className="mt-4 text-sm text-text-muted">{t('audit.retention')}</p>

      <nav aria-label={t('audit.title')} className="mt-4 flex gap-4">
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
  );
}
