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
        <p
          role="status"
          className="rounded-[var(--radius-control)] bg-surface-muted p-[var(--spacing-inline)] text-meta"
        >
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
        <div className="flex flex-col gap-1.5">
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
          <table className="w-full border-collapse text-left text-ui">
            <caption className="sr-only">{t('audit.title')}</caption>
            <thead>
              <tr className="bg-surface-muted">
                <th
                  scope="col"
                  className="meta-caps px-[var(--spacing-row-x)] py-3 text-text-muted"
                >
                  {t('audit.table.when')}
                </th>
                <th
                  scope="col"
                  className="meta-caps px-[var(--spacing-row-x)] py-3 text-text-muted"
                >
                  {t('audit.table.actor')}
                </th>
                <th
                  scope="col"
                  className="meta-caps px-[var(--spacing-row-x)] py-3 text-text-muted"
                >
                  {t('audit.table.action')}
                </th>
                <th
                  scope="col"
                  className="meta-caps px-[var(--spacing-row-x)] py-3 text-text-muted"
                >
                  {t('audit.table.target')}
                </th>
                <th
                  scope="col"
                  className="meta-caps px-[var(--spacing-row-x)] py-3 text-text-muted"
                >
                  {t('audit.table.requestId')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const actionKey = auditActionKey(row.action);
                return (
                  <tr
                    key={row.id}
                    className="border-b border-border align-top hover:bg-surface-muted"
                  >
                    <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)]">
                      {/* Čas se čte po znacích, takže mono. */}
                      <time
                        dateTime={row.created_at}
                        title={row.created_at}
                        className="font-mono text-meta whitespace-nowrap"
                      >
                        {format.dateTime(new Date(row.created_at), 'short')}
                      </time>
                    </td>
                    <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)]">
                      {/* Aktér je buď jméno, nebo identifikátor klíče; obojí se
                          čte po znacích, takže mono. */}
                      <p className="font-mono text-meta break-all text-text">{row.actor_label}</p>
                      <p className="text-meta text-text-muted">
                        {t(ACTOR_TYPE_KEYS[row.actor_type])}
                      </p>
                    </td>
                    <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)]">
                      {actionKey ? (
                        t(actionKey as 'audit.actions.user.login')
                      ) : (
                        <code className="font-mono text-meta">{row.action}</code>
                      )}
                    </td>
                    <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)] text-meta">
                      {row.target_type === null ? (
                        ''
                      ) : (
                        <code className="font-mono break-all">{row.target_type}</code>
                      )}{' '}
                      {row.target_id === null ? (
                        ''
                      ) : (
                        <code className="font-mono break-all text-text-muted">{row.target_id}</code>
                      )}
                    </td>
                    <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)]">
                      {row.request_id === null ? (
                        ''
                      ) : (
                        <code className="font-mono text-meta break-all text-text-muted">
                          {row.request_id}
                        </code>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </StaleContentWhenStale>

      <p className="text-meta text-text-muted">{t('audit.retention')}</p>

      <nav
        aria-label={t('audit.title')}
        className="mt-[var(--spacing-stack)] flex gap-[var(--spacing-gutter)]"
      >
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
