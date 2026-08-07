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
 *
 * KTERÁ HODNOTA PLATÍ, KDYŽ SE TENHLE VÝČET ROZEJDE S REGISTREM P01. Platí TAHLE,
 * a to u všech front, které mají producenta. Producenti domény volají `jobs/enqueue.ts`
 * a ten posílá `retryLimit`, `retryBackoff` i `expireInSeconds` odsud do řádku úlohy;
 * `queues/enqueue-sql.ts` sahá po registru jedině tehdy, když je volající nepošle.
 * pg-boss pak při selhání čte `job.retry_limit` z ŘÁDKU (manager.js: `Number(job.retry_limit)`),
 * ne z fronty, takže hodnota na frontě z `boss.createQueue(entry.name, queueOptions(entry))`
 * se uplatní jen u úloh, které zakládá sám pg-boss, tedy u tiků z cronu.
 *
 * EXPIRACE SE PROTO SROVNALA S REGISTREM. U deseti front se oba výčty rozcházely a
 * u expirace pro to nebyl důvod: registr má u každé fronty `source` s odkazem do plánu
 * (část 2, 4.x), tenhle výčet neměl provenienci žádnou, takže rozdíl nebyl rozhodnutí,
 * ale drift. Směr je navíc bezpečný: delší expirace znamená, že se dávkovému běhu nad
 * velkým projektem nepřeruší práce uprostřed. Fronty, kde se v jednom běhu projede celý
 * projekt (`recompute_greeting`, `bulk_delete`, `refingerprint`), na tom stojí nejvíc,
 * protože `bulk_delete` má nula pokusů a přerušený běh by se už neopakoval.
 *
 * ROZDÍLY V POČTU POKUSŮ SE NECHALY, AŽ NA JEDEN. Mění chování při selhání, ne dobu
 * běhu, takže se každý posuzoval zvlášť. `gdpr.erase` se srovnal na registr (0 → 3
 * pokusy), protože jeho nula pokusů nebyla opatrnost, ale ztráta výmazu podle článku
 * 17; důvod je u té položky. Zbylé čtyři platí dál a jsou vyjmenované v testu
 * `test/queues.test.ts`, aby žádný další rozdíl nemohl přibýt potichu.
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
    expireInSeconds: 7200,
    deadLetter: 'contacts.recompute_greeting.dlq',
    idempotency: 'přepočet je čistá funkce vstupu, druhý běh zapíše tytéž hodnoty',
  },
  'contacts.bulk_vocative_review': {
    retryLimit: 3,
    retryBackoff: true,
    expireInSeconds: 7200,
    deadLetter: 'contacts.bulk_vocative_review.dlq',
    idempotency: 'UPDATE je podmíněný na vocative_locked = false, druhý běh nemá co měnit',
  },
  'contacts.strip_attribute': {
    retryLimit: 3,
    retryBackoff: true,
    expireInSeconds: 7200,
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
    expireInSeconds: 14400,
    deadLetter: 'contacts.refingerprint.dlq',
    idempotency: 'otisk se doplňuje jen tam, kde pod daným pokolením ještě není',
  },
  'contacts.bulk_delete': {
    retryLimit: 0,
    retryBackoff: false,
    expireInSeconds: 7200,
    idempotency: 'UPDATE podmíněný na deleted_at IS NULL, druhý běh ovlivní nula řádků',
  },
  'contacts.bulk_tag': {
    retryLimit: 3,
    retryBackoff: true,
    expireInSeconds: 7200,
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
    expireInSeconds: 7200,
    deadLetter: 'gdpr.export_subject.dlq',
    idempotency: 'výsledek se váže na gdpr_requests.export_id, druhý běh existující export přepíše',
  },
  /*
   * NULA POKUSŮ TU BYLA OMYLEM, NE ZE ZÁMĚRU, a rozhodovalo se to podle kódu.
   *
   * Vypadalo to jako opatrnost („opakovaný výmaz je nebezpečnější než neúspěšný"),
   * jenže obsluha opakování snese: `anonymizeContact` i `purgeContact` jsou JEDNA
   * transakce se zámkem `FOR UPDATE` a strážcem hned na začátku (`anonymized_at IS
   * NULL`, respektive prázdný `SELECT`). Druhý běh tedy neudělá nic, což tvrdí
   * i `idempotency` níž.
   *
   * Cena za nulu pokusů byla naopak nejvyšší právě u téhle fronty: jediné přechodné
   * selhání (výpadek spojení, nedostupná role `mlain_gdpr`, timeout zámku) ztratilo
   * výmaz podle článku 17 NATRVALO. Žádost zůstala ve stavu `processing`, žádný sken
   * zaseknuté žádosti nedohledává a nikdo se to nedozvěděl. To je porušení zákonné
   * lhůty, ne technická nepříjemnost.
   *
   * Dead letter fronta je zatím DEKLARACE, ne funkce. `queues/enqueue-sql.ts` sloupec
   * `dead_letter` na řádku úlohy schválně nevyplňuje (cizí klíč na `queue.name`),
   * kdežto pg-boss směruje podle řádku. Až se to napraví, má tahle fronta kam spadnout;
   * do té doby je to záznam záměru, aby se na něj při opravě nezapomnělo.
   */
  'gdpr.erase': {
    retryLimit: 3,
    retryBackoff: true,
    expireInSeconds: 3600,
    deadLetter: 'gdpr.erase.dlq',
    idempotency: 'každý krok je podmíněný na anonymized_at IS NULL, druhý běh je bez efektu',
  },
  'gdpr.sever_links': {
    retryLimit: 5,
    retryBackoff: true,
    expireInSeconds: 7200,
    deadLetter: 'gdpr.sever_links.dlq',
    idempotency:
      'UPDATE SET contact_id NULL WHERE contact_id rovno id, druhý běh ovlivní nula řádků',
  },
  'inbound.process': {
    retryLimit: 3,
    retryBackoff: true,
    expireInSeconds: 900,
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
