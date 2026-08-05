import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { loadConfig } from '@mlain/core/config';
import { createWorkspaceContext } from '@mlain/core/identity/context';
import {
  TRACKING_DOMAIN_LIMIT,
  classifyTrackingDomain,
  ensurePublicTrackingKey,
  listTrackingDomains,
  readTrackingSettings,
  readWebTrackingStatus,
} from '@mlain/core/tracking';
import { ForbiddenSection } from '@/features/settings/forbidden-section';
import { SettingsPageShell } from '@/features/settings/settings-page-shell';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { IdentifySignatureHelp } from '@/features/tracking/identify-signature-help';
import { TrackingDomains, type TrackingDomainView } from '@/features/tracking/tracking-domains';
import { TrackingSnippet } from '@/features/tracking/tracking-snippet';
import { TrackingStatus } from '@/features/tracking/tracking-status';
import { UnreachableDomainAlert } from '@/features/tracking/unreachable-domain-alert';
import { requireUser } from '@/lib/identity/require-user';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';

/**
 * Obrazovka „Nastavení → Měření".
 *
 * Sem si uživatel chodí pro měřicí kód. Do teď takové místo neexistovalo,
 * takže veřejný klíč ani měřicí doména v databázi nikdy nevznikly a povrch
 * `/e/**` odmítal úplně všechno, naprosto správně.
 *
 * VLASTNÍ POLOŽKA NASTAVENÍ, ne odstavec v „Odesílání". Odesílání je o účtech,
 * doménách a DNS pro POŠTU. Tohle je kód, který si člověk vloží na svůj web,
 * a hledá ho tehdy, když web nasazuje, ne když řeší rozesílku. Položka
 * `settings-tracking` je v registru navigace zaregistrovaná už delší dobu,
 * jen měla `mvp0: false`, protože za ní žádná obrazovka nebyla.
 *
 * Stránka se NEPŘEDRENDEROVÁVÁ: obsah je pro každý projekt jiný a v době
 * sestavení neexistuje ani relace, ani databáze.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('tracking');
  return { title: t('settings.title') };
}

/** Velikost sestaveného SDK, aby text „váží X" nelhal. */
function sdkSize(): string {
  for (const candidate of [
    'packages/sdk-web/dist/ml.js',
    '../packages/sdk-web/dist/ml.js',
    '../../packages/sdk-web/dist/ml.js',
  ]) {
    try {
      const bytes = statSync(join(process.cwd(), candidate)).size;
      return `${(bytes / 1024).toFixed(1)} kB`;
    } catch {
      // zkus další
    }
  }
  return '10 kB';
}

export default async function TrackingSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const t = await getTranslations('tracking');

  const me = await requireUser(`/w/${workspaceSlug}/settings/tracking`);
  if (!me.ok) return <SettingsProblem problem={me.problem} />;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <SettingsProblem problem={access.problem} />;
  }

  if (!hasPermission(access.data, 'workspace:update')) {
    return (
      <ForbiddenSection
        permission="workspace:update"
        currentRole={access.data.role}
        workspaceSlug={workspaceSlug}
      />
    );
  }

  const config = loadConfig();
  const trackingHost = config.TRACKING_DOMAIN;

  /**
   * Doménové funkce si samy otevírají transakci, takže rozsah musí přijít
   * jako KONTEXT, ne jako identifikátor projektu. `createWorkspaceContext` je
   * jediná legitimní továrna a členství ověřuje proti relaci, takže cizí
   * projekt sem nejde podstrčit ani úpravou adresy.
   */
  const ctx = await createWorkspaceContext({
    kind: 'session',
    userId: me.data.user.id,
    workspaceRef: workspaceSlug,
  });

  /**
   * Klíč se zakládá při PRVNÍM otevření obrazovky, ne zvláštním tlačítkem.
   * Veřejný klíč není tajemství, nic se s ním nedá přečíst a bez něj je celá
   * obrazovka k ničemu. Tlačítko „vygenerovat" by byl krok navíc, který nemá
   * druhou možnost.
   */
  const [publicKey, domainRows, status, settings] = await Promise.all([
    /**
     * Kdo klíč založil, se předává z relace, ne z `WorkspaceAccess`: ten nese
     * jméno uživatele, ne jeho ID, ale `me.data.user` má obojí a je načtený
     * tak jako tak, takže to nestojí ani jeden dotaz navíc.
     *
     * Bez e-mailu by v auditu zůstal záznam bez čitelného aktéra. `actor_label`
     * je zmrazený text, ne odkaz, aby dával smysl i po smazání uživatele.
     */
    ensurePublicTrackingKey(ctx, me.data.user.id, me.data.user.email),
    listTrackingDomains(ctx),
    readWebTrackingStatus(ctx),
    readTrackingSettings(ctx),
  ]);

  const reach = classifyTrackingDomain(trackingHost);

  const domains: TrackingDomainView[] = domainRows.map((row) => ({
    id: row.id,
    host: row.host,
    includeSubdomains: row.includeSubdomains,
    verifiedAt: row.verifiedAt === null ? null : row.verifiedAt.toISOString(),
    internal: classifyTrackingDomain(row.host).kind !== 'public',
  }));

  return (
    <SettingsPageShell title={t('settings.title')} lead={t('settings.lead')}>
      <div className="space-y-12">
        {reach.kind === 'public' ? null : (
          <UnreachableDomainAlert kind={reach.kind} host={reach.host} variant="settings" />
        )}

        <TrackingSnippet publicKey={publicKey.key} host={trackingHost} size={sdkSize()} />

        {/* Návod na podpis patří hned za úryvek, ne až na konec: je to druhý
            krok téhož nasazení a bez něj server odmítne každé `identify`
            s e-mailem, aniž by kdokoli tušil proč. */}
        <IdentifySignatureHelp />

        <TrackingDomains
          workspaceSlug={workspaceSlug}
          domains={domains}
          canWrite
          domainLimit={TRACKING_DOMAIN_LIMIT}
        />

        <TrackingStatus
          recentEvents={status.recentEvents}
          recentVisitors={status.recentVisitors}
          lastEventAt={status.lastEventAt === null ? null : status.lastEventAt.toISOString()}
          enabled={settings.web_tracking_enabled}
        />
      </div>
    </SettingsPageShell>
  );
}
