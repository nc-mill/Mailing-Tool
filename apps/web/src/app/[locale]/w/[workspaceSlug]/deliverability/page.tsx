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

/**
 * Dlaždice přehledu tak, jak je vrací `/api/v1/dashboard`. Popsané jsou jen
 * dvě, které tahle obrazovka čte; zbytek dokumentu se schválně netypuje, aby
 * se přidání dlaždice nemuselo promítat sem.
 */
type DashboardResponse = {
  tiles: Record<
    string,
    { status: 'ok'; data: Record<string, unknown> } | { status: 'error'; code: string }
  >;
};

/** Míra z odpovědi API. `null` znamená „nemá jmenovatele", ne nulu. */
function asRate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

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

  const [providers, guards, dashboard] = await Promise.all([
    apiFetch<ProviderResponse>('/api/v1/providers', { workspaceId }),
    apiFetch<{ settings: GuardSettings; limits: GuardLimits }>('/api/v1/settings/deliverability', {
      workspaceId,
    }),
    /*
     * Míry se BEROU HOTOVÉ z dlaždic přehledu, nepočítají se tady znovu.
     *
     * Dřív si je stránka skládala sama ze součtu čítačů `/api/v1/campaigns`.
     * Tím vzniklo druhé místo s vlastní úvahou o doručenosti a rozešlo se
     * s reportem: kampaň, od jejíž odesílací služby nedorazila ani jedna
     * zpráva o osudu e-mailů, má odrazy i stížnosti na nule, a stránka z toho
     * spočítala „Nedoručitelnost 0 %" a obarvila dlaždici zeleně. Nula tam
     * přitom nebyla údaj, ale jeho absence.
     *
     * `/api/v1/dashboard` počítá míry výhradně z kampaní, u kterých doručenost
     * ZNÁME (`isDeliveredKnown`), a když taková není ani jedna, hlásí dlaždice
     * problémů stupeň `unknown`. Je to totéž pravidlo, které používá report
     * kampaně, takže třetí výklad už nevznikne.
     *
     * Okno je 90 dní, ne posledních sto kampaní bez ohledu na stáří: prahy
     * doručitelnosti se vztahují k tomu, jak odesíláme TEĎ.
     */
    apiFetch<DashboardResponse>('/api/v1/dashboard', {
      workspaceId,
      searchParams: { period: 90 },
    }),
  ]);

  if (!guards.ok) notFound();

  const account =
    providers.ok && providers.data.data.length > 0
      ? (providers.data.data.find((p) => p.is_default) ?? providers.data.data[0]!)
      : null;

  const tiles = dashboard.ok ? dashboard.data.tiles : {};
  const sentTile = tiles['sent'];
  const problemsTile = tiles['problems'];
  const sent = sentTile?.status === 'ok' ? Number(sentTile.data['value'] ?? 0) : 0;
  const problems = problemsTile?.status === 'ok' ? problemsTile.data : null;

  /*
   * Prázdný stav zůstává, jaký byl: dokud se nic neodeslalo, není co měřit
   * a obrazovka nabídne cestu ke kampaním. „Nevíme" je něco jiného než
   * „ještě jste nic neposlali" a nesmí to splynout.
   */
  const metrics =
    sent === 0 || problems === null
      ? null
      : {
          bounce_rate: asRate(problems['bounceRate']),
          complaint_rate: asRate(problems['complaintRate']),
          // Stupeň `unknown` znamená, že ze VŠECH odeslaných kampaní období
          // neznáme osud ani jedné. Pak se procenta nemají z čeho počítat.
          delivery_known: problems['level'] !== 'unknown',
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
      /*
       * Nespárované události zatím nikdo nepočítá: v aplikaci pro ně není
       * zdroj. Nula předávaná natvrdo z nich na obrazovce dělala měření,
       * takže se posílá `null` a dlaždice řekne, že to nevíme.
       */
      unmatchedEvents={null}
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
