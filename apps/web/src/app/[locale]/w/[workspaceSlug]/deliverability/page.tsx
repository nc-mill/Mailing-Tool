import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { DeliverabilityTiles } from '@/features/sending/deliverability-tiles';
import type { GuardLimits, GuardSettings } from '@/features/sending/guard-thresholds';

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

type PageProps = { params: Promise<{ locale: string; workspaceSlug: string }> };

type ProviderResponse = {
  data: Array<{
    id: string;
    type: string;
    is_default: boolean;
    enforcement_status: string | null;
    production_access: boolean | null;
    quota_max_24h: number | null;
    quota_sent_24h: number | null;
    quota_max_send_rate: number | null;
  }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('campaigns.deliverability');
  return { title: t('title') };
}

/**
 * Dashboard doručitelnosti. Zóny dlaždic se počítají z PRAHŮ ZE SERVERU, ne
 * z čísel zadrátovaných v komponentě: kdyby tam stálo 5 %, ukazovala by obrazovka
 * jinou hranici, než při které brzda opravdu sepne.
 *
 * Míry se ke dni psaní berou z čítačů kampaní, protože denní zrcadlo doručitelnosti
 * (fáze I plánu) zatím není. Až vznikne, mění se jen tenhle výpočet.
 */
export default async function DeliverabilityPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) notFound();
  const workspaceId = access.data.workspace.id;

  const [providers, guards, campaigns] = await Promise.all([
    apiFetch<ProviderResponse>('/api/v1/providers', { workspaceId }),
    apiFetch<{ settings: GuardSettings; limits: GuardLimits }>('/api/v1/settings/deliverability', {
      workspaceId,
    }),
    apiFetch<{
      data: Array<{
        counters: { sent: number; delivered: number; bounced: number; complained: number };
      }>;
    }>('/api/v1/campaigns', { workspaceId, searchParams: { limit: 100 } }),
  ]);

  if (!guards.ok) notFound();

  const account =
    providers.ok && providers.data.data.length > 0
      ? (providers.data.data.find((p) => p.is_default) ?? providers.data.data[0]!)
      : null;

  const totals = (campaigns.ok ? campaigns.data.data : []).reduce(
    (sum, c) => ({
      sent: sum.sent + c.counters.sent,
      delivered: sum.delivered + c.counters.delivered,
      bounced: sum.bounced + c.counters.bounced,
      complained: sum.complained + c.counters.complained,
    }),
    { sent: 0, delivered: 0, bounced: 0, complained: 0 },
  );

  const metrics =
    totals.sent === 0
      ? null
      : {
          bounce_rate: totals.bounced / totals.sent,
          complaint_rate: totals.complained / totals.sent,
          delivery_rate: totals.delivered / totals.sent,
          soft_rate: 0,
        };

  const limits = guards.data.limits;
  const settings = guards.data.settings;

  return (
    <DeliverabilityTiles
      metrics={metrics}
      account={
        account
          ? {
              enforcement_status: account.enforcement_status,
              production_access: account.production_access,
              quota_max_24h: account.quota_max_24h,
              quota_sent_24h: account.quota_sent_24h,
              quota_max_send_rate: account.quota_max_send_rate,
            }
          : null
      }
      unmatchedEvents={0}
      campaignsHref={`/w/${workspaceSlug}/campaigns`}
      thresholds={{
        bounce_warn_rate: settings.bounce_warn_rate ?? limits.DELIVERABILITY_BOUNCE_WARN_RATE,
        bounce_guard_rate: settings.bounce_guard_rate ?? limits.DELIVERABILITY_BOUNCE_GUARD_RATE,
        complaint_warn_rate:
          settings.complaint_warn_rate ?? limits.DELIVERABILITY_COMPLAINT_WARN_RATE,
        complaint_guard_rate:
          settings.complaint_guard_rate ?? limits.DELIVERABILITY_COMPLAINT_GUARD_RATE,
      }}
    />
  );
}
