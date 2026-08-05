import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { SendersScreen, type SenderIdentityView } from '@/features/senders/senders-screen';
import type { SenderDomainOption } from '@/features/senders/sender-dialog';

/**
 * Stránka závisí na přihlášeném uživateli, takže se NEPŘEDRENDEROVÁVÁ. Bez
 * tohohle ji Next při `next build` vykreslí a spadne na chybějící relaci; totéž
 * hlídá `apps/web/test/ci/no-static-pages.test.ts`.
 */
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ locale: string; workspaceSlug: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('campaigns.senders');
  return { title: t('title') };
}

type DomainRow = { id: string; domain: string; provider_id: string; verified_at: string | null };
type ProviderRow = { id: string; name: string };

export default async function SendersSettingsPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) notFound();
  const workspaceId = access.data.workspace.id;

  const [identities, domains, providers] = await Promise.all([
    apiFetch<{ data: SenderIdentityView[] }>('/api/v1/senders', { workspaceId }),
    apiFetch<{ data: DomainRow[] }>('/api/v1/domains', { workspaceId }),
    apiFetch<{ data: ProviderRow[] }>('/api/v1/providers', { workspaceId }),
  ]);

  /*
   * Číselníky se při selhání degradují na prázdno, ne na 404: obrazovka se
   * seznamem předvoleb má smysl i tehdy, když se zrovna nepodařilo načíst
   * domény, jen v ní nepůjde založit nová. Týž vzor jako na obrazovce odesílání.
   */
  const providerNames = new Map(
    (providers.ok ? providers.data.data : []).map((p) => [p.id, p.name]),
  );
  const domainOptions: SenderDomainOption[] = (domains.ok ? domains.data.data : []).map((d) => ({
    id: d.id,
    domain: d.domain,
    provider_id: d.provider_id,
    provider_name: providerNames.get(d.provider_id) ?? d.provider_id,
    // `verified_at` plní VÝHRADNĚ odpověď Amazonu na `GetEmailIdentity`, ne naše
    // kontrola DNS. Je to jediný zdroj pravdy o tom, jestli se z domény odešle.
    verified: d.verified_at !== null,
  }));

  return (
    <SendersScreen
      identities={identities.ok ? identities.data.data : []}
      domains={domainOptions}
      workspaceId={workspaceId}
      basePath={`/w/${workspaceSlug}`}
      canEdit={access.data.permissions.includes('providers:write')}
    />
  );
}
