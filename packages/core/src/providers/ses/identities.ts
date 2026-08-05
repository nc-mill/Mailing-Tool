/**
 * Co má účet ověřené V TOMHLE REGIONU a jak na tom je jedna konkrétní adresa.
 *
 * Oddělený soubor od `identity.ts` schválně: tam se řeší odesílací DOMÉNA
 * a její DNS záznamy, tady seznam identit celého účtu a ověřování jednotlivé
 * ADRESY. Jsou to dvě různé otázky a míchaly by se jen podle toho, že u Amazonu
 * mají obě slovo „identity".
 *
 * Všechno tady je čistá funkce nad odpovědí Amazonu. Volání AWS je ve vrstvě
 * API, aby se dalo testovat bez sítě.
 */

/** Položka z `ListEmailIdentities`. Pole jsou nepovinná, protože v SDK jsou nepovinná. */
export type SesIdentityInfo = {
  IdentityName?: string | undefined;
  IdentityType?: string | undefined;
  SendingEnabled?: boolean | undefined;
  VerificationStatus?: string | undefined;
};

export type SesIdentitySummary = {
  identity: string;
  /** `domain` nebo `email`. Neznámý typ se hlásí jako `unknown`, ne jako doména. */
  kind: 'domain' | 'email' | 'unknown';
  /** Amazon z téhle identity odesílat DOVOLÍ. To je jediné, co rozhoduje. */
  verified: boolean;
  status: SesVerificationState;
};

/**
 * Stav ověření identity, přeložený na malá písmena.
 *
 * Hodnoty jsou doslova ty z dokumentace `GetEmailIdentity`: `PENDING`,
 * `SUCCESS`, `FAILED`, `TEMPORARY_FAILURE`, `NOT_STARTED`. Cokoli jiného je
 * `unknown` a NESMÍ se vydávat za selhání: „nevíme" a „nepovedlo se" jsou dvě
 * různé zprávy a uživatel podle nich dělá dvě různé věci.
 */
export type SesVerificationState =
  'verified' | 'pending' | 'failed' | 'temporary_failure' | 'not_started' | 'unknown';

export function verificationState(input: {
  VerificationStatus?: string | undefined;
  VerifiedForSendingStatus?: boolean | undefined;
}): SesVerificationState {
  // `VerifiedForSendingStatus` má přednost: je to odpověď na otázku „smím z toho
  // odeslat?", zatímco stav ověření je popis průběhu. U hotové identity říkají
  // obojí totéž, u rozporu platí ta praktická.
  if (input.VerifiedForSendingStatus === true) return 'verified';
  switch (input.VerificationStatus) {
    case 'SUCCESS':
      return 'verified';
    case 'PENDING':
      return 'pending';
    case 'FAILED':
      return 'failed';
    case 'TEMPORARY_FAILURE':
      return 'temporary_failure';
    case 'NOT_STARTED':
      return 'not_started';
    default:
      return 'unknown';
  }
}

function identityKind(type: string | undefined): SesIdentitySummary['kind'] {
  if (type === 'DOMAIN' || type === 'MANAGED_DOMAIN') return 'domain';
  if (type === 'EMAIL_ADDRESS') return 'email';
  return 'unknown';
}

/** Položky bez jména se zahazují: identita bez jména se nedá ani ukázat, ani použít. */
export function mapIdentityList(items: readonly SesIdentityInfo[]): SesIdentitySummary[] {
  const out: SesIdentitySummary[] = [];
  for (const item of items) {
    const name = item.IdentityName;
    if (name === undefined || name === '') continue;
    out.push({
      identity: name,
      kind: identityKind(item.IdentityType),
      verified: item.SendingEnabled === true,
      status: verificationState({
        VerificationStatus: item.VerificationStatus,
        VerifiedForSendingStatus: item.SendingEnabled,
      }),
    });
  }
  return out;
}

/**
 * Jména identit, ze kterých Amazon V TOMHLE REGIONU odesílat dovolí.
 *
 * Přesně tohle je odpověď na otázku, kterou zadavatel čtyři dny neměl kde
 * položit: „mám tady vůbec něco ověřeného?". Neověřené identity se do seznamu
 * NEPOČÍTAJÍ, protože v testovacím režimu na ně stejně nic neodejde.
 */
export function verifiedIdentityNames(items: readonly SesIdentityInfo[]): string[] {
  return mapIdentityList(items)
    .filter((i) => i.verified)
    .map((i) => i.identity)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Tvar e-mailové adresy pro `CreateEmailIdentity`.
 *
 * Kontrola je ZÁMĚRNĚ hrubá a kopíruje pattern `^(.+)@(.+)$` z dokumentace AWS.
 * Přísnější kontrola by odmítla adresu, kterou Amazon přijme, a to je horší
 * chyba než pustit dál adresu, kterou odmítne on: jeho odmítnutí je čitelná
 * odpověď, naše by byla nevysvětlitelný zákaz.
 */
export function isEmailIdentity(value: string): boolean {
  const at = value.indexOf('@');
  return (
    value.trim() === value &&
    value.length >= 6 &&
    value.length <= 254 &&
    at > 0 &&
    at < value.length - 1 &&
    !/\s/.test(value)
  );
}
