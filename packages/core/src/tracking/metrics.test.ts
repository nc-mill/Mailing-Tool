import { describe, expect, it } from 'vitest';
import { TRACKING_METRIC_NAMES, trackingMetrics } from './metrics';

describe('tracking metrics', () => {
  it('všechna jména jsou podtržítková, tečka v názvu Prometheus metriky není platná', () => {
    for (const name of TRACKING_METRIC_NAMES) {
      expect(name).toMatch(/^tracking_[a-z0-9_]+$/);
      expect(name).not.toContain('.');
    }
  });

  it('katalog obsahuje alertované čítače z 9.2', () => {
    expect(TRACKING_METRIC_NAMES).toContain('tracking_message_lookup_miss_total');
    expect(TRACKING_METRIC_NAMES).toContain('tracking_writer_dropped_total');
    expect(TRACKING_METRIC_NAMES).toContain('tracking_token_invalid_total');
    expect(TRACKING_METRIC_NAMES).toContain('tracking_partition_missing');
  });

  it('každé jméno z katalogu má v mapě metrik svou instanci se stejným jménem', () => {
    // Bez tohohle testu by katalog a instance mohly žít vedle sebe a rozejít se:
    // jméno by se opravilo v jednom seznamu a v druhém zůstalo.
    const instances = new Set(Object.values(trackingMetrics).map((metric) => metric.name));
    expect([...TRACKING_METRIC_NAMES].filter((name) => !instances.has(name))).toEqual([]);
    expect(instances.size).toBe(TRACKING_METRIC_NAMES.length);
  });
});
