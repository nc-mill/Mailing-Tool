import { describe, expect, it } from 'vitest';
// ODCHYLKA OD PLÁNU, VYNUCENÁ ROZHODNUTÍM R4. Plán četl fixtures z
// `@mlain/contracts/fixtures/ses/`. Rozhodnutí o vlastnictví R4 je přiřklo P13:
// nejsou to kontrakty mezi TypeScriptem a Go, jsou to vzorky cizích payloadů, tedy
// běžná testovací data domény. Leží proto vedle testu, který je čte.
import sandbox from './fixtures/ses/get-account-sandbox.json' with { type: 'json' };
import shutdown from './fixtures/ses/get-account-shutdown.json' with { type: 'json' };
import {
  mapAccount,
  quotaRemaining,
  shouldPauseForQuota,
  shouldResumeForQuota,
} from '../ses/account';

describe('GetAccount', () => {
  it('sandbox se pozna z ProductionAccessEnabled, ne z hodnoty 200', () => {
    const a = mapAccount(sandbox as never);
    expect(a.production_access).toBe(false);
    expect(a.quota_max_24h).toBe(
      (sandbox as { SendQuota: { Max24HourSend: number } }).SendQuota.Max24HourSend,
    );
  });

  it('SHUTDOWN se propise do enforcement_status', () => {
    expect(mapAccount(shutdown as never).enforcement_status).toBe('SHUTDOWN');
  });

  it('zbyvajici kvota je max minus spotreba, nikdy zaporna', () => {
    expect(quotaRemaining({ quota_max_24h: 50_000, quota_sent_24h: 49_500 })).toBe(500);
    expect(quotaRemaining({ quota_max_24h: 200, quota_sent_24h: 500 })).toBe(0);
  });

  it('pauza pri poklesu pod 100, obnoveni az nad 1000', () => {
    expect(shouldPauseForQuota(80, { pauseBelow: 100 })).toBe(true);
    expect(shouldPauseForQuota(150, { pauseBelow: 100 })).toBe(false);
    expect(shouldResumeForQuota(1500, { resumeAbove: 1000 })).toBe(true);
    expect(shouldResumeForQuota(500, { resumeAbove: 1000 })).toBe(false);
  });

  it('mezera mezi prahy je hystereze a musi zustat', () => {
    expect(shouldPauseForQuota(500, { pauseBelow: 100 })).toBe(false);
    expect(shouldResumeForQuota(500, { resumeAbove: 1000 })).toBe(false);
  });

  it('chybejici pole neshodi mapovani, jen zustanou null', () => {
    expect(mapAccount({} as never)).toMatchObject({ quota_max_24h: null, sending_enabled: null });
  });
});
