import { describe, expect, it } from 'vitest';
import { deriveLinkId, LINK_ID_NAMESPACE, ZERO_UUID } from '@mlain/contracts/markers';

/**
 * Test se schválně NEPTÁ implementace, kterou hlídá: očekávané hodnoty jsou
 * spočítané nezávisle a zapsané natvrdo. Kdyby kontrakt odvození změnil,
 * rozejdou se všechny uložené `campaign_links` s tím, co je ve značkách,
 * a tenhle test to zachytí dřív, než se kampaň rozešle.
 * Hodnoty jsou ověřené spuštěním, ne opsané odhadem.
 */
const CAMPAIGN = '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071';

describe('deriveLinkId', () => {
  it('pins the derivation to known vectors', () => {
    expect(deriveLinkId(CAMPAIGN, 1)).toBe('a5a7d935-035e-518e-8895-ca6c6f1f8f38');
    expect(deriveLinkId(CAMPAIGN, 2)).toBe('4172df61-1817-5ebb-a591-5a6b19a9a8e2');
    expect(deriveLinkId(CAMPAIGN, 3)).toBe('10d3e541-c97e-50a2-8535-93d19326570f');
  });

  it('pins the preview derivation, where the campaign is the zero uuid', () => {
    expect(ZERO_UUID).toBe('00000000-0000-0000-0000-000000000000');
    expect(deriveLinkId(ZERO_UUID, 1)).toBe('307fd8bb-627d-54fa-9186-b57ce53b6e5d');
  });

  it('sets the version and variant bits of uuid v5', () => {
    const id = deriveLinkId(CAMPAIGN, 1);
    expect(id[14]).toBe('5');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('distinguishes positions and campaigns', () => {
    expect(deriveLinkId(CAMPAIGN, 1)).not.toBe(deriveLinkId(CAMPAIGN, 2));
    expect(deriveLinkId(CAMPAIGN, 1)).not.toBe(deriveLinkId(ZERO_UUID, 1));
    expect(LINK_ID_NAMESPACE).toBe('6f9619ff-8b86-d011-b42d-00c04fc964ff');
  });
});
