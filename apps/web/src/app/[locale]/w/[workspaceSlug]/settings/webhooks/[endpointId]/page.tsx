import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  enableWebhookFormAction,
  retryDeliveryFormAction,
} from '@/features/webhooks/actions-forms';
import { DeliveriesTable, type DeliveryRow } from '@/features/webhooks/deliveries-table';
import { DisabledBanner } from '@/features/webhooks/disabled-banner';
import { TestWebhookPanel } from '@/features/webhooks/test-webhook-panel';
import { WebhookForm } from '@/features/webhooks/webhook-form';
import { MVP0_EVENT_TYPES } from '@/features/webhooks/event-types';
import type { WebhookRow } from '@/features/webhooks/webhooks-table';
import { SettingsPageShell } from '@/features/settings/settings-page-shell';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { ForbiddenSection } from '@/features/settings/forbidden-section';
import { apiFetch } from '@/lib/api-client/fetch';
import {
  fetchListWithCursorFallback,
  readCursor,
  readFilters,
  type Paginated,
} from '@/lib/api-client/cursor';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';

/**
 * Stránka závisí na přihlášeném uživateli, takže se NEPŘEDRENDEROVÁVÁ.
 *
 * Bez tohohle ji Next při `next build` vykreslí a spadne, protože v době
 * sestavení žádná relace neexistuje:
 *
 *   TypeError: Cannot read properties of null (reading 'useContext')
 *   Export encountered an error on <cesta>, exiting the build.
 *
 * Chyba nemíří na příčinu, takže se hledá v komponentách. Statická podoba
 * téhle stránky přitom neexistuje: obsah je pro každého jiný.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('webhooks.title') };
}

const DELIVERY_FILTERS = ['status', 'event_type'] as const;

export default async function WebhookDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; endpointId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceSlug, endpointId } = await params;
  const query = await searchParams;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <SettingsProblem problem={access.problem} />;
  }

  if (!hasPermission(access.data, 'webhooks:read')) {
    return (
      <ForbiddenSection
        permission="webhooks:read"
        currentRole={access.data.role}
        workspaceSlug={workspaceSlug}
      />
    );
  }

  const canWrite = hasPermission(access.data, 'webhooks:write');
  const workspaceId = access.data.workspace.id;
  const filters = readFilters(query, DELIVERY_FILTERS);
  const cursor = readCursor(query);
  const basePath = `/w/${workspaceSlug}/settings/webhooks/${endpointId}`;

  const [endpoint, deliveries] = await Promise.all([
    // `GET /api/v1/webhook-endpoints/{id}` vrací endpoint zabalený do
    // `{ endpoint: … }`, ne holý objekt. Ověřeno ve schématu OpenAPI běžící
    // instance a pohledem do prohlížeče: bez rozbalení zůstal nadpis detailu
    // i formulář úprav prázdný a nic přitom nespadlo.
    apiFetch<{ endpoint: WebhookRow }>(`/api/v1/webhook-endpoints/${endpointId}`, { workspaceId }),
    fetchListWithCursorFallback<DeliveryRow>(
      (nextCursor) =>
        apiFetch<Paginated<DeliveryRow>>('/api/v1/webhook-deliveries', {
          workspaceId,
          searchParams: { endpoint_id: endpointId, ...filters, cursor: nextCursor, limit: 50 },
        }),
      cursor,
    ),
  ]);

  if (!endpoint.ok) {
    if (endpoint.problem.status === 404) notFound();
    return <SettingsProblem problem={endpoint.problem} />;
  }

  const detail = endpoint.data.endpoint;

  return (
    <SettingsPageShell title={detail.url} lead={detail.description}>
      <div className="space-y-12">
        {detail.status === 'disabled' && canWrite ? (
          <form action={enableWebhookFormAction}>
            <input type="hidden" name="workspace_id" value={workspaceId} readOnly />
            <input type="hidden" name="slug" value={workspaceSlug} readOnly />
            <input type="hidden" name="endpoint_id" value={endpointId} readOnly />
            <DisabledBanner
              url={detail.url}
              lastStatus={null}
              since={detail.disabled_at}
              withDetail
              endpointHref={basePath}
              onEnable={() => undefined}
            />
          </form>
        ) : null}

        {canWrite ? (
          <TestWebhookPanel
            workspaceId={workspaceId}
            slug={workspaceSlug}
            endpointId={endpointId}
          />
        ) : null}

        <DeliveriesTable
          deliveries={deliveries.result}
          filters={filters}
          basePath={basePath}
          cursorDropped={deliveries.cursorDropped}
          canWrite={canWrite}
          workspaceId={workspaceId}
          slug={workspaceSlug}
          endpointId={endpointId}
          retryAction={retryDeliveryFormAction}
        />

        {canWrite ? (
          <WebhookForm
            mode="edit"
            workspaceId={workspaceId}
            slug={workspaceSlug}
            endpoint={detail}
            availableEventTypes={MVP0_EVENT_TYPES}
          />
        ) : null}
      </div>
    </SettingsPageShell>
  );
}
