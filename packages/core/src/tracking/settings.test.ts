import { describe, expect, it } from 'vitest';
import { TrackingSettingsSchema, DEFAULT_TRACKING_SETTINGS } from './settings';

describe('tracking workspace settings', () => {
  it('prázdný objekt dá výchozí hodnoty', () => {
    expect(TrackingSettingsSchema.parse({})).toEqual(DEFAULT_TRACKING_SETTINGS);
  });

  it('odečítání automatických otevření je ve výchozím stavu zapnuté', () => {
    expect(DEFAULT_TRACKING_SETTINGS.subtract_machine_opens).toBe(true);
  });

  it('ukládání IP a země je ve výchozím stavu vypnuté', () => {
    expect(DEFAULT_TRACKING_SETTINGS.store_ip).toBe(false);
    expect(DEFAULT_TRACKING_SETTINGS.store_country).toBe(false);
  });

  it('měření otevření je ve výchozím stavu zapnuté', () => {
    expect(DEFAULT_TRACKING_SETTINGS.default_track_opens).toBe(true);
  });

  it('neznámý klíč se odmítne', () => {
    expect(() => TrackingSettingsSchema.parse({ nonsense: true })).toThrow();
  });
});
