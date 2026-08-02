'use client';

import { useRouter } from '@mlain/i18n/navigation';
import { ReadinessChecklist, type Preflight } from './readiness-checklist';
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
  basePath,
}: {
  workspaceId: string;
  campaignId: string;
  campaignName: string;
  fromLine: string;
  subject: string;
  preflight: Preflight;
  basePath: string;
}) {
  const router = useRouter();

  return (
    <ReadinessChecklist
      preflight={preflight}
      campaignName={campaignName}
      fromLine={fromLine}
      subject={subject}
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
  );
}
