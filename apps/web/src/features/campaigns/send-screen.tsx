'use client';

import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
import { ReadinessChecklist, type Preflight, type TrialNotice } from './readiness-checklist';
import { sendCampaignAction } from './actions';

/**
 * Klientský obal obrazovky odeslání. Po úspěšném odeslání vede uživatele rovnou
 * na průběh, kde běží okno na zrušení; kdyby zůstal na kontrolním seznamu,
 * neviděl by odpočet a o možnost vzít odeslání zpět by přišel.
 */
export function SendScreen({
  workspaceId,
  campaignId,
  campaignName,
  fromLine,
  subject,
  preflight,
  trialNotice,
  basePath,
}: {
  workspaceId: string;
  campaignId: string;
  campaignName: string;
  fromLine: string;
  subject: string;
  preflight: Preflight;
  trialNotice: TrialNotice | null;
  basePath: string;
}) {
  const router = useRouter();
  const t = useTranslations('campaigns.settings');

  return (
    <div className="flex flex-col gap-4">
      <ReadinessChecklist
        preflight={preflight}
        campaignName={campaignName}
        fromLine={fromLine}
        subject={subject}
        trialNotice={trialNotice}
        onSend={async (recipientCount) => {
          const result = await sendCampaignAction({
            workspaceId,
            campaignId,
            confirmRecipientCount: recipientCount,
          });
          if (result.status === 'success') {
            router.push(`${basePath}/campaigns/${campaignId}/progress`);
          }
          return result;
        }}
      />
      {/* Kontrolní seznam umí jen vypsat, co chybí. Odkaz na nastavení je jediná
          cesta, jak to vyplnit; bez něj byla obrazovka slepá ulička. */}
      <p>
        <Link
          href={`${basePath}/campaigns/${campaignId}`}
          className="underline"
          data-testid="to-settings"
        >
          {t('toSettings')}
        </Link>
      </p>
    </div>
  );
}
