import type { QueueEntry } from './types';

const MINUTE = 60;
const HOUR = 60 * MINUTE;

/**
 * SLUČOVÁNÍ DUPLICITNÍCH ÚLOH: `singletonKeyTemplate`, `policy` a `discardNote`.
 *
 * Ta tři pole patří k sobě a čtou se dohromady. Když se rozejdou, nic nespadne,
 * jen se přestane slučovat, a to je přesně to, co se v tomhle registru jednou
 * stalo: 47 front deklarovalo klíč, producenti ho posílali, pg-boss ho ukládal
 * do sloupce, a nesloučila se ani jedna úloha, protože všechny fronty vznikly
 * s politikou `standard`, pro kterou `singletonKey` nic neznamená.
 *
 *  - `singletonKeyTemplate` je tvar klíče, který POSÍLÁ PRODUCENT. Je to popis
 *    skutečnosti, ne přání: když se tu píše `<workspace_id>` a producent posílá
 *    ID importu, je vada v registru, ne v producentovi.
 *  - `policy` slučování ZAPÍNÁ. Chybí = fronta neslučuje.
 *  - `discardNote` říká, co se stane s úlohou, kterou politika nezařadí, nebo,
 *    když `policy` chybí, proč se slučování nezaplo.
 *
 * PROČ NENÍ POLITIKA U VŠECH ČTYŘICETI SEDMI. Zapnuté slučování znamená, že se
 * část úloh NEZAŘADÍ. U úklidu z časovače je to neškodné, protože zítřejší běh
 * udělá i to, co dnešní nestihl. U fronty, do které producent klíč NEPOSÍLÁ,
 * je to naopak ztráta práce: všechny úlohy skončí v jednom kbelíku
 * `COALESCE(singleton_key, '')` a výmaz jednoho kontaktu zahodí výmaz jiného.
 * U takových front politika schválně chybí a `discardNote` říká proč. Vazbu
 * mezi klíčem, politikou a skutečným producentem hlídá test
 * `packages/core/test/queues/merge-policy.test.ts`, aby se to už nemohlo
 * potichu rozejít.
 */
