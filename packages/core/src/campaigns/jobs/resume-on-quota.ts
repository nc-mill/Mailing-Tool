export const RESUME_ON_QUOTA_JOB = {
  queue: 'campaign.resume_on_quota' as const,
  cron: '*/10 * * * *',
  retryLimit: 3,
  expireInSeconds: 300,
};

/**
 * Job vybira podle CODE, ne podle stare textove hodnoty. Je to konkretni chyba, kterou
 * by drivejsi zneni vyrobilo: job obnovoval kampane s pause_reason = 'quota', kdezto
 * sender zapisuje provider_quota_exhausted. Kampan pozastavenou senderem kvuli vycerpane
 * kvote by tedy NIKDY nerozjel, i kdyby kvota byla davno volna, a nic by neselhalo
 * ani se nezalogovalo. Uzivatel by videl kampan, ktera stoji a tvrdi, ze bude
 * pokracovat sama. Bez ohledu na source: kdo pauzu zapsal, na rozhodnuti "kvota je
 * zase volna, jed dal" nic nemeni.
 */
export const RESUME_ON_QUOTA_SQL = `
SELECT id, workspace_id, provider_id, pause_reason ->> 'source' AS source
  FROM campaigns
 WHERE status = 'paused'
   AND pause_reason ->> 'code' = 'provider_quota_exhausted'
   AND deleted_at IS NULL`;

export type ResumeOnQuotaDeps = {
  listPaused(): Promise<
    Array<{ workspaceId: string; campaignId: string; providerId: string | null; source: string }>
  >;
  remainingQuota(workspaceId: string, providerId: string | null): Promise<number>;
  resume(
    workspaceId: string,
    campaignId: string,
  ): Promise<{ resumed: boolean; status: string | null }>;
  emit(input: { workspaceId: string; type: string; campaignId: string }): Promise<void>;
  quotaResumeAbove: number;
};

export async function resumeOnQuotaHandler(deps: ResumeOnQuotaDeps): Promise<void> {
  for (const c of await deps.listPaused()) {
    const remaining = await deps.remainingQuota(c.workspaceId, c.providerId);
    if (remaining <= deps.quotaResumeAbove) continue;
    const r = await deps.resume(c.workspaceId, c.campaignId);
    if (r.resumed) {
      await deps.emit({
        workspaceId: c.workspaceId,
        type: 'campaign.resumed',
        campaignId: c.campaignId,
      });
    }
  }
}
