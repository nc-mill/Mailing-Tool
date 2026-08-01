import { describe, expect, it } from 'vitest';
import {
  SCHEDULE_MIN_LEAD_MINUTES,
  SCHEDULE_MAX_AHEAD_DAYS,
  SCHEDULE_GRANULARITY_SECONDS,
  RENDER_DATA_MAX_BYTES,
  CANCEL_CLEANUP_BATCH_SIZE,
  AUDIENCE_PREVIEW_TIMEOUT_MS,
  MATERIALIZE_STATEMENT_TIMEOUT_MS,
  MATERIALIZE_TIMEOUT_STRIKES,
  AUDIENCE_PREVIEW_SAMPLE_SIZE,
  WATCHDOG_QUIET_SECONDS,
  TEST_SEND_MAX_RECIPIENTS,
} from '../constants';

describe('konstanty domeny kampani', () => {
  it('meze planovani jsou konstanty, ne konfigurace', () => {
    expect(SCHEDULE_MIN_LEAD_MINUTES).toBe(5);
    expect(SCHEDULE_MAX_AHEAD_DAYS).toBe(365);
    expect(SCHEDULE_GRANULARITY_SECONDS).toBe(60);
  });

  it('strop render_data je 8 kB', () => {
    expect(RENDER_DATA_MAX_BYTES).toBe(8 * 1024);
  });

  it('uklid pri zruseni jde po 10 000 radcich', () => {
    expect(CANCEL_CLEANUP_BATCH_SIZE).toBe(10_000);
  });

  it('nahled publika ceka nejvyse 5 sekund', () => {
    expect(AUDIENCE_PREVIEW_TIMEOUT_MS).toBe(5_000);
    expect(AUDIENCE_PREVIEW_SAMPLE_SIZE).toBe(20);
  });

  it('materializacni davka ma statement_timeout 30 s a tri pokusy', () => {
    expect(MATERIALIZE_STATEMENT_TIMEOUT_MS).toBe(30_000);
    expect(MATERIALIZE_TIMEOUT_STRIKES).toBe(3);
  });

  it('watchdog uzavira az po 10 s klidu a test jde nejvyse na 5 adres', () => {
    expect(WATCHDOG_QUIET_SECONDS).toBe(10);
    expect(TEST_SEND_MAX_RECIPIENTS).toBe(5);
  });
});
