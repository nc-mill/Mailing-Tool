export const SCHEDULER_JOB = {
  queue: 'campaign.scheduler' as const,
  cron: '*/30 * * * * *',
  retryLimit: 3,
  expireInSeconds: 25,
};

export type SchedulerDeps = {
  listWorkspaces(): Promise<string[]>;
  claimDue(workspaceId: string): Promise<Array<{ id: string; scheduledAt: Date }>>;
  markMissed(workspaceId: string): Promise<string[]>;
  sendMaterialize(input: { workspaceId: string; campaignId: string }): Promise<void>;
  emit(input: {
    workspaceId: string;
    type: string;
    campaignId: string;
    data?: unknown;
  }): Promise<void>;
  audit(input: {
    workspaceId: string;
    action: string;
    campaignId: string;
    detail?: unknown;
  }): Promise<void>;
  now(): Date;
};

/**
 * Zpozdeni nad 5 minut je pro uzivatele viditelna zmena a musi o nem vedet:
 * kampan typu "dnesni poledni menu" nema odejit vecer. Do 6 hodin odesleme
 * se zpozdenim a ohlasime to, po 6 hodinach cekame na rozhodnuti cloveka.
 */
export const SCHEDULE_DELAY_NOTIFY_SECONDS = 300;

export async function schedulerHandler(deps: SchedulerDeps): Promise<void> {
  for (const workspaceId of await deps.listWorkspaces()) {
    for (const campaignId of await deps.markMissed(workspaceId)) {
      await deps.emit({ workspaceId, type: 'campaign.schedule_missed', campaignId });
      await deps.audit({ workspaceId, action: 'campaign.schedule_missed', campaignId });
    }

    for (const due of await deps.claimDue(workspaceId)) {
      const delaySeconds = Math.round((deps.now().getTime() - due.scheduledAt.getTime()) / 1000);
      await deps.sendMaterialize({ workspaceId, campaignId: due.id });
      if (delaySeconds > SCHEDULE_DELAY_NOTIFY_SECONDS) {
        await deps.audit({
          workspaceId,
          action: 'campaign.schedule_delayed',
          campaignId: due.id,
          detail: { delay_seconds: delaySeconds },
        });
        await deps.emit({
          workspaceId,
          type: 'campaign.schedule_delayed',
          campaignId: due.id,
          data: { delay_seconds: delaySeconds, scheduled_at: due.scheduledAt.toISOString() },
        });
      }
    }
  }
}
