'use client';

import { useEffect, useTransition } from 'react';
import { useRouter } from '@mlain/i18n/navigation';
import { ProgressScreen, type CampaignProgress } from './progress-screen';
import {
  cancelCampaignAction,
  pauseCampaignAction,
  resumeCampaignAction,
  undoCampaignAction,
} from './actions';

/**
 * Klientský obal průběhu. Kromě akcí řeší jednu věc navíc: běžící kampaň se sama
 * obnovuje každých pět sekund, protože čísla průběhu se mění bez zásahu uživatele.
 * Obnovuje se přes `router.refresh()`, tedy načtením serverové komponenty, ne
 * dopočtem v prohlížeči; čísla tak vždycky pocházejí z jednoho zdroje.
 */
export function ProgressView({
  progress,
  workspaceId,
}: {
  progress: CampaignProgress;
  workspaceId: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const live = progress.status === 'sending' || progress.status === 'queueing';

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [live, router]);

  function run(action: (input: { workspaceId: string; campaignId: string }) => Promise<unknown>) {
    startTransition(async () => {
      await action({ workspaceId, campaignId: progress.campaign_id });
      router.refresh();
    });
  }

  return (
    <ProgressScreen
      progress={progress}
      onPause={() => run(pauseCampaignAction)}
      onResume={() => run(resumeCampaignAction)}
      onCancel={() => run(cancelCampaignAction)}
      onUndo={() => run(undoCampaignAction)}
    />
  );
}
