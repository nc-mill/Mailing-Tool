import { deriveProviderStatus, type ProviderSignals } from './state-machine';
import type { ProviderStatus } from './types';

/**
 * Co si o odesílacím účtu pamatujeme mezi dvěma ověřeními.
 *
 * Je to JEDINÉ místo, kde se skládá `sending_providers.status_detail`. Než tenhle
 * soubor vznikl, nezapisoval stav účtu vůbec nikdo: `setProviderStatus` neměla
 * v produkčním kódu volajícího a účet zůstával navždy na `unverified`, i když
 * test připojení právě doložil, že údaje fungují. Obrazovka pak vedle sebe
 * ukazovala odznak „Neověřený" a větu „Ověřeno, účet je připravený odesílat".
 */
export type ProviderStatusDetail = {
  /** Kdy jsme se naposledy ptali poskytovatele. */
  checked_at: string;
  credentials_ok: boolean;
  /**
   * Stav konfigurační sady u Amazonu. `missing` znamená, že jméno máme uložené,
   * ale sada u Amazonu NEEXISTUJE, a tedy neodejde ani jedna zpráva
   * (`NotFoundException` při každém odeslání).
   */
  configuration_set: 'ok' | 'missing' | 'error' | 'not_applicable';
  configuration_set_name: string | null;
  /**
   * Zpětná vazba od Amazonu. `pending` je běžný stav ve vývoji: odběr se
   * potvrzuje POSTem na náš webhook a na `localhost` Amazon nedosáhne.
   */
  events: 'confirmed' | 'pending' | 'not_configured' | 'error' | 'not_applicable';
  sns_topic_arn: string | null;
  /** `true` = Amazon drží účet v testovacím režimu. `null` = nevíme. */
  sandbox: boolean | null;
  /** Amazon potvrdil aspoň jednu odesílací doménu tohohle účtu. */
  domain_verified: boolean;
  /**
   * REGION, ZE KTERÉHO SE ODESÍLÁ.
   *
   * Nese se ve stavu, ne jen v šifrované konfiguraci, protože u Amazonu je
   * KAŽDÁ věc vázaná na region zvlášť: ověřené identity, testovací režim,
   * denní limit i konfigurační sada. Zadavatel měl v konzoli otevřenou
   * Severní Virginii se třemi ověřenými adresami, produkt posílal z Frankfurtu,
   * kde je ověřená jen doména, a produkční přístup měl v Irsku. Tři různé
   * pravdy o jednom účtu a nikde nebylo napsané, které se týká čeho.
   */
  region: string | null;
  /**
   * Co má Amazon ověřené PRÁVĚ V TOMHLE REGIONU. Nezkrácený seznam se
   * neukládá: u účtu s produkčním přístupem jich bývají desítky a stav účtu
   * není adresář.
   */
  verified_identities: string[];
  verified_identity_count: number | null;
  /** Strojové kódy toho, co brání odesílání. Obrazovka z nich skládá věty. */
  blockers: string[];
  /** Syrová odpověď poskytovatele u nezdaru. Nenahrazuje radu, doplňuje ji. */
  detail: string | null;
};

export type ProviderFacts = {
  /**
   * Typ účtu se nese zvlášť, ne odvozeně z toho, jestli je vyplněný `account`.
   * Účet SES, u kterého se stav zrovna nepodařilo načíst, má `account === null`
   * a nesmí se přitom posuzovat mírnými pravidly SMTP.
   */
  kind: 'ses' | 'smtp';
  /** Uživatel účet ručně vypnul. */
  disabled: boolean;
  credentialsValid: boolean;
  /** `null`, když se stav účtu nepodařilo načíst, a vždy u SMTP. */
  account: {
    enforcement_status: string | null;
    sending_enabled: boolean | null;
    production_access: boolean | null;
  } | null;
  configurationSet: ProviderStatusDetail['configuration_set'];
  events: ProviderStatusDetail['events'];
  domainVerified: boolean;
  /** `false` jen tehdy, když u některé domény DMARC prokazatelně nesedí. */
  dmarcOk: boolean;
  /**
   * Kolik identit má Amazon ověřených v regionu účtu. `null` znamená, že se
   * seznam nepodařilo načíst, a to se nesmí plést s „ani jednu".
   */
  verifiedIdentityCount?: number | null | undefined;
};

/**
 * Signály stavového stroje složené z toho, co OPRAVDU víme.
 *
 * Dvě mapování stojí za vysvětlení, protože bez něj vypadají jako podvod:
 *
 *  - `snsConfirmed` NENÍ „Amazon potvrdil odběr". Je to „nastavení u Amazonu je
 *    hotové", tedy konfigurační sada existuje a cíl událostí je založený. Přesně
 *    tohle rozhoduje o tom, jestli zpráva odejde. Potvrzení odběru je až další
 *    krok a řeší ho `eventsFlowing`.
 *  - `eventsFlowing` je potvrzený odběr. Nepotvrzený odběr shodí účet na
 *    `degraded`, což odesílání DOVOLÍ a jen varuje. Je to schválně: instalace
 *    ve vývoji má webhook na `localhost`, kam Amazon potvrzení nikdy nedoručí,
 *    a zablokovat kvůli tomu odesílání by znamenalo, že si nástroj nikdo nevyzkouší.
 *
 * U SMTP se obojí bere jako splněné, protože SMTP server konfigurační sady ani
 * události nemá. Že od něj zpětná vazba nechodí, říká obrazovka trvalým
 * upozorněním, ne stavem účtu.
 */
