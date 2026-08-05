import { describe, expect, it } from 'vitest';
import regionsData from '../../../data/ses-regions.json';
import {
  SES_REGIONS,
  SES_REGIONS_SOURCE,
  SES_REGIONS_VERIFIED_AT,
  SUGGESTED_SES_REGION,
  isKnownSesRegion,
  sesRegion,
  sesRegionLabel,
} from '../ses/regions';
import {
  isEmailIdentity,
  mapIdentityList,
  verificationState,
  verifiedIdentityNames,
} from '../ses/identities';

/**
 * Seznam regionů je DATA, ne názor. Testuje se proto, že datový soubor nese
 * důkaz svého původu a že v něm nejsou regiony, ve kterých SES prokazatelně
 * není. Nabídnout region bez služby znamená vyrobit tutéž vadu znovu, jen
 * s naším podpisem.
 */
describe('seznam regionů Amazon SES', () => {
  it('nese zdroj i datum ověření, stejně jako dns-providers.json', () => {
    expect(SES_REGIONS_SOURCE).toBe('https://docs.aws.amazon.com/general/latest/gr/ses.html');
    expect(SES_REGIONS_VERIFIED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(regionsData.optInSource).toContain('docs.aws.amazon.com');
  });

  it('má u každého regionu kód, jméno z konzole AWS i lidský název', () => {
    for (const region of SES_REGIONS) {
      expect(region.code, region.code).toMatch(/^[a-z]{2}-[a-z]+-\d$/);
      expect(region.awsName.length, region.code).toBeGreaterThan(0);
      expect(region.cityCs.length, region.code).toBeGreaterThan(0);
      expect(region.cityEn.length, region.code).toBeGreaterThan(0);
      expect(typeof region.optIn, region.code).toBe('boolean');
    }
  });

  it('kódy jsou jedinečné', () => {
    const codes = SES_REGIONS.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  /*
   * Strojová tabulka služeb AWS hlásí u SES i tyhle regiony, jenže endpoint
   * `email.<region>.amazonaws.com` se u nich ani nepřeloží. Do nabídky proto
   * nepatří a tenhle test hlídá, aby se tam nevrátily.
   */
  it('neobsahuje regiony, ve kterých SES není, přestože je hlásí strojová tabulka', () => {
    for (const code of [
      'ap-east-1',
      'ap-east-2',
      'ap-southeast-4',
      'ap-southeast-6',
      'ap-southeast-7',
      'mx-central-1',
    ]) {
      expect(isKnownSesRegion(code), code).toBe(false);
    }
  });

  it('obsahuje oba evropské regiony, mezi kterými zadavatel přepínal', () => {
    expect(sesRegion('eu-central-1')?.awsName).toBe('Europe (Frankfurt)');
    expect(sesRegion('eu-west-1')?.awsName).toBe('Europe (Ireland)');
    // Ani jeden z nich nevyžaduje zapnutí regionu u Amazonu.
    expect(sesRegion('eu-central-1')?.optIn).toBe(false);
    expect(sesRegion('eu-west-1')?.optIn).toBe(false);
  });

  it('doporučený region v seznamu OPRAVDU je', () => {
    expect(isKnownSesRegion(SUGGESTED_SES_REGION)).toBe(true);
  });

  it('neznámý kód se vrací tak, jak je, ne jako prázdno', () => {
    // Účet založený dřív může mít uložený region mimo seznam. Přepsat mu ho
    // na prázdno by znamenalo tvrdit, že žádný region nemá.
    expect(sesRegionLabel('eu-south-2')).toBe('eu-south-2');
    expect(sesRegionLabel('eu-west-1')).toBe('Irsko (eu-west-1)');
    expect(sesRegionLabel('eu-west-1', 'en')).toBe('Ireland (eu-west-1)');
  });
});

describe('stav identity u Amazonu', () => {
  it('překládá všech pět hodnot z dokumentace GetEmailIdentity', () => {
    expect(verificationState({ VerificationStatus: 'SUCCESS' })).toBe('verified');
    expect(verificationState({ VerificationStatus: 'PENDING' })).toBe('pending');
    expect(verificationState({ VerificationStatus: 'FAILED' })).toBe('failed');
    expect(verificationState({ VerificationStatus: 'TEMPORARY_FAILURE' })).toBe(
      'temporary_failure',
    );
    expect(verificationState({ VerificationStatus: 'NOT_STARTED' })).toBe('not_started');
  });

  /*
   * „Nevíme" a „nepovedlo se" jsou dvě různé zprávy a uživatel podle nich dělá
   * dvě různé věci. Neznámá hodnota se proto NESMÍ vydávat za selhání.
   */
  it('neznámou hodnotu hlásí jako neznámou, ne jako selhání', () => {
    expect(verificationState({ VerificationStatus: 'CO_TO_JE' })).toBe('unknown');
    expect(verificationState({})).toBe('unknown');
  });

  it('praktická odpověď má přednost: smím z toho odeslat?', () => {
    // `VerifiedForSendingStatus` odpovídá na otázku, která rozhoduje o odeslání.
    expect(
      verificationState({ VerificationStatus: 'PENDING', VerifiedForSendingStatus: true }),
    ).toBe('verified');
  });
});

describe('seznam identit v regionu účtu', () => {
  const items = [
    { IdentityName: 'brevio.cz', IdentityType: 'DOMAIN', SendingEnabled: true },
    { IdentityName: 'petr.novak@gmail.com', IdentityType: 'EMAIL_ADDRESS', SendingEnabled: true },
    { IdentityName: 'ceka.cz', IdentityType: 'DOMAIN', SendingEnabled: false },
    // Položka bez jména se nedá ani ukázat, ani použít.
    { IdentityType: 'DOMAIN', SendingEnabled: true },
  ];

  it('rozliší doménu od adresy a neznámý typ nevydává za doménu', () => {
    const mapped = mapIdentityList([...items, { IdentityName: 'x.cz', IdentityType: 'NECO' }]);
    expect(mapped.find((i) => i.identity === 'brevio.cz')?.kind).toBe('domain');
    expect(mapped.find((i) => i.identity === 'petr.novak@gmail.com')?.kind).toBe('email');
    expect(mapped.find((i) => i.identity === 'x.cz')?.kind).toBe('unknown');
  });

  it('položku bez jména zahodí', () => {
    expect(mapIdentityList(items)).toHaveLength(3);
  });

  /*
   * Do počtu se berou JEN identity, ze kterých Amazon odesílat dovolí.
   * V testovacím režimu na neověřenou identitu stejně nic neodejde, takže
   * započítat ji by znamenalo slíbit doručení, které nepřijde.
   */
  it('za ověřené počítá jen to, z čeho Amazon odesílat dovolí', () => {
    expect(verifiedIdentityNames(items)).toEqual(['brevio.cz', 'petr.novak@gmail.com']);
  });

  it('prázdný účet vrací prázdný seznam, ne chybu', () => {
    expect(verifiedIdentityNames([])).toEqual([]);
  });
});

describe('tvar e-mailové adresy pro CreateEmailIdentity', () => {
  it('propustí běžnou adresu', () => {
    expect(isEmailIdentity('petr@brevio.cz')).toBe(true);
    expect(isEmailIdentity('a.b+c@sub.domena.co.uk')).toBe(true);
  });

  it('odmítne to, co adresa prokazatelně není', () => {
    for (const value of ['brevio.cz', '@brevio.cz', 'petr@', 'petr @brevio.cz', ' petr@x.cz', '']) {
      expect(isEmailIdentity(value), value).toBe(false);
    }
  });
});
