import { describe, expect, it } from 'vitest';
import {
  buildDeliverabilitySettingsSchema,
  buildCampaignSettingsSchema,
  resolveGuards,
} from '../settings';

const installation = {
  DELIVERABILITY_BOUNCE_GUARD_RATE: 0.08,
  DELIVERABILITY_COMPLAINT_GUARD_RATE: 0.003,
  DELIVERABILITY_BOUNCE_WARN_RATE: 0.04,
  DELIVERABILITY_COMPLAINT_WARN_RATE: 0.001,
  DELIVERABILITY_GUARD_MIN_SENT: 500,
};

describe('prahy dorucitelnosti se nastavuji jen smerem k prisnosti', () => {
  const schema = buildDeliverabilitySettingsSchema(installation);

  it('prisnejsi prah projde', () => {
    expect(schema.safeParse({ bounce_guard_rate: 0.05 }).success).toBe(true);
  });

  it('volnejsi prah vraci chybu s path na konkretni klic, ne tiche orezani', () => {
    const r = schema.safeParse({ bounce_guard_rate: 0.12 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.path).toEqual(['bounce_guard_rate']);
  });

  it('nula vypina brzdu a je to nejprisnejsi hodnota, takze projde', () => {
    expect(schema.safeParse({ complaint_guard_rate: 0 }).success).toBe(true);
  });

  it('u guard_min_sent znamena prisnejsi take nizsi cislo', () => {
    expect(schema.safeParse({ guard_min_sent: 200 }).success).toBe(true);
    expect(schema.safeParse({ guard_min_sent: 900 }).success).toBe(false);
  });

  it('prah zluteho varovani je 4 %, ne 5 %', () => {
    expect(resolveGuards({}, installation).bounceWarnRate).toBeCloseTo(0.04);
  });

  it('varovani ma stejnou podlahu jako automaticka pauza', () => {
    const g = resolveGuards({ guard_min_sent: 300 }, installation);
    expect(g.guardMinSent).toBe(300);
    expect(g.warnMinSent).toBe(300);
  });

  it('undo okno se smi zkratit, ne prodlouzit', () => {
    const s = buildCampaignSettingsSchema({ CAMPAIGN_UNDO_WINDOW_SECONDS: 60 });
    expect(s.safeParse({ undo_window_seconds: 30 }).success).toBe(true);
    expect(s.safeParse({ undo_window_seconds: 0 }).success).toBe(true);
    expect(s.safeParse({ undo_window_seconds: 120 }).success).toBe(false);
  });
});