export function providerSignals(f: ProviderFacts): ProviderSignals {
  const smtp = f.kind === 'smtp';
  return {
    disabled: f.disabled,
    credentialsValid: f.credentialsValid,
    enforcementStatus: f.account?.enforcement_status ?? 'HEALTHY',
    sendingEnabled: f.account?.sending_enabled ?? true,
    domainVerified: f.domainVerified,
    dmarcOk: f.dmarcOk,
    snsConfirmed: smtp || (f.configurationSet === 'ok' && f.events !== 'not_configured'),
    eventsFlowing: smtp || f.events === 'confirmed',
  };
}

/**
 * Co konkrétně brání odesílání. Pořadí je od nejzávažnějšího, protože obrazovka
 * ukazuje první položku jako hlavní větu.
 */
export function providerBlockers(f: ProviderFacts): string[] {
  const out: string[] = [];
  if (f.disabled) out.push('provider_disabled');
  if (!f.credentialsValid) out.push('credentials_invalid');
  if (f.account?.sending_enabled === false) out.push('sending_disabled');
  if (f.account?.enforcement_status === 'SHUTDOWN') out.push('enforcement_shutdown');
  if (f.configurationSet === 'missing') out.push('configuration_set_missing');
  if (f.configurationSet === 'error') out.push('configuration_set_error');
  if (!f.domainVerified) out.push('domain_not_verified');
  if (f.account?.enforcement_status === 'PROBATION') out.push('enforcement_probation');
  if (f.events === 'pending') out.push('events_pending');
  if (f.events === 'not_configured') out.push('events_not_configured');
  if (f.events === 'error') out.push('events_error');
  if (f.account?.production_access === false) {
    out.push('sandbox');
    /*
     * Testovací režim BEZ jediné ověřené identity v tomhle regionu znamená, že
     * neodejde vůbec nic, ani na vlastní adresu. Je to jiná situace než pouhý
     * testovací režim a musí mít vlastní větu: zadavatel měl tři ověřené
     * adresy, jenže v jiném regionu, než ze kterého produkt posílal, a neměl
     * jak zjistit, že se ty dvě věci míjejí. `null` je „nevíme" a mlčí se o něm.
     */
    if (f.verifiedIdentityCount === 0) out.push('sandbox_no_identities');
  }
  if (!f.dmarcOk) out.push('dmarc_missing');
  return out;
}

/** Kolik ověřených identit se ukládá do stavu. Zbytek nese jen počet. */
const VERIFIED_IDENTITIES_SHOWN = 10;

export function providerStatusFrom(f: ProviderFacts): ProviderStatus {
  return deriveProviderStatus(providerSignals(f));
}

export function providerStatusDetail(
  f: ProviderFacts,
  extra: {
    now: Date;
    snsTopicArn: string | null;
    configurationSetName: string | null;
    detail: string | null;
    region?: string | null | undefined;
    verifiedIdentities?: string[] | undefined;
    /**
     * Úplný počet, když se liší od délky předaného výčtu.
     *
     * Potřebuje ho přepočet stavu bez volání Amazonu: ten má k dispozici jen
     * ZKRÁCENÝ seznam z minulého ověření, a kdyby se počet dopočítal z něj,
     * účet s 25 ověřenými identitami by po každém přepočtu tvrdil, že jich má
     * deset. Číslo, které se samo od sebe zmenšuje, je horší než žádné.
     */
    verifiedIdentityCount?: number | null | undefined;
  },
): ProviderStatusDetail {
  return {
    checked_at: extra.now.toISOString(),
    credentials_ok: f.credentialsValid,
    configuration_set: f.configurationSet,
    configuration_set_name: extra.configurationSetName,
    events: f.events,
    sns_topic_arn: extra.snsTopicArn,
    // `null` je „nevíme". Testovací režim se tvrdí JEN podle přečtené hodnoty.
    sandbox:
      f.account == null || f.account.production_access === null
        ? null
        : f.account.production_access === false,
    domain_verified: f.domainVerified,
    region: extra.region ?? null,
    /*
     * Seznam se ZKRACUJE, počet zůstává úplný. Účet s produkčním přístupem
     * jich má běžně desítky (u zadavatele 25 v Irsku) a stav účtu není
     * adresář. Uživateli stačí vidět, že v tomhle regionu vůbec něco
     * ověřeného má, a kolik toho je; celý výčet patří do konzole Amazonu.
     *
     * `undefined` znamená „nezjišťovali jsme", a to se NESMÍ ukázat jako
     * „nula ověřených identit". Právě takový omyl stál zadavatele čtyři dny:
     * adresy ověřené měl, jen v jiném regionu, a produkt mlčel.
     */
    verified_identities: (extra.verifiedIdentities ?? []).slice(0, VERIFIED_IDENTITIES_SHOWN),
    verified_identity_count:
      extra.verifiedIdentityCount ?? extra.verifiedIdentities?.length ?? null,
    blockers: providerBlockers(f),
    detail: extra.detail,
  };
}
