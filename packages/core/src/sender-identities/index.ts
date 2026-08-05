/**
 * Barrel domény předvoleb odesílatele.
 *
 * Doména je samostatná, ne kapitola v `providers`, a je to vědomé: providery
 * a domény jsou nastavení INFRASTRUKTURY (klíče, DNS, kvóty), kdežto předvolba
 * je pohodlí pro toho, kdo píše kampaně. Sdílí s nimi obrazovku, ne důvod
 * existence.
 */
export * from './validation';
export {
  listSenderIdentities,
  getSenderIdentity,
  getDefaultSenderIdentity,
  createSenderIdentity,
  updateSenderIdentity,
  setDefaultSenderIdentity,
  deleteSenderIdentity,
  domainOwnership,
  type SenderIdentityRow,
  type SenderIdentityView,
  type SenderIdentityWriteInput,
  type DomainOwnership,
} from './repo';
export {
  presentSenderIdentity,
  createSenderIdentityFromApi,
  updateSenderIdentityFromApi,
  type SenderIdentityInput,
  type SenderIdentityPayload,
} from './service';
