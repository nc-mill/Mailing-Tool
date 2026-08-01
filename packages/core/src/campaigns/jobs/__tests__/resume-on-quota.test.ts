import { describe, expect, it, vi } from 'vitest';
import { resumeOnQuotaHandler, RESUME_ON_QUOTA_SQL } from '../resume-on-quota';

describe('automaticke obnoveni po uvolneni kvoty', () => {
  it('dotaz vybira podle pause_reason ->> code, nikdy podle textove hodnoty quota', () => {
    expect(RESUME_ON_QUOTA_SQL).toContain(`pause_reason ->> 'code' = 'provider_quota_exhausted'`);
    expect(RESUME_ON_QUOTA_SQL).not.toContain(`pause_reason = 'quota'`);
  });

  it.each(['sender', 'app'] as const)('obnovi kampan pozastavenou se source %s', async (source) => {
    const resume = vi.fn(async () => ({ resumed: true, status: 'sending' as const }));
    await resumeOnQuotaHandler({
      listPaused: async () => [{ workspaceId: 'w', campaignId: 'k', providerId: 'p', source }],
      remainingQuota: async () => 5000,
      resume,
      emit: async () => {},
      quotaResumeAbove: 1000,
    });
    expect(resume).toHaveBeenCalledWith('w', 'k');
  });

  it('neobnovi, dokud je kvota pod prahem obnoveni', async () => {
    const resume = vi.fn(async () => ({ resumed: false, status: null }));
    await resumeOnQuotaHandler({
      listPaused: async () => [
        { workspaceId: 'w', campaignId: 'k', providerId: 'p', source: 'sender' },
      ],
      remainingQuota: async () => 500,
      resume,
      emit: async () => {},
      quotaResumeAbove: 1000,
    });
    expect(resume).not.toHaveBeenCalled();
  });

  it('po obnoveni posle webhook campaign.resumed', async () => {
    const emit = vi.fn(async () => {});
    await resumeOnQuotaHandler({
      listPaused: async () => [
        { workspaceId: 'w', campaignId: 'k', providerId: 'p', source: 'app' },
      ],
      remainingQuota: async () => 5000,
      resume: async () => ({ resumed: true, status: 'sending' }),
      emit,
      quotaResumeAbove: 1000,
    });
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'campaign.resumed' }));
  });
});
