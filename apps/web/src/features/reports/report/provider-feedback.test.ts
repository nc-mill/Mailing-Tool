import { describe, expect, it } from 'vitest';
import { feedbackGap } from './provider-feedback';
import type { StatsPayload } from './report-model';

const NOW = new Date('2026-08-01T12:00:00.000Z');

const payload = {
  campaign_id: 'c1',
  name: 'Letní výprodej',
  subject: 'Sleva 30 %',
  status: 'sent',
  track_opens: true,
  track_clicks: true,
  delivered_source: 'provider_events',
  delivered_known: true,
  counts: { sent: 1153, delivered: 1141, delivered_effective: 1141 },
  rates: {},
  open_breakdown: { verified: 0, machine: 0, uncertain: 0, total: 0, clicked_from_verified: 0 },
  predicted_opens: null,
  small_sample: false,
  audience_built_at: null,
  started_at: '2026-08-01T09:00:00.000Z',
  finished_at: '2026-08-01T09:10:00.000Z',
  first_event_at: '2026-08-01T09:11:00.000Z',
  last_event_at: '2026-08-01T10:00:00.000Z',
  version: 1,
  updated_at: '2026-08-01T10:00:00.000Z',
} as unknown as StatsPayload;

describe('feedbackGap', () => {
  it('když události chodí, žádná mezera není', () => {
    expect(feedbackGap(payload, NOW)).toBeNull();
  });

  /**
   * Otevření a prokliky POSOUVAJÍ `last_event_at`, ale o doručení neříkají nic:
   * zapisuje je náš vlastní pixel a přesměrování odkazů, kdežto doručení hlásí
   * jedině odesílací služba. Dokud se tenhle test ptal na `last_event_at`, stačilo
   * jediné otevření, aby panel problémů prohlásil „0 odrazů, 0 stížností" za
   * naměřený stav, přestože od služby nedorazilo nic.
   */
  it('samotné otevření nestačí: bez zprávy od služby mezera trvá', () => {
    expect(feedbackGap({ ...payload, delivered_known: false }, NOW)).toBe('no_events');
  });

  it('SMTP účet oznámení neposílá vůbec', () => {
    expect(feedbackGap({ ...payload, delivered_source: 'derived_from_sent' }, NOW)).toBe(
      'not_reported',
    );
  });

  it('dojetá kampaň bez jediné události je nález, ne nula', () => {
    // „Žádná událost" se od téhle opravy pozná podle `delivered_known`, ne podle
    // prázdného `last_event_at`: ten posouvají i otevření, o kterých služba nic neví.
    expect(feedbackGap({ ...payload, delivered_known: false, last_event_at: null }, NOW)).toBe(
      'no_events',
    );
  });

  it('u kampaně, která právě dojela, se ještě čeká', () => {
    const justFinished = {
      ...payload,
      last_event_at: null,
      finished_at: '2026-08-01T11:55:00.000Z',
    };
    expect(feedbackGap(justFinished, NOW)).toBeNull();
  });

  it('u běžící kampaně mlčení služby nález není', () => {
    expect(feedbackGap({ ...payload, status: 'sending', last_event_at: null }, NOW)).toBeNull();
  });

  it('u kampaně, ze které nic neodešlo, není co hlásit', () => {
    const nothingSent = {
      ...payload,
      last_event_at: null,
      counts: { ...payload.counts, sent: 0 },
    };
    expect(feedbackGap(nothingSent, NOW)).toBeNull();
  });
});
