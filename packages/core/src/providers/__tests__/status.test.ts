import { describe, expect, it } from 'vitest';
import {
  providerBlockers,
  providerSignals,
  providerStatusDetail,
  providerStatusFrom,
  type ProviderFacts,
} from '../status';

const healthy: ProviderFacts = {
  kind: 'ses',
  disabled: false,
  credentialsValid: true,
  account: { enforcement_status: 'HEALTHY', sending_enabled: true, production_access: true },
  configurationSet: 'ok',
  events: 'confirmed',
  domainVerified: true,
  dmarcOk: true,
};

describe('stav odesílacího účtu z toho, co opravdu víme', () => {
  it('všechno v pořádku znamená připravený účet', () => {
    expect(providerStatusFrom(healthy)).toBe('ready');
    expect(providerBlockers(healthy)).toEqual([]);
  });

  it('neplatné údaje znamenají neověřený účet, ne jen varování', () => {
    const f = { ...healthy, credentialsValid: false };
    expect(providerStatusFrom(f)).toBe('unverified');
    expect(providerBlockers(f)).toContain('credentials_invalid');
  });

  /**
   * Tohle je ta vada, kvůli které za čtyři dny neodešel jediný e-mail: jméno
   * konfigurační sady bylo uložené, sada u Amazonu neexistovala a účet se přesto
   * tvářil použitelně.
   */
  it('chybějící konfigurační sada účet NEPUSTÍ odesílat', () => {
    const f: ProviderFacts = { ...healthy, configurationSet: 'missing' };
    expect(providerStatusFrom(f)).toBe('verifying');
    expect(providerBlockers(f)).toContain('configuration_set_missing');
  });

  /**
   * Nepotvrzený odběr událostí je ve vývoji NORMÁLNÍ: potvrzení chodí POSTem
   * na náš webhook a na localhost Amazon nedosáhne. Odesílání to blokovat nesmí.
   */
  it('nepotvrzený odběr událostí odesílání povolí a jen varuje', () => {
    const f: ProviderFacts = { ...healthy, events: 'pending' };
    expect(providerStatusFrom(f)).toBe('degraded');
    expect(providerBlockers(f)).toContain('events_pending');
  });

  it('neověřená doména drží účet na ověřování', () => {
    const f = { ...healthy, domainVerified: false };
    expect(providerStatusFrom(f)).toBe('verifying');
    expect(providerBlockers(f)).toContain('domain_not_verified');
  });

  it('testovací režim Amazonu je vlastnost účtu, ne důvod k jeho zablokování', () => {
    const f: ProviderFacts = {
      ...healthy,
      account: { enforcement_status: 'HEALTHY', sending_enabled: true, production_access: false },
    };
    expect(providerStatusFrom(f)).toBe('ready');
    expect(providerBlockers(f)).toContain('sandbox');
  });

  it('vypnuté odesílání u Amazonu účet zablokuje', () => {
    const f: ProviderFacts = {
      ...healthy,
      account: { enforcement_status: 'SHUTDOWN', sending_enabled: false, production_access: true },
    };
    expect(providerStatusFrom(f)).toBe('blocked');
  });

  /**
   * Účet SES, u kterého se stav nepodařilo načíst, se NESMÍ posuzovat mírnými
   * pravidly SMTP. Rozlišuje to `kind`, ne přítomnost `account`.
   */
  it('u SES bez načteného stavu účtu rozhoduje typ, ne prázdný snímek', () => {
    const f: ProviderFacts = { ...healthy, account: null, configurationSet: 'missing' };
    expect(providerSignals(f).snsConfirmed).toBe(false);
    expect(providerStatusFrom(f)).toBe('verifying');
  });

  it('SMTP nemá konfigurační sady ani události, takže ho neshodí', () => {
    const f: ProviderFacts = {
      kind: 'smtp',
      disabled: false,
      credentialsValid: true,
      account: null,
      configurationSet: 'not_applicable',
      events: 'not_applicable',
      domainVerified: true,
      dmarcOk: true,
    };
    expect(providerStatusFrom(f)).toBe('ready');
  });

  it('podrobnosti nesou testovací režim jako „nevíme", dokud se hodnota nepřečte', () => {
    const detail = providerStatusDetail(
      { ...healthy, account: null },
      {
        now: new Date('2026-08-04T10:00:00Z'),
        snsTopicArn: null,
        configurationSetName: null,
        detail: null,
      },
    );
    expect(detail.sandbox).toBeNull();
    expect(detail.checked_at).toBe('2026-08-04T10:00:00.000Z');
  });
  /*
   * REGION A OVĚŘENÉ IDENTITY. Do stavu se ukládá ZKRÁCENÝ výčet, ale ÚPLNÝ
   * počet. Účet zadavatele má v Irsku 25 ověřených identit a stav účtu není
   * adresář; číslo, které se samo od sebe zmenší na deset, je horší než žádné.
   */
  it('zkracuje výčet identit, ale počet nechává úplný', () => {
    const many = Array.from({ length: 25 }, (_, i) => `id${i}.cz`);
    const detail = providerStatusDetail(healthy, {
      now: new Date('2026-08-04T10:00:00Z'),
      snsTopicArn: null,
      configurationSetName: null,
      detail: null,
      region: 'eu-west-1',
      verifiedIdentities: many,
    });
    expect(detail.region).toBe('eu-west-1');
    expect(detail.verified_identities).toHaveLength(10);
    expect(detail.verified_identity_count).toBe(25);
  });

  it('přepočet bez volání Amazonu si úplný počet ponese s sebou', () => {
    // Přepočet má k dispozici jen zkrácený seznam z minulého ověření. Bez
    // výslovného počtu by účet po každém přepočtu tvrdil, že jich má deset.
    const detail = providerStatusDetail(healthy, {
      now: new Date('2026-08-04T10:00:00Z'),
      snsTopicArn: null,
      configurationSetName: null,
      detail: null,
      region: 'eu-west-1',
      verifiedIdentities: ['a.cz', 'b.cz'],
      verifiedIdentityCount: 25,
    });
    expect(detail.verified_identity_count).toBe(25);
  });

  /*
   * `undefined` je „nezjišťovali jsme" a NESMÍ se ukázat jako nula. Právě
   * takový omyl stál zadavatele čtyři dny: adresy ověřené měl, jen v jiném
   * regionu, a produkt mlčel.
   */
  it('nezjištěné identity nechává jako nevíme, ne jako nulu', () => {
    const detail = providerStatusDetail(healthy, {
      now: new Date('2026-08-04T10:00:00Z'),
      snsTopicArn: null,
      configurationSetName: null,
      detail: null,
      region: 'eu-west-1',
    });
    expect(detail.verified_identity_count).toBeNull();
    expect(detail.verified_identities).toEqual([]);
  });

  it('testovací režim BEZ jediné ověřené identity má vlastní důvod', () => {
    const sandboxed: ProviderFacts = {
      ...healthy,
      account: { enforcement_status: 'HEALTHY', sending_enabled: true, production_access: false },
      verifiedIdentityCount: 0,
    };
    expect(providerBlockers(sandboxed)).toContain('sandbox_no_identities');
    // A „nevíme" ten důvod NEVYVOLÁ: mlčí se o něm.
    expect(providerBlockers({ ...sandboxed, verifiedIdentityCount: null })).not.toContain(
      'sandbox_no_identities',
    );
  });
});
