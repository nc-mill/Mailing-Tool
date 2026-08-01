// Veřejná plocha domény kontaktů. Reexportuje POUZE to, co potřebují cizí balíčky,
// tedy apps/web (stránky a server actions), apps/worker (registrace front) a plány,
// které si tuhle doménu vyžádaly: P08 a P12 katalog polí, P11 upsert a frontu
// oslovení, P13 bránu mailovatelnosti, P14 čtení kontaktu.
//
// Co tady NENÍ, je vnitřek. Kdyby se sem dalo všechno, stal by se z toho barrel,
// který uzávěr S11 řídicího dokumentu zakazuje, a každý import zvenčí by natáhl
// celou doménu včetně slovníku jmen.
//
// POZOR NA HLUBOKOU PODCESTU. Zástupný znak v mapě `exports` balíčku @mlain/core
// pohlcuje i lomítka, takže `@mlain/core/contacts/fields/catalog` se rozřeší na
// `src/contacts/fields/catalog/index.ts`, tedy na adresář, který neexistuje.
// Tenhle soubor je jediné, co cizí balíček vidí.
//
// Uvnitř domény se importuje RELATIVNĚ a nikdy přes tenhle barrel: to by vyrobilo
// cyklus přes index a při prvním importu prázdný objekt. Přípona `.js` se nepíše,
// repozitář jede na `moduleResolution: Bundler`.
//
// STAV: fáze A a fáze B (úkoly 1 až 25). Jména z pozdějších úkolů (checkSuppression,
// addSuppression, issueUnsubscribeToken, severContactLinks, listReviewGroups) sem přibudou
// spolu se svými soubory; drží je seznam v test/public-surface.test.ts, aby se na ně
// nezapomnělo.

// Jména a oslovení
export { resolveName, type ResolveContext } from './naming/resolve';
export { normalizeNameKey } from './naming/normalize';
export {
  EMPTY_OVERRIDES,
  type Confidence,
  type Gender,
  type GenderSource,
  type NameInput,
  type NameOverrideLookup,
  type NameResult,
  type NameWarning,
} from './naming/types';

// Adresa a otisky
export { normalizeEmail, maskEmail, type NormalizeEmailResult } from './email';
export {
  computeAllFingerprints,
  computeAllFingerprintsBatch,
  computeCurrentFingerprint,
} from './fingerprint';

// Nastavení projektu vlastněná touhle doménou
export {
  ContactsWorkspaceSettingsSchema,
  readContactsSettings,
  type AddressForm,
  type ContactsWorkspaceSettings,
} from './settings';

// Zápis kontaktu. Dávkovou cestu konzumuje import (P11), jednořádkovou veřejné formuláře
// a příchozí webhooky. Šest pravidel zápisu je uvnitř obou a nejde je obejít parametrem.
export {
  upsertContacts,
  writeContact,
  type ContactUpsertRow,
  type UpsertResult,
  type WriteContactInput,
  type WriteContactResult,
} from './repo/contacts';

// Brána mailovatelnosti. Konzumuje ji P13 při materializaci publika.
export {
  MAILABLE_STATUS,
  evaluateMailability,
  isMailable,
  type MailabilityInput,
  type MailabilityResult,
} from './mailable';

// Katalog polí. Podle rozhodnutí R2 ho vlastní P07 a importují si ho P08 (šablony)
// a P12 (editor), a to v procesu, ne přes REST.
export {
  getFieldCatalog,
  type FieldCatalog,
  type FieldCatalogEntry,
  type FieldCatalogGroup,
  type FieldCatalogType,
  type LocalizedText,
} from './fields/catalog';

// Suppression list. Kontrola i zápis jsou JEDINÉ povolené cesty, proto jsou tady
// obě: P13 je volá před odesláním a při zpracování odrazů a stížností.
export {
  addSuppression,
  checkSuppression,
  checkSingleSuppression,
  removeSuppression,
  type AddSuppressionInput,
  type AddSuppressionResult,
  type SuppressionHit,
} from './repo/suppressions';

// Odhlašovací token typu 'u'. Skládá ho P13 při stavbě zprávy.
export { issueUnsubscribeToken, readPublicToken, ENDPOINT_TOKEN_TYPES } from './tokens';

// Odstřižení vazeb po výmazu podle článku 17. Volá ho worker, dopadá na P10 a P13.
export { severContactLinks } from './jobs/gdpr-sever-links';

// Port na zrušení čekajících zpráv. P13 sem při startu procesu zaregistruje svou
// implementaci; do té doby je volání bez efektu, viz campaigns-port.ts.
export { registerRevokePendingMessages, type RevokePendingMessagesInput } from './campaigns-port';

// Registry, které si vyzvedávají P01 a P04
export { CONTACTS_ERROR_CODES, CONTACTS_FIELD_ERROR_CODES, type ContactsErrorCode } from './errors';
export { CONTACTS_AUDIT_ACTIONS, type ContactsAuditAction } from './audit';
export { CONTACTS_QUEUES, WORKSPACE_SINGLETON_QUEUES, type ContactsQueue } from './queues';
