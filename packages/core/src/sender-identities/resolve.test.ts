import { describe, expect, it } from 'vitest';
import { firstVerifiedTrialAddress } from './resolve';

describe('adresa odesílatele z ověřených adres zkušebního režimu', () => {
  it('vezme první POTVRZENOU adresu', () => {
    expect(
      firstVerifiedTrialAddress({
        campaigns: {
          trial_verified: [
            { email: 'ceka@firma.cz', verified_at: null },
            { email: 'Overena@Firma.cz', verified_at: '2026-08-07T10:00:00.000Z' },
          ],
        },
      }),
    ).toBe('overena@firma.cz');
  });

  /**
   * Adresa čekající na potvrzení se použít NESMÍ. Instalace o ní neví nic než
   * to, že ji někdo napsal do pole, a odeslat z ní znamená tvrdit, že ji
   * projekt vlastní.
   */
  it('nepotvrzenou adresu nepoužije', () => {
    expect(
      firstVerifiedTrialAddress({
        campaigns: { trial_verified: [{ email: 'ceka@firma.cz', verified_at: null }] },
      }),
    ).toBeNull();
  });

  it('u prázdného nastavení vrací null, ne výjimku', () => {
    expect(firstVerifiedTrialAddress(null)).toBeNull();
    expect(firstVerifiedTrialAddress({})).toBeNull();
    expect(firstVerifiedTrialAddress({ campaigns: {} })).toBeNull();
    expect(firstVerifiedTrialAddress({ campaigns: { trial_verified: 'nesmysl' } })).toBeNull();
  });
});
