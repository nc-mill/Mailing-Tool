/**
 * Fronty pg-boss vlastněné doménou kontaktů. Registr front jako soubor vlastní P01
 * (`packages/core/src/queues/registry.ts`); tenhle soubor drží doménový pohled, tedy
 * to, co při zařazování jobu potřebuje handler.
 *
 * Konvence 9.1 části 1: název <domena>.<akce>, retryLimit a expireInSeconds vždy explicitně,
 * dead letter fronta u všeho, co smí trvale selhat.
 *
 * Normativní pravidlo, které platí pro KAŽDOU z nich: singletonKey nezaručuje, že job proběhne
 * právě jednou, jen že nepoběží dva souběžně. Job, jehož worker zemře, se spustí znovu i poté,
 * co první běh stihl vedlejší efekty. Každý handler proto musí být idempotentní a u každého
 * je napsané čím. Není to komentář, čte to code review.
 *
 * Fronta contacts.import zde NENÍ, vlastní ji P11 spolu s importní pipeline.
 */
export type QueueOptions = {
  retryLimit: number;
  retryBackoff: boolean;
  expireInSeconds: number;
  deadLetter?: string;
  idempotency: string;
};

export const CONTACTS_QUEUES = {
  'contacts.recompute_greeting': {
    retryLimit: 3,
    retryBackoff: true,
    expireInSeconds: 900,
    deadLetter: 'contacts.recompute_greeting.dlq',
    idempotency: 'přepočet je čistá funkce vstupu, druhý běh zapíše tytéž hodnoty',
  },
  'contacts.bulk_vocative_review': {
    retryLimit: 3,
    retryBackoff: true,
    expireInSeconds: 900,
    deadLetter: 'contacts.bulk_vocative_review.dlq',
    idempotency: 'UPDATE je podmíněný na vocative_locked = false, druhý běh nemá co měnit',
  },
  'contacts.strip_attribute': {
    retryLimit: 3,
    retryBackoff: true,
    expireInSeconds: 1800,
    deadLetter: 'contacts.strip_attribute.dlq',
    idempotency: 'odebrání klíče z jsonb je idempotentní operace nad týmž vstupem',
  },
  'contact_fields.verify_index': {
    retryLimit: 1,
    retryBackoff: true,
    expireInSeconds: 3600,
    deadLetter: 'contact_fields.verify_index.dlq',
    idempotency: 'prověrka je čtení plus jeden UPDATE index_state, druhý běh dá tentýž výsledek',
  },
  'contacts.refingerprint': {
    retryLimit: 5,
    retryBackoff: true,
    expireInSeconds: 3600,
    deadLetter: 'contacts.refingerprint.dlq',
    idempotency: 'otisk se doplňuje jen tam, kde pod daným pokolením ještě není',
  },
  'contacts.bulk_delete': {
    retryLimit: 0,
    retryBackoff: false,
    expireInSeconds: 3600,
    idempotency: 'UPDATE podmíněný na deleted_at IS NULL, druhý běh ovlivní nula řádků',
  },
  'contacts.bulk_tag': {
    retryLimit: 3,
    retryBackoff: true,
    expireInSeconds: 1800,
    deadLetter: 'contacts.bulk_tag.dlq',
    idempotency: 'INSERT ... ON CONFLICT DO NOTHING nad primárním klíčem contact_tags',
  },
  'contacts.cleanup_pending': {
    retryLimit: 2,
    retryBackoff: true,
    expireInSeconds: 900,
    deadLetter: 'contacts.cleanup_pending.dlq',
    idempotency: 'DELETE podmíněný na status pending a na stáří, druhý běh nemá co mazat',
  },
  'consents.rebuild_state': {
    retryLimit: 2,
    retryBackoff: true,
    expireInSeconds: 1800,
    deadLetter: 'consents.rebuild_state.dlq',
    idempotency: 'přepočet z append-only logu, výsledek se přepisuje celý',
  },
  'gdpr.export_subject': {
    retryLimit: 2,
    retryBackoff: true,
    expireInSeconds: 1800,
    deadLetter: 'gdpr.export_subject.dlq',
    idempotency: 'výsledek se váže na gdpr_requests.export_id, druhý běh existující export přepíše',
  },
  'gdpr.erase': {
    retryLimit: 0,
    retryBackoff: false,
    expireInSeconds: 900,
    idempotency: 'každý krok je podmíněný na anonymized_at IS NULL, druhý běh je bez efektu',
  },
  'gdpr.sever_links': {
    retryLimit: 5,
    retryBackoff: true,
    expireInSeconds: 1800,
    deadLetter: 'gdpr.sever_links.dlq',
    idempotency:
      'UPDATE SET contact_id NULL WHERE contact_id rovno id, druhý běh ovlivní nula řádků',
  },
  'inbound.process': {
    retryLimit: 3,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: 'inbound.process.dlq',
    idempotency: 'stav doručení se mění podmíněně ze stavu received, plus dedup přes inbound_dedup',
  },
  'retention.run': {
    retryLimit: 0,
    retryBackoff: false,
    expireInSeconds: 2400,
    idempotency: 'mazání podle stáří je idempotentní, běh se navíc zaznamenává do retention_runs',
  },
} as const satisfies Record<string, QueueOptions>;

export type ContactsQueue = keyof typeof CONTACTS_QUEUES;

/**
 * Fronty, které běží per projekt a nesmí běžet dvakrát souběžně nad týmž projektem.
 * Volající u nich předává singletonKey = workspaceId.
 */
export const WORKSPACE_SINGLETON_QUEUES: readonly ContactsQueue[] = [
  'contacts.recompute_greeting',
  'contacts.bulk_delete',
  'retention.run',
];
