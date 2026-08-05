// Barrel domény providerů. Bez něj se `@mlain/core/providers` vůbec nerozřeší, protože
// mapa `exports` balíčku míří na `./src/<domena>/index.ts` a zástupný znak v ní
// pohlcuje lomítka, takže hlubší podcesta se nerozřeší.
//
// Vystavuje se jen to, co potřebují cizí domény a vrstva API. Obsah dorůstá s fázemi
// plánu; tady jsou fáze F a G.

export * from './types';
export { providerConfigSchema, derivePublicConfig, mask } from './config-schema';
export {
  encryptProviderConfig,
  decryptProviderConfig,
  reencryptProviderCredentials,
  type EncryptProviderConfigInput,
  type DecryptProviderConfigInput,
} from './crypto';
export { deriveProviderStatus, canSendWith, type ProviderSignals } from './state-machine';
export {
  providerSignals,
  providerBlockers,
  providerStatusFrom,
  providerStatusDetail,
  type ProviderFacts,
  type ProviderStatusDetail,
} from './status';

export { createAwsClients, type AwsClients } from './ses/client';
export {
  mapAccount,
  quotaRemaining,
  shouldPauseForQuota,
  shouldResumeForQuota,
  type AccountSnapshot,
  type SesGetAccountResponse,
} from './ses/account';
export {
  normalizeDomain,
  buildDnsRecords,
  mapIdentity,
  type DnsRecord,
  type SesIdentityResponse,
} from './ses/identity';
export {
  setupEventDestination,
  ensureConfigurationSet,
  ensureEventDestination,
  configurationSetNameFor,
  manualInstructions,
  MATCHING_EVENT_TYPES,
  type AwsSetupClient,
  type ManualInstructionsInput,
  type SetupEventDestinationInput,
} from './ses/events-setup';
export { createSetupClient, isAlreadyExists } from './ses/setup-client';
export {
  SES_REGIONS,
  SES_REGIONS_SOURCE,
  SES_REGIONS_OPT_IN_SOURCE,
  SES_REGIONS_VERIFIED_AT,
  SUGGESTED_SES_REGION,
  isKnownSesRegion,
  sesRegion,
  sesRegionLabel,
  type SesRegion,
} from './ses/regions';
export {
  mapIdentityList,
  verificationState,
  verifiedIdentityNames,
  isEmailIdentity,
  type SesIdentityInfo,
  type SesIdentitySummary,
  type SesVerificationState,
} from './ses/identities';

export {
  verifySmtp,
  classifySmtpError,
  type SmtpErrorCode,
  type SmtpVerifyResult,
} from './smtp/verify';

export {
  createResolver,
  unknownOnServfail,
  type CheckResult,
  type DnsResolver,
  type Finding,
} from './dns/resolver';
export { checkSpf } from './dns/spf';
export { checkDkim } from './dns/dkim';
export { checkDmarc, type DmarcResult } from './dns/dmarc';
export { checkMx } from './dns/mx';
export {
  runDomainChecks,
  nextCheckAt,
  cacheTtlSeconds,
  type DomainChecks,
} from './dns/check-domain';

// Datová vrstva. Vystavuje se schválně, stejně jako u domény kampaní: vrstva API
// i joby ji volají místo vlastního SQL nad `sending_providers` a `sender_domains`.
export {
  getProviderById,
  getProviderSecret,
  createProvider,
  setDefaultProvider,
  updateAccountSnapshot,
  setProviderStatus,
  listStaleQuota,
  deleteProvider,
  type ProviderRow,
  type CreateProviderInput,
  type AccountSnapshotColumns,
} from './repo/provider';
export {
  saveChecks,
  saveIdentity,
  hasProviderVerifiedDomain,
  listDue,
  getDomain,
  type DomainRow,
  type SaveChecksInput,
  type SaveIdentityInput,
} from './repo/domain';

export {
  createDelegationToken,
  verifyDelegationToken,
  DELEGATION_PUBLIC_FIELDS,
} from './delegation';
export {
  canSendInTrial,
  trialAudienceNotice,
  addTrialAddress,
  type TrialSettings,
} from './trial-mode';
