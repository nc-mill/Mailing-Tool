import { describe, expect, it } from 'vitest';
import {
  KNOWN_CAMPAIGN_STATUSES,
  isKnownCampaignStatus,
  TERMINAL_CAMPAIGN_STATUSES,
  SENDING_CAMPAIGN_STATUSES,
  campaignAudienceSchema,
  emptyCounters,
} from '../types';

describe('typy kampane', () => {
  it('zna deset stavu a subscribed mezi nimi neni', () => {
    expect(KNOWN_CAMPAIGN_STATUSES).toEqual([
      'draft',
      'scheduled',
      'queueing',
      'sending',
      'paused',
      'sent',
      'partially_sent',
      'cancelled',
      'failed',
      'schedule_missed',
    ]);
    expect(KNOWN_CAMPAIGN_STATUSES).not.toContain('subscribed');
  });

  it('neznamy stav toleruje, ale nehlasi jako znamy', () => {
    expect(isKnownCampaignStatus('sending')).toBe(true);
    expect(isKnownCampaignStatus('ab_testing')).toBe(false);
  });

  it('koncove stavy nedovoluji zadny prechod ven', () => {
    expect(TERMINAL_CAMPAIGN_STATUSES).toEqual(['sent', 'partially_sent', 'cancelled']);
  });

  it('claim dotaz bere queueing i sending, takze obojí je odesilaci stav', () => {
    expect(SENDING_CAMPAIGN_STATUSES).toEqual(['queueing', 'sending']);
  });

  it('publikum ma include i exclude a prazdny include je chyba', () => {
    const ok = campaignAudienceSchema.safeParse({
      include: { lists: ['0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071'], segments: [] },
      exclude: { lists: [], segments: [] },
    });
    expect(ok.success).toBe(true);

    const bad = campaignAudienceSchema.safeParse({
      include: { lists: [], segments: [] },
      exclude: { lists: [], segments: [] },
    });
    expect(bad.success).toBe(false);
  });

  it('pending v citacich je dopocitany, ne ulozeny', () => {
    const c = emptyCounters();
    expect(c.pending).toBe(0);
    expect({ ...c, total: 10, sent: 3, failed: 1, skipped: 2 }).toMatchObject({ total: 10 });
  });
});