export const QUEUE_REGISTRY: readonly QueueEntry[] = [
  // --- Platforma, část 1 ----------------------------------------------------
  {
    name: 'platform.webhook_fanout',
    domain: 'platform',
    owner: 'P04',
    description: 'Z události webhooku vyrobí doručení pro každý odebírající endpoint.',
    retryLimit: 5,
    retryBackoff: true,
    retryDelaySeconds: 5,
    expireInSeconds: 5 * MINUTE,
    deadLetter: true,
    payloadFields: ['event_id', 'created_at'],
    source: 'část 1, 3.8',
  },
  {
    name: 'platform.webhook_deliver',
    domain: 'platform',
    owner: 'P04',
    description: 'Jedno HTTP doručení. Retry řídí aplikace přes next_attempt_at, ne pg-boss.',
    retryLimit: 0,
    retryBackoff: false,
    retryDelaySeconds: 0,
    expireInSeconds: 2 * MINUTE,
    singletonKeyTemplate: 'delivery:<delivery_id>',
    discardNote:
      'SLUČOVÁNÍ ZÁMĚRNĚ VYPNUTÉ: fronta nemá v repozitáři producenta. Obsluha existuje ' +
      '(platform/jobs/webhook_deliver.ts) a fan-out zapisuje řádky do webhook_deliveries, ' +
      'ale do fronty nikdo nezařazuje, takže se nedá ověřit, že by delivery:<delivery_id> ' +
      'doopravdy chodil. Až producent vznikne, bude to exclusive: zahodí se druhé zařazení ' +
      'TÉHOŽ doručení, práce se neztratí, protože pravdu drží řádek ve webhook_deliveries ' +
      'a další pokus zařadí aplikace podle next_attempt_at. Pořadí doručení na týž endpoint ' +
      'se držet NEBUDE: šlo by to jedině přes key_strict_fifo s klíčem endpointu, jenže tam ' +
      'by jedno trvale selhavší doručení zamklo endpoint navždy.',
    deadLetter: false,
    payloadFields: ['delivery_id', 'created_at'],
    source: 'část 1, 3.8',
  },
  // `platform.maintain_partitions` TADY UŽ NENÍ a nezakládejte ji znovu.
  //
  // Byla poslední ze tří front, které slibovaly práci s oddíly a žádnou
  // nedělaly. Zakládání oddílu je `CREATE TABLE ... PARTITION OF`, tedy DDL,
  // a worker běží pod rolí `mlain_app`, která schéma nevlastní. Obsluha jí
  // proto nikdy nevznikla a vzniknout nemohla, jen v registru vypadala jako
  // denní údržba v 02:00.
  //
  // Zakládání oddílů dopředu i úklid těch za lhůtou dělá `mlain partitions`
  // pod `DATABASE_URL_MIGRATOR`, pouštěný z plánovače hostitele. Obojí je
  // schválně v JEDNOM příkazu: bez zakládání dopředu přestane instalace po
  // čtyřech měsících přijímat zápisy, protože výchozí oddíl se nezakládá
  // a zápis mimo okno tvrdě selže. Viz
  // `packages/core/src/ops/partition-retention.ts`
  // a `docs/operations/partitions-retention.md`.
  //
  // Druhou pojistkou je migrační runner: `runMigrations` volá
  // `ensureUpcomingPartitions(client, new Date(), 4)`, takže každý upgrade
  // okno posune, i kdyby plánovač nikdo nenastavil.
  {
    name: 'platform.cleanup_sessions',
    domain: 'platform',
    owner: 'P04',
    description: 'Maže relace starší než 30 dní od skončení.',
    cron: '15 2 * * *',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 60,
    expireInSeconds: 15 * MINUTE,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik je neškodný: maže se podle stáří, takže zítřejší běh smaže i to, co ' +
      'zbylo. Relace navíc přežije o den déle, nic se neztratí.',
    deadLetter: false,
    payloadFields: [],
    source: 'část 1, 3.2',
  },
  {
    name: 'platform.cleanup_idempotency',
    domain: 'platform',
    owner: 'P04',
    description: 'Maže vypršené záznamy idempotenčních klíčů.',
    cron: '25 2 * * *',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 60,
    expireInSeconds: 15 * MINUTE,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik je neškodný: maže se podle expirace, zítřejší běh smaže i zbytek. Klíč ' +
      'navíc přežije o den, což znamená o den delší ochranu proti duplicitě, ne slabší.',
    deadLetter: false,
    payloadFields: [],
    source: 'část 1, 4.4 (název odvozen P01)',
  },
  {
    name: 'platform.cleanup_audit_log',
    domain: 'platform',
    owner: 'P04',
    description: 'Retence auditu podle AUDIT_RETENTION_MONTHS.',
    cron: '35 2 * * *',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 60,
    expireInSeconds: 30 * MINUTE,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik je neškodný: retence je daná stářím záznamu, zítřejší běh smaže i zbytek. ' +
      'Audit se drží DÉLE, než AUDIT_RETENTION_MONTHS káže, nikdy kratší dobu.',
    deadLetter: false,
    payloadFields: [],
    source: 'část 1, 3.7 a 4.9 (název odvozen P01)',
  },
  {
    name: 'platform.purge_workspaces',
    domain: 'platform',
    owner: 'P04',
    description: 'Trvale odstraní měkce smazané projekty po uplynutí lhůty.',
    cron: '45 2 * * *',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 60,
    expireInSeconds: 1 * HOUR,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik je neškodný: projekt po lhůtě zůstane měkce smazaný a odstraní ho ' +
      'zítřejší běh. Odklad o den je přijatelný; nepřijatelné by bylo opačné pořadí, tedy dva ' +
      'souběžné úklidy nad týmž projektem.',
    deadLetter: true,
    payloadFields: [],
    source: 'část 1, 3.3',
  },
  {
    name: 'platform.backup',
    domain: 'platform',
    owner: 'P16',
    description: 'Plánovaná záloha podle BACKUP_SCHEDULE_CRON.',
    cron: '0 3 * * *',
    retryLimit: 1,
    retryBackoff: false,
    retryDelaySeconds: 0,
    expireInSeconds: 4 * HOUR,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'JEDINÉ MÍSTO, KDE JE ZAHOZENÍ CITELNÉ: zahozený tik znamená vynechanou zálohu. Přesto ' +
      'je to lepší než druhý pg_dump puštěný přes běžící, protože oba se perou o I/O i o ' +
      'cílový soubor. Zahodí se to jen tehdy, když předchozí záloha běží nebo čeká přes 24 ' +
      'hodin, a to je samo o sobě porucha a je vidět v tabulce backups.',
    deadLetter: true,
    payloadFields: [],
    source: 'část 1, 3.14',
  },
  {
    name: 'platform.backup_verify',
    domain: 'platform',
    owner: 'P16',
    description: 'Týdenní mlain backup verify nad poslední zálohou.',
    cron: '0 4 * * 0',
    retryLimit: 1,
    retryBackoff: false,
    retryDelaySeconds: 0,
    expireInSeconds: 4 * HOUR,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik znamená vynechané týdenní ověření zálohy. Zahodí se jen tehdy, když ' +
      'předchozí ověření běží déle než týden, což je porucha sama o sobě. Souběžné ověření by ' +
      'navíc obnovovalo dvě kopie naráz a spotřebovalo dvojnásobek místa.',
    deadLetter: true,
    payloadFields: [],
    source: 'část 1, 3.14',
  },

  // --- Kontakty, souhlasy, segmenty a GDPR, část 2 -------------------------
  {
    name: 'contacts.import',
    domain: 'contacts',
    owner: 'P11',
    description: 'Import CSV po dávkách s checkpointy. Jeden běžící import na projekt.',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 30,
    expireInSeconds: 6 * HOUR,
    singletonKeyTemplate: '<import_id>',
    policy: 'exclusive',
    discardNote:
      'OPRAVENO PODLE SKUTEČNÉHO PRODUCENTA. Registr tu měl <workspace_id>, jenže ' +
      'import/service.ts posílá importId a fáze validace ho posílá jako ' +
      '<workspace_id>:validate:<import_id>. Klíč projektu tu nikdy nikdo neposlal a batch.ts ' +
      'před ním výslovně varuje: zabitý worker by projektu zamkl VŠECHNY další importy. ' +
      'Zahodí se tedy druhé zařazení TÉHOŽ importu, což je přesně to, co dělá ' +
      'recover-stale.ts, když se plete s běžícím během. Práce se neztrácí, pravdu drží řádek ' +
      'v imports i s checkpointem.',
    deadLetter: true,
    payloadFields: ['import_id', 'workspace_id'],
    source: 'část 2, 4.6',
  },
  {
    name: 'contacts.export',
    domain: 'contacts',
    owner: 'P11',
    description: 'Export s kurzorem na serveru, dávky 5 000 řádků, gzip.',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 30,
    expireInSeconds: 2 * HOUR,
    deadLetter: true,
    payloadFields: ['export_id', 'workspace_id'],
    source: 'část 2, 4.7',
  },
  {
    name: 'contacts.bulk_delete',
    domain: 'contacts',
    owner: 'P07',
    description: 'Hromadné mazání po dávkách 5 000.',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 30,
    expireInSeconds: 2 * HOUR,
    deadLetter: true,
    payloadFields: ['operation_id', 'workspace_id'],
    source: 'část 2, 4.3',
  },
  {
    name: 'contacts.bulk_tag',
    domain: 'contacts',
    owner: 'P07',
    description: 'Hromadné přidání a odebrání štítků nad skupinou přes 5 000 kontaktů.',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 30,
    expireInSeconds: 2 * HOUR,
    deadLetter: true,
    payloadFields: ['operation_id', 'workspace_id'],
    source: 'část 2, 4.4',
  },
  {
    name: 'contacts.bulk_vocative_review',
    domain: 'contacts',
    owner: 'P11',
    description: 'Hromadné vyřízení fronty ke kontrole oslovení po dávkách 5 000.',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 30,
    expireInSeconds: 2 * HOUR,
    deadLetter: true,
    payloadFields: ['operation_id', 'workspace_id'],
    source: 'část 2, 4.5',
  },
  {
    name: 'contacts.strip_attribute',
    domain: 'contacts',
    owner: 'P07',
    description: 'Odstraní klíč z attributes po dávkách 10 000 po smazání vlastního pole.',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 30,
    expireInSeconds: 2 * HOUR,
    deadLetter: true,
    payloadFields: ['workspace_id', 'field_key'],
    source: 'část 2, 4.2',
  },
  {
    name: 'contacts.refingerprint',
    domain: 'contacts',
    owner: 'P07',
    description: 'Po rotaci SECRET_KEY doplní otisky pod novým pokolením, dávky 10 000.',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 60,
    expireInSeconds: 4 * HOUR,
    singletonKeyTemplate: 'global',
    policy: 'stately',
    discardNote:
      'Zahodí se AŽ TŘETÍ požadavek: jeden běh doplňuje otisky, jeden čeká. Schválně ne ' +
      'exclusive: rotaci klíče pouští člověk příkazem mlain rotate-credentials a jeho druhý ' +
      'pokus musí doběhnout, ne zmizet. Čekající běh je idempotentní, doplňuje jen tam, kde ' +
      'otisk pod daným pokolením chybí, takže neudělá práci dvakrát. A schválně ne short: ' +
      'ten aktivní běhy NEOMEZUJE, takže by dvě rotace pouštěné rychle za sebou přešifrovávaly ' +
      'celou instalaci souběžně a zdvojnásobily zátěž bez užitku.',
    deadLetter: true,
    payloadFields: ['key_id', 'cursor'],
    source: 'část 2, 6',
  },
  {
    name: 'contacts.recompute_greeting',
    domain: 'contacts',
    owner: 'P07',
    description:
      'Přepočet oslovení po změně nastavení projektu, volitelně se sjednocením jazyka kontaktů.',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 30,
    expireInSeconds: 2 * HOUR,
    singletonKeyTemplate: '<workspace_id>',
    policy: 'stately',
    discardNote:
      'Zahodí se až TŘETÍ požadavek: jeden přepočet běží, jeden čeká. Schválně ne exclusive: ' +
      'kdyby se zahodila změna nastavení, která přišla za běhu, zůstalo by v databázi staré ' +
      'oslovení a příští kampaň by odešla špatně. Čekající běh si nastavení načte, až začne, ' +
      'takže pokryje i tu změnu, kvůli které byl třetí požadavek zahozen. A schválně ne short, ' +
      'ačkoli tak zněl první návrh: short omezuje POUZE stav created a aktivních běhů neomezuje, ' +
      'takže by nad TÝMŽ projektem mohly běžet dva přepočty souběžně a přepisovat si tytéž řádky ' +
      'kontaktů. Přesně tomu má klíč projektu bránit, viz WORKSPACE_SINGLETON_QUEUES.',
    deadLetter: true,
    payloadFields: ['workspace_id', 'cursor', 'align_locale'],
    source: 'část 2, 4.5',
  },
  {
    name: 'contacts.cleanup_after_reactivation',
    domain: 'contacts',
    owner: 'P07',
    description: 'Naplánovaný úklid po reaktivační kampani, výchozí za 14 dní.',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 60,
    expireInSeconds: 2 * HOUR,
    deadLetter: true,
    payloadFields: ['workspace_id', 'segment_id', 'action'],
    source: 'část 2, 5.8',
  },
  {
    name: 'contacts.cleanup_import_files',
    domain: 'contacts',
    owner: 'P11',
    description:
      'Retence nahraných souborů importu. Po smazání nastaví imports.storage_key na NULL.',
    cron: '5 3 * * *',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 60,
    expireInSeconds: 1 * HOUR,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik je neškodný: běh je sken toho, co je právě po termínu, takže příští tik ' +
      'udělá i to, co tenhle nestihl. Zahodit ho je lepší než pustit druhý sken přes běžící.',
    deadLetter: false,
    payloadFields: [],
    source: 'část 2, 4.6 (název odvozen P01)',
  },
  {
    name: 'contact_fields.verify_index',
    domain: 'contacts',
    owner: 'P07',
    description:
      'Prověří, že vlastní pole je dotazovatelné přes GIN index nad attributes, a přepne index_state. Žádné DDL, rozhodnutí R14.',
    retryLimit: 1,
    retryBackoff: true,
    retryDelaySeconds: 60,
    expireInSeconds: 1 * HOUR,
    singletonKeyTemplate: '<field_id>',
    discardNote:
      'SLUČOVÁNÍ ZÁMĚRNĚ VYPNUTÉ, dokud producent neposílá klíč. Registr slibuje <field_id>, ' +
      'ale jediný producent (repo/contact-fields.ts, deleteContactField) volá enqueue bez ' +
      'options, takže do sloupce jde NULL. Zapnutá politika by všechny prověrky srazila do ' +
      'jednoho kbelíku COALESCE(singleton_key, prázdný řetězec) a prověrka jednoho pole by ' +
      'tiše zahodila prověrku úplně jiného pole. To je ztráta práce, ne slučování.',
    deadLetter: true,
    payloadFields: ['workspace_id', 'field_id'],
    source: 'část 2, 4.2',
  },
  {
    name: 'segments.recount',
    domain: 'contacts',
    owner: 'P11',
    description: 'Přepočet počtu členů segmentu.',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 30,
    expireInSeconds: 30 * MINUTE,
    singletonKeyTemplate: '<segment_id>',
    policy: 'stately',
    discardNote:
      'Zahodí se až TŘETÍ požadavek: jeden přepočet běží, jeden čeká. Schválně ne exclusive: ' +
      'změna členství, která přijde za běhu, musí vést k dalšímu přepočtu, jinak zůstane v ' +
      'segmentu navždy zastaralý počet. Čekající běh čte aktuální data, takže je i po ' +
      'zahození třetího požadavku výsledek správný. A schválně ne short: ten aktivní běhy ' +
      'neomezuje, takže by nad týmž segmentem mohly běžet dva přepočty naráz a do cached_count ' +
      'by zapsal ten, který skončí později, klidně se starším číslem. Ověřeno měřením: dva ' +
      'INSERT se stavem active a týmž klíčem prošly OBA.',
    deadLetter: true,
    payloadFields: ['workspace_id', 'segment_id'],
    source: 'část 2, 5.4',
  },
  {
    name: 'segments.mark_invalid',
    domain: 'contacts',
    owner: 'P11',
    description: 'Označí segmenty odkazující na smazané pole jako neplatné.',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 30,
    expireInSeconds: 15 * MINUTE,
    deadLetter: true,
    // Opraveno podle skutečného producenta (`deleteContactField` v doméně
    // kontaktů). Registr tu měl `field_key`, jenže seznam segmentů se musí
    // spočítat PŘED `DELETE`, dokud pole existuje; po smazání by ho obsluha
    // z klíče už nedohledala a job by tiše neudělal nic.
    payloadFields: ['workspace_id', 'segment_ids', 'error_code', 'field_key'],
    source: 'část 2, 4.2',
  },
  {
    name: 'segments.recalc_for_contact',
    domain: 'contacts',
    owner: 'P11',
    description: 'Přepočet příslušnosti jednoho kontaktu k segmentům po události.',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 15,
    expireInSeconds: 5 * MINUTE,
    deadLetter: true,
    payloadFields: ['workspace_id', 'contact_id'],
    source: 'část 5, 3.9.2',
  },
  {
    name: 'gdpr.export_subject',
    domain: 'contacts',
    owner: 'P07',
    description: 'Sestaví ZIP s daty subjektu.',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 60,
    expireInSeconds: 2 * HOUR,
    singletonKeyTemplate: '<request_id>',
    discardNote:
      'SLUČOVÁNÍ ZÁMĚRNĚ VYPNUTÉ. Registr slibuje <request_id>, ale producent (repo/gdpr.ts, ' +
      'řádek 141) volá enqueue bez options, takže klíč je NULL a všechny žádosti by spadly do ' +
      'jednoho kbelíku. Zahozená úloha by tady znamenala NEVYŘÍZENOU ŽÁDOST SUBJEKTU se ' +
      'zákonnou lhůtou, a to je přesně ten případ, kde se slučování zapínat nesmí.',
    deadLetter: true,
    payloadFields: ['workspace_id', 'request_id'],
    source: 'část 2, 6.4',
  },
  {
    name: 'gdpr.erase',
    domain: 'contacts',
    owner: 'P07',
    description: 'Anonymizace kontaktu podle článku 17.',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 60,
    expireInSeconds: 1 * HOUR,
    singletonKeyTemplate: '<request_id>',
    discardNote:
      'SLUČOVÁNÍ ZÁMĚRNĚ VYPNUTÉ, ze stejného důvodu jako u gdpr.export_subject: producent ' +
      'klíč neposílá a zahozený výmaz podle článku 17 by byl porušením lhůty, o kterém by se ' +
      'nikdo nedozvěděl. Dokud producent neposílá <request_id>, zůstává standard.',
    deadLetter: true,
    payloadFields: ['workspace_id', 'request_id', 'contact_id'],
    source: 'část 2, 6.5',
  },
  {
    name: 'gdpr.sever_links',
    domain: 'contacts',
    owner: 'P07',
    description: 'Odpojí vazby na kontakt v messages, web_events a message_engagement.',
    retryLimit: 5,
    retryBackoff: true,
    retryDelaySeconds: 60,
    expireInSeconds: 2 * HOUR,
    singletonKeyTemplate: '<contact_id>',
    discardNote:
      'SLUČOVÁNÍ ZÁMĚRNĚ VYPNUTÉ. Registr slibuje <contact_id>, ale oba producenti ' +
      '(gdpr/erase.ts, řádky 125 a 205) volají enqueue bez options. Se společným kbelíkem by ' +
      'odpojení vazeb jednoho kontaktu zahodilo odpojení vazeb jiného a v messages i ve ' +
      'web_events by zůstal odkaz na anonymizovaný kontakt.',
    deadLetter: true,
    payloadFields: ['workspace_id', 'contact_id'],
    source: 'část 2, 6.5',
  },
  {
    name: 'inbound.process',
    domain: 'contacts',
    owner: 'P07',
    description: 'Zpracuje přijaté tělo příchozího webhooku po ověření podpisu.',
    retryLimit: 5,
    retryBackoff: true,
    retryDelaySeconds: 15,
    expireInSeconds: 15 * MINUTE,
    singletonKeyTemplate: '<dedup_key>',
    discardNote:
      'SLUČOVÁNÍ ZÁMĚRNĚ VYPNUTÉ: fronta nemá v repozitáři producenta. Obsluha existuje ' +
      '(jobs/inbound-process.ts), ale nikdo do fronty nezařazuje, takže se nedá ověřit, ' +
      'jestli by <dedup_key> doopravdy chodil. Zapnout politiku nad frontou, jejíhož ' +
      'producenta nikdo nenapsal, znamená hádat. Až producent vznikne, vynutí si politiku ' +
      'brána.',
    deadLetter: true,
    payloadFields: ['workspace_id', 'delivery_id'],
    source: 'část 2, 5.6 (název odvozen P01)',
  },
  // Tři fronty doplněné po nálezu, že je P07 implementuje ve svém registru
  // CONTACTS_QUEUES, ale v tomhle registru chyběly. Parametry jsou opsané z P07,
  // aby se registry nerozešly. Uzávěr S8: frontu zakládá P01, handler P07.
  {
    name: 'contacts.cleanup_pending',
    domain: 'contacts',
    owner: 'P07',
    description:
      'Maže nepotvrzené odběry po vypršení TTL potvrzovacího tokenu a po třiceti dnech retence.',
    cron: '55 2 * * *',
    retryLimit: 2,
    retryBackoff: true,
    retryDelaySeconds: 60,
    expireInSeconds: 15 * MINUTE,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik je neškodný: běh je sken toho, co je právě po termínu, takže příští tik ' +
      'udělá i to, co tenhle nestihl. Zahodit ho je lepší než pustit druhý sken přes běžící.',
    deadLetter: true,
    payloadFields: [],
    source: 'část 2, 3.4',
  },
  {
    name: 'consents.rebuild_state',
    domain: 'contacts',
    owner: 'P07',
    description:
      'Přepočte contact_consent_state z append only logu consents po obnově ze zálohy nebo po migraci.',
    retryLimit: 2,
    retryBackoff: true,
    retryDelaySeconds: 60,
    expireInSeconds: 30 * MINUTE,
    singletonKeyTemplate: '<workspace_id>',
    discardNote:
      'SLUČOVÁNÍ ZÁMĚRNĚ VYPNUTÉ: fronta nemá v repozitáři producenta, zařazuje se jedině ' +
      'ručně po obnově ze zálohy nebo po migraci. Bez producenta se nedá ověřit, že klíč ' +
      'chodí.',
    deadLetter: true,
    payloadFields: ['workspace_id', 'contact_id'],
    source: 'část 2, 3.3',
  },
  // retention.run se spouští pro každý projekt zvlášť s rozprostřením v čase
  // (offset z hashe workspace_id), takže cron plánuje jen dispečera; jednotlivé
  // běhy zakládá handler s singletonKey = workspace_id.
  {
    name: 'retention.run',
    domain: 'contacts',
    owner: 'P07',
    description:
      'Denní retenční běh nad jedním projektem podle registru RETENTION_TARGETS, zapisuje do retention_runs.',
    cron: '20 4 * * *',
    retryLimit: 0,
    retryBackoff: false,
    retryDelaySeconds: 0,
    expireInSeconds: 40 * MINUTE,
    singletonKeyTemplate: '<workspace_id>',
    policy: 'exclusive',
    discardNote:
      'Fronta nese DVA druhy úloh a klíč je rozděluje. Tik z cronu je dispečer a má klíč ' +
      'NULL, tedy společný kbelík: zahozený tik znamená vynechaný denní rozvrh a dožene ho ' +
      'zítřejší. Jednotlivé běhy zakládá dispečer s klíčem workspace_id: zahodí se druhý běh ' +
      'nad TÝMŽ projektem, což je žádoucí, protože běh je mazání podle stáří a zítřek smaže i ' +
      'zbytek. Mezi projekty se nezahazuje nic, klíče jsou různé.',
    deadLetter: false,
    payloadFields: ['workspace_id'],
    source: 'část 2, 6.7',
  },

  // --- Obsah, assety, značka a AI, část 3 -----------------------------------
  {
    name: 'content.brand_extract',
    domain: 'content',
    owner: 'P15',
    description: 'Stažení a analýza značky. Bez opakování, opakovaný SSRF pokus není žádoucí.',
    retryLimit: 0,
    retryBackoff: false,
    retryDelaySeconds: 0,
    expireInSeconds: 5 * MINUTE,
    singletonKeyTemplate: '<extraction_id>',
    policy: 'exclusive',
    discardNote:
      'Zahodí se druhé zařazení TÉHOŽ běhu analýzy. Práce se neztrácí, pravdu drží řádek v ' +
      'brand_extractions. Je to i bezpečnostní vlastnost: fronta má schválně retryLimit 0, ' +
      'protože opakovaný pokus o stažení cizí adresy je opakovaný pokus o SSRF, a slučování ' +
      'brání tomu, aby se týž pokus dal spustit dvakrát rychle za sebou.',
    deadLetter: true,
    payloadFields: ['workspace_id', 'extraction_id'],
    source: 'část 3, 4.8',
  },
  {
    name: 'content.process_asset',
    domain: 'content',
    owner: 'P08',
    description: 'Generování variant obrázku.',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 15,
    expireInSeconds: 10 * MINUTE,
    singletonKeyTemplate: '<asset_id>',
    discardNote:
      'SLUČOVÁNÍ ZÁMĚRNĚ VYPNUTÉ: fronta nemá v repozitáři producenta. Obsluha ' +
      '(assets/jobs/process-asset.ts) existuje, ale nahrání assetu ji dnes nezařazuje, takže ' +
      'se nedá ověřit, že by <asset_id> chodil.',
    deadLetter: true,
    payloadFields: ['workspace_id', 'asset_id'],
    source: 'část 3, 4.8',
  },
  {
    name: 'content.revalidate_templates',
    domain: 'content',
    owner: 'P08',
    description: 'Přehodnotí šablony odkazující na smazané pole a označí je jako neplatné.',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 30,
    expireInSeconds: 30 * MINUTE,
    deadLetter: true,
    payloadFields: ['workspace_id', 'field_key'],
    source: 'část 3, 3.8.4',
  },
  {
    name: 'content.cleanup_versions',
    domain: 'content',
    owner: 'P08',
    description: 'Retence verzí šablon podle TEMPLATE_VERSION_RETENTION_DAYS.',
    cron: '10 3 * * *',
    retryLimit: 1,
    retryBackoff: false,
    retryDelaySeconds: 0,
    expireInSeconds: 1 * HOUR,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik je neškodný: běh je sken toho, co je právě po termínu, takže příští tik ' +
      'udělá i to, co tenhle nestihl. Zahodit ho je lepší než pustit druhý sken přes běžící.',
    deadLetter: false,
    payloadFields: [],
    source: 'část 3, 4.8',
  },
  {
    name: 'content.cleanup_assets',
    domain: 'content',
    owner: 'P08',
    description: 'Fyzické mazání assetů po 30 dnech.',
    cron: '20 3 * * *',
    retryLimit: 1,
    retryBackoff: false,
    retryDelaySeconds: 0,
    expireInSeconds: 1 * HOUR,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik je neškodný: maže se podle stáří (30 dní), zítřejší běh smaže i zbytek. ' +
      'Soubor přežije o den déle, což je bezpečný směr chyby. Dva souběžné úklidy by naopak ' +
      'sahaly na tytéž klíče v úložišti.',
    deadLetter: false,
    payloadFields: [],
    source: 'část 3, 4.8',
  },
  {
    name: 'content.verify_asset_refcounts',
    domain: 'content',
    owner: 'P08',
    description: 'Kontrola denormalizovaných počtů referencí na assety.',
    cron: '30 3 * * *',
    retryLimit: 1,
    retryBackoff: false,
    retryDelaySeconds: 0,
    expireInSeconds: 1 * HOUR,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik je neškodný: kontrola je čtení a srovnání denormalizovaných počtů, takže ' +
      'příští tik dá tentýž výsledek.',
    deadLetter: false,
    payloadFields: [],
    source: 'část 3, 4.8',
  },
  {
    name: 'ai.cleanup_conversations',
    domain: 'content',
    owner: 'P15',
    description: 'Retence konverzací podle AI_CONVERSATION_RETENTION_DAYS.',
    cron: '40 3 * * *',
    retryLimit: 1,
    retryBackoff: false,
    retryDelaySeconds: 0,
    expireInSeconds: 1 * HOUR,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik je neškodný: maže se podle stáří (AI_CONVERSATION_RETENTION_DAYS), takže ' +
      'zítřejší běh smaže i zbytek.',
    deadLetter: false,
    payloadFields: [],
    source: 'část 3, 4.8',
  },

  // --- Kampaně, provideři a doručitelnost, část 4a --------------------------
  {
    name: 'campaign.materialize',
    domain: 'campaigns',
    owner: 'P13',
    description: 'Kompilace šablony a materializace publika do outboxu po dávkách.',
    retryLimit: 5,
    retryBackoff: true,
    retryDelaySeconds: 5,
    expireInSeconds: 6 * HOUR,
    singletonKeyTemplate: 'campaign.materialize:<campaign_id>',
    policy: 'exclusive',
    discardNote:
      'Zahodí se druhé zařazení TÉŽE kampaně, a je to nutnost, ne opatrnost: plánovač ' +
      '(jobs/system-deps.ts) tiká každých třicet sekund a zařazuje materializaci znovu, dokud ' +
      'kampaň neopustí stav scheduled. Bez slučování by se za minutu sešly dvě materializace ' +
      'nad týmž outboxem. Práce se nezahazuje, pravdu drží stav kampaně a checkpoint v ' +
      'outboxu, takže běžící úloha pokračuje tam, kde skončila.',
    deadLetter: true,
    payloadFields: ['workspace_id', 'campaign_id', 'revision'],
    source: 'část 4a, 4.5',
  },
  {
    name: 'campaign.scheduler',
    domain: 'campaigns',
    owner: 'P13',
    description: 'Vybírá naplánované kampaně, jejichž čas nastal.',
    cron: '*/30 * * * * *',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 5,
    expireInSeconds: 2 * MINUTE,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik je neškodný: plánovač je sken kampaní, jejichž čas nastal, a příští tik ' +
      'za třicet sekund vezme i ty, které tenhle nestihl. Zahodit ho je přímo žádoucí: sken ' +
      'trvající déle než třicet sekund by jinak nasbíral frontu tiků, které by všechny našly ' +
      'totéž a přetahovaly se o tytéž kampaně.',
    deadLetter: false,
    payloadFields: [],
    source: 'část 4a, 4.5',
  },
  {
    name: 'campaign.watchdog',
    domain: 'campaigns',
    owner: 'P13',
    description: 'Rekoncilace stavu běžících kampaní a jejich uzavírání.',
    cron: '*/15 * * * * *',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 5,
    expireInSeconds: 1 * MINUTE,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik je neškodný: hlídač je rekoncilace stavu, příští tik za patnáct sekund ' +
      'uvidí totéž a udělá i to, co tenhle nestihl.',
    deadLetter: false,
    payloadFields: [],
    source: 'část 4a, 4.5',
  },
  {
    name: 'campaign.resume_on_quota',
    domain: 'campaigns',
    owner: 'P13',
    description:
      'Obnoví kampaně pozastavené pro vyčerpanou kvótu, rozhoduje podle pause_reason.code.',
    cron: '*/10 * * * *',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 30,
    expireInSeconds: 5 * MINUTE,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik je neškodný: obnova čte pause_reason.code z databáze, takže příští tik za ' +
      'deset minut najde tytéž pozastavené kampaně.',
    deadLetter: false,
    payloadFields: [],
    source: 'část 4a, 4.5',
  },
  {
    name: 'outbox.stall_watch',
    domain: 'campaigns',
    owner: 'P13',
    description: 'Hlídá zaseknuté dávky v outboxu.',
    cron: '* * * * *',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 10,
    expireInSeconds: 1 * MINUTE,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik je neškodný: hlídač zaseknutých dávek čte stáří řádků v outboxu, takže ' +
      'příští tik za minutu uvidí zaseknutou dávku o minutu starší.',
    deadLetter: false,
    payloadFields: [],
    source: 'část 4a, 4.5',
  },
  {
    name: 'outbox.reconcile',
    domain: 'campaigns',
    owner: 'P13',
    description: 'Srovná počty v outboxu s campaign_stats.',
    cron: '* * * * *',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 10,
    expireInSeconds: 5 * MINUTE,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik je neškodný: srovnání počtů je čistá funkce obsahu outboxu a ' +
      'campaign_stats, takže příští tik dá tentýž výsledek. Dva souběžné běhy by naopak ' +
      'zapisovaly do campaign_stats proti sobě.',
    deadLetter: false,
    payloadFields: [],
    source: 'část 4a, 4.5',
  },
  {
    name: 'provider_event.process',
    domain: 'campaigns',
    owner: 'P13',
    description: 'Zpracuje událost od providera přijatou webhookem.',
    retryLimit: 10,
    retryBackoff: true,
    retryDelaySeconds: 5,
    expireInSeconds: 15 * MINUTE,
    singletonKeyTemplate: 'event:<dedup_key>',
    discardNote:
      'SLUČOVÁNÍ ZÁMĚRNĚ VYPNUTÉ: fronta nemá v repozitáři producenta. Příjem webhooku od ' +
      'providera dnes do téhle fronty nezařazuje, takže se nedá ověřit, že by ' +
      'event:<dedup_key> chodil. Deduplikaci navíc drží samo dedup_key v databázi.',
    deadLetter: true,
    payloadFields: ['workspace_id', 'receipt_id', 'dedup_key'],
    source: 'část 4a, 4.5',
  },
  {
    name: 'provider_event.rematch',
    domain: 'campaigns',
    owner: 'P13',
    description: 'Zkusí znovu spárovat události, které při prvním průchodu nenašly zprávu.',
    cron: '*/30 * * * * *',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 10,
    expireInSeconds: 5 * MINUTE,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik je neškodný: párování je sken událostí, které při prvním průchodu nenašly ' +
      'zprávu, a ty ve frontě zůstávají, dokud se nespárují.',
    deadLetter: false,
    payloadFields: [],
    source: 'část 4a, 4.5',
  },
  {
    name: 'provider.refresh_quota',
    domain: 'campaigns',
    owner: 'P13',
    description: 'Načte aktuální kvótu providera.',
    cron: '*/15 * * * *',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 30,
    expireInSeconds: 5 * MINUTE,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'OPRAVENO PODLE SKUTEČNÉHO PRODUCENTA. Registr tu měl provider.quota:<provider_id>, ' +
      'jenže REFRESH_QUOTA_JOB.singletonKey nikdo v produktu nevolá: fronta se plní VÝHRADNĚ ' +
      'tikem z cronu s klíčem NULL a obsluha si providery vyjmenuje sama. Klíč je tedy ' +
      'fakticky globální. Zahozený tik je neškodný, kvótu si příští tik za patnáct minut ' +
      'načte znovu.',
    deadLetter: false,
    payloadFields: ['workspace_id', 'provider_id'],
    source: 'část 4a, 4.5',
  },
  {
    name: 'domain.recheck',
    domain: 'campaigns',
    owner: 'P13',
    description: 'Kontrola DNS záznamů domén podle next_check_at.',
    cron: '* * * * *',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 30,
    expireInSeconds: 5 * MINUTE,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'OPRAVENO PODLE SKUTEČNÉHO PRODUCENTA, stejně jako u provider.refresh_quota: ' +
      'DOMAIN_RECHECK_JOB.singletonKey nikdo nevolá, fronta se plní jen tikem z cronu a ' +
      'obsluha si domény po termínu vybere sama (kontroly uvnitř paralelizuje p-limit). ' +
      'Zahozený tik je neškodný: domény zůstanou po termínu a příští tik za minutu je vezme. ' +
      'Zahodit ho je žádoucí, protože kontrola stovek domén může trvat déle než minutu.',
    deadLetter: false,
    payloadFields: ['workspace_id', 'domain_id'],
    source: 'část 4a, 4.5',
  },
  {
    name: 'deliverability.rollup',
    domain: 'campaigns',
    owner: 'P13',
    description: 'Agregace ukazatelů doručitelnosti do snapshotů.',
    cron: '*/15 * * * *',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 30,
    expireInSeconds: 15 * MINUTE,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik je neškodný: agregace je čistá funkce zdrojových dat za okno, takže ' +
      'příští tik za patnáct minut spočítá totéž včetně toho, co tenhle nestihl.',
    deadLetter: false,
    payloadFields: [],
    source: 'část 4a, 4.5',
  },
  // `retention.drop_message_partitions` TADY UŽ NENÍ a nesmí se sem vrátit.
  //
  // Byla v registru s cronem `30 3 * * *`, tedy vypadala jako denní úklid
  // outboxu, a přitom neexistovala její obsluha a nikdy existovat nemohla:
  // odpojení oddílu je DDL a worker běží pod rolí `mlain_app`, která schéma
  // nevlastní. Úloha by skončila na „permission denied", nebo, kdyby jí někdo
  // práva dodal, by dostal právo zahodit tabulku každý handler v aplikaci.
  //
  // Úklid dělá `mlain partitions` pod `DATABASE_URL_MIGRATOR`, pouštěný
  // z plánovače hostitele stejně jako migrace. Viz
  // `packages/core/src/ops/partition-retention.ts`
  // a `docs/operations/partitions-retention.md`.

  // --- Transakční pošta přes API --------------------------------------------
  {
    name: 'transactional.purge_render_data',
    domain: 'campaigns',
    owner: 'P13',
    description:
      'Vynuluje render_data odeslaných transakčních zpráv. Leží v nich odkaz ' +
      's jednorázovým tokenem (reset hesla) a obecná retence outboxu dnes neběží.',
    cron: '15 * * * *',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 60,
    expireInSeconds: 15 * MINUTE,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik nic neztratí, render_data se vynuluje o hodinu později. Odklad je ale ' +
      'citelný, protože v render_data leží jednorázový token na reset hesla, takže tenhle ' +
      'úklid nemá zaostávat. Zahodí se jedině tehdy, když předchozí běh trvá přes hodinu, a ' +
      'to je porucha, kterou je vidět.',
    deadLetter: false,
    payloadFields: [],
    source: 'rozhodnutí zadavatele 5. 8. 2026',
  },

  // --- Tracking a události, část 5 ------------------------------------------
  {
    name: 'tracking.process_engagement',
    domain: 'tracking',
    owner: 'P10',
    description:
      'Z nových message_events spočítá přírůstky do campaign_stats a message_engagement.',
    retryLimit: 5,
    retryBackoff: true,
    retryDelaySeconds: 5,
    expireInSeconds: 10 * MINUTE,
    concurrency: 4,
    deadLetter: true,
    payloadFields: ['workspace_id', 'event_ids'],
    source: 'část 5, 3.9.2',
  },
  {
    name: 'tracking.process_provider_events',
    domain: 'tracking',
    owner: 'P10',
    description: 'Aktualizuje statistiky z událostí zapsaných providerem.',
    retryLimit: 5,
    retryBackoff: true,
    retryDelaySeconds: 5,
    expireInSeconds: 10 * MINUTE,
    deadLetter: true,
    payloadFields: ['workspace_id', 'event_ids'],
    source: 'část 5, 3.13',
  },
  {
    name: 'event.process',
    domain: 'tracking',
    owner: 'P10',
    description: 'Zpracuje webovou událost, dedup okno 7 dní.',
    retryLimit: 5,
    retryBackoff: true,
    retryDelaySeconds: 5,
    expireInSeconds: 10 * MINUTE,
    deadLetter: true,
    payloadFields: ['workspace_id', 'event_ids'],
    source: 'část 5, 3.9.3',
  },
  {
    name: 'identity.merge',
    domain: 'tracking',
    owner: 'P10',
    description: 'Naváže anonymous_id na kontakt a přepíše historii.',
    retryLimit: 5,
    retryBackoff: true,
    retryDelaySeconds: 10,
    expireInSeconds: 30 * MINUTE,
    singletonKeyTemplate: '<binding_id>',
    policy: 'exclusive',
    discardNote:
      'Zahodí se druhé zařazení TÉHOŽ svázání. Práce se neztrácí, pravdu drží řádek vazby a ' +
      'přepis historie je idempotentní. Souběžné navázání téhož anonymous_id na kontakt by ' +
      'naopak přepisovalo tutéž historii dvěma běhy najednou.',
    deadLetter: true,
    payloadFields: ['workspace_id', 'anonymous_id', 'contact_id', 'binding_id'],
    source: 'část 5, 3.8.4',
  },
  {
    name: 'tracking.refresh_campaign_progress',
    domain: 'tracking',
    owner: 'P14',
    description: 'Aktualizuje průběh kampaně pro dashboard a SSE.',
    cron: '*/30 * * * * *',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 10,
    expireInSeconds: 2 * MINUTE,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik je neškodný: průběh se počítá z aktuálního stavu, takže příští tik za ' +
      'třicet sekund zobrazí novější číslo. Zahodit ho je žádoucí, protože dva souběžné ' +
      'přepočty by do dashboardu a SSE tlačily dvě různě stará čísla.',
    deadLetter: false,
    payloadFields: [],
    source: 'část 5, 3.9',
  },
  {
    name: 'tracking.recompute_engagement_windows',
    domain: 'tracking',
    owner: 'P14',
    description: 'Přepočet klouzavých oken zapojení. Čistá funkce zdrojových dat.',
    cron: '50 3 * * *',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 60,
    expireInSeconds: 2 * HOUR,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik je neškodný: přepočet klouzavých oken je čistá funkce zdrojových dat, ' +
      'takže zítřejší běh dá tentýž výsledek.',
    deadLetter: false,
    payloadFields: [],
    source: 'část 5, 3.9.4',
  },
  {
    name: 'tracking.cleanup_token_uses',
    domain: 'tracking',
    owner: 'P10',
    description: 'Maže identity_token_uses s expires_at v minulosti.',
    cron: '0 * * * *',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 60,
    expireInSeconds: 15 * MINUTE,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik je neškodný: maže se podle expires_at, takže příští běh za hodinu smaže i ' +
      'to, co zbylo.',
    deadLetter: false,
    payloadFields: [],
    source: 'část 5, 3.10.3',
  },
  // `tracking.enforce_retention` TADY UŽ NENÍ, ze stejného důvodu jako
  // `retention.drop_message_partitions` výš: odpojení oddílu je DDL a worker
  // na ně nemá a nesmí mít práva. `web_events` i `message_events` uklízí
  // `mlain partitions` podle `TRACKING_RETENTION_MONTHS`, respektive
  // `MESSAGE_EVENT_RETENTION_DAYS`. Dva úklidy dvou tabulek týmž mechanismem
  // ze dvou míst by znamenaly dvě různá pravidla pro totéž.
  {
    name: 'tracking.refresh_proxy_ranges',
    domain: 'tracking',
    owner: 'P10',
    description: 'Stáhne rozsahy Apple relay, když je TRACKING_APPLE_RELAY_RANGES zapnuté.',
    cron: '0 5 * * *',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 300,
    expireInSeconds: 30 * MINUTE,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik je neškodný: rozsahy Apple relay se stahují celé, takže zítřejší běh ' +
      'přinese aktuální seznam. Do té doby platí ten včerejší, což je přesně to, co by ' +
      'platilo i po neúspěšném stažení.',
    deadLetter: false,
    payloadFields: [],
    source: 'část 5, 3.6',
  },
  {
    name: 'tracking.erase_contact',
    domain: 'tracking',
    owner: 'P10',
    description: 'Vymaže stopu kontaktu ve web_events a message_engagement.',
    retryLimit: 5,
    retryBackoff: true,
    retryDelaySeconds: 60,
    expireInSeconds: 1 * HOUR,
    singletonKeyTemplate: '<contact_id>',
    discardNote:
      'SLUČOVÁNÍ ZÁMĚRNĚ VYPNUTÉ: fronta nemá v repozitáři producenta. Obsluha existuje, ale ' +
      'nikdo do fronty nezařazuje, takže se nedá ověřit, že by <contact_id> chodil. Navíc je ' +
      'to výmaz osobních údajů, tedy přesně ten druh úlohy, kde se slučování nezapíná ' +
      'naslepo.',
    deadLetter: true,
    payloadFields: ['workspace_id', 'contact_id'],
    source: 'část 5, 3.15',
  },
  // Doplněno po nálezu: P10 tuhle frontu implementuje a P16 ji volá z CLI
  // (`mlain rebuild-engagement`), ale v registru chyběla. Bez opakování
  // schválně: rekonstrukce od nuly běží nad celým projektem a opakovaný běh
  // po selhání uprostřed by jen zdvojnásobil zátěž. Operátor ji pustí znovu sám.
  {
    name: 'tracking.rebuild_engagement',
    domain: 'tracking',
    owner: 'P10',
    description:
      'Rekonstrukce contact_engagement od nuly ze zdroje pravdy message_engagement po havárii nebo obnově zálohy.',
    retryLimit: 0,
    retryBackoff: false,
    retryDelaySeconds: 0,
    expireInSeconds: 2 * HOUR,
    concurrency: 1,
    singletonKeyTemplate: '<workspace_id>',
    discardNote:
      'SLUČOVÁNÍ ZÁMĚRNĚ VYPNUTÉ: fronta nemá v repozitáři producenta. Příkaz mlain ' +
      'rebuild-engagement volá dávkovač ops/rebuild-engagement.ts PŘÍMO a do fronty ' +
      'nezařazuje nic, takže klíč <workspace_id> dnes neposílá nikdo.',
    deadLetter: true,
    payloadFields: ['workspace_id', 'batch_size'],
    source: 'část 5, 3.9.4 a kritérium 77',
  },

  // --- Sender, část 4b ------------------------------------------------------
  // Sender je Go proces s vlastní smyčkou nad outboxem a pg-boss nepoužívá.
  // Jediná fronta, kterou jeho provoz zakládá na straně aplikace, je tahle.
  {
    name: 'sender.credentials_refresh',
    domain: 'sender',
    owner: 'P13',
    description:
      'Přešifruje a znovu publikuje credentials providera po rotaci klíče, aby je sender načetl.',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 60,
    expireInSeconds: 30 * MINUTE,
    singletonKeyTemplate: '<provider_id>',
    policy: 'exclusive',
    discardNote:
      'Zahodí se druhé zařazení nad TÝMŽ providerem. Práce se neztrácí: přešifrování čte ' +
      'aktuální credentials z databáze, takže běžící úloha publikuje i tu změnu, kvůli které ' +
      'přišel zahozený požadavek.',
    deadLetter: true,
    payloadFields: ['workspace_id', 'provider_id'],
    source: 'část 4b, 3.13 a část 1, 3.10 (název odvozen P01)',
  },
];

const BY_NAME = new Map(QUEUE_REGISTRY.map((entry) => [entry.name, entry]));

export function queueNames(): string[] {
  return QUEUE_REGISTRY.map((entry) => entry.name);
}

export function queue(name: string): QueueEntry {
  const entry = BY_NAME.get(name);
  if (!entry) {
    throw new Error(
      `Neregistrovaná fronta "${name}". Fronty se zakládají výhradně v plánu P01, uzávěr S8.`,
    );
  }
  return entry;
}

export function dlqName(name: string): string {
  return `${name}.dlq`;
}

export function cronQueues(): (QueueEntry & { cron: string })[] {
  return QUEUE_REGISTRY.filter(
    (entry): entry is QueueEntry & { cron: string } => typeof entry.cron === 'string',
  );
}

/** Modul s handlerem, který codegen workeru hledá. */
export function handlerModulePath(entry: QueueEntry): string {
  const [domainPart] = entry.name.split('.');
  return `packages/core/src/${domainPart}/jobs/queue-handlers.ts`;
}
