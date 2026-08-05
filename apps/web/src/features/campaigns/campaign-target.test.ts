import { describe, expect, it } from 'vitest';
import { campaignHref, campaignTarget, isFinishedCampaign } from './campaign-target';

/**
 * Kdyby tenhle soubor spadl: report kampaně nemá ze seznamu jinou cestu než
 * ručně napsanou adresu. Přesně to byl stav, kvůli kterému vznikl.
 */
describe('kam vede řádek kampaně', () => {
  it.each([
    ['draft', 'settings'],
    ['schedule_missed', 'settings'],
    ['scheduled', 'settings'],
  ])('chystaná kampaň ve stavu %s vede na nastavení', (status, target) => {
    expect(campaignTarget(status)).toBe(target);
  });

  it.each([['queueing'], ['sending'], ['paused']])(
    'běžící kampaň ve stavu %s vede na průběh',
    (status) => {
      expect(campaignTarget(status)).toBe('progress');
    },
  );

  it.each([['sent'], ['partially_sent'], ['cancelled'], ['failed']])(
    'dojetá kampaň ve stavu %s vede na report',
    (status) => {
      expect(campaignTarget(status)).toBe('report');
    },
  );

  it('neznámý stav padá na průběh, ne na chybu', () => {
    expect(campaignTarget('ab_testing')).toBe('progress');
  });

  it('odeslaná kampaň NEVEDE na nastavení ani na průběh', () => {
    const href = campaignHref('/w/demo/campaigns', 'k1', 'sent');
    expect(href).toBe('/w/demo/campaigns/k1/report');
  });

  it('rozepsaná kampaň vede na svoji stránku bez podcesty', () => {
    expect(campaignHref('/w/demo/campaigns', 'k1', 'draft')).toBe('/w/demo/campaigns/k1');
  });

  it('běžící kampaň vede na průběh', () => {
    expect(campaignHref('/w/demo/campaigns', 'k1', 'sending')).toBe(
      '/w/demo/campaigns/k1/progress',
    );
  });

  it.each([
    ['sent', true],
    ['partially_sent', true],
    ['cancelled', true],
    ['failed', true],
    ['sending', false],
    ['scheduled', false],
    ['draft', false],
  ])('%s je dojetá kampaň: %s', (status, expected) => {
    expect(isFinishedCampaign(status)).toBe(expected);
  });
});
