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
    policy: 'exclusive',
    discardNote:
      'PRODUCENT UŽ EXISTUJE, takže se politika zapnula přesně tak, jak tenhle záznam dřív ' +
      'sliboval. Zařazuje fanoutEvent (platform/webhooks/emit.ts) ve stejné transakci jako ' +
      'INSERT řádku a opakovací sken platform.webhook_retry podle next_attempt_at. Zahodí se ' +
      'tedy druhé zařazení TÉHOŽ doručení, tedy souběh těch dvou cest; práce se neztratí, ' +
      'protože pravdu drží řádek ve webhook_deliveries a další pokus zařadí sken. Pořadí ' +
      'doručení na týž endpoint se NEDRŽÍ: šlo by to jedině přes key_strict_fifo s klíčem ' +
      'endpointu, jenže tam by jedno trvale selhavší doručení zamklo endpoint navždy.',
    deadLetter: false,
    payloadFields: ['delivery_id', 'created_at'],
    source: 'část 1, 3.8',
  },
  /*
   * OPAKOVACÍ SKEN DORUČENÍ. Fronta doplněná po nálezu, že odchozí webhooky
   * neodejdou vůbec.
   *
   * Sama o sobě je to druhá polovina opravy a bez ní by ta první nestačila.
   * `platform.webhook_deliver` má schválně `retryLimit: 0`, protože odstupy mezi
   * pokusy řídí aplikace vlastní tabulkou (`webhooks/backoff.ts`), ne pg-boss.
   * Bez skenu by tedy PRVNÍ neúspěch byl zároveň poslední: `applyDeliveryOutcome`
   * by poctivě spočítal `next_attempt_at`, zapsal ho, a nikdo by se na ten sloupec
   * nikdy nepodíval. Totéž platí pro ruční opakování z obrazovky
   * (`retryDelivery` v delivery-query.ts), které řádek jen vrátí na `pending`.
   */
  {
    name: 'platform.webhook_retry',
    domain: 'platform',
    owner: 'P04',
    description: 'Zařadí doručení, jejichž next_attempt_at nastal, včetně ručního opakování.',
    cron: '* * * * *',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 10,
    expireInSeconds: 5 * MINUTE,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik je neškodný: sken je výběr doručení po termínu podle next_attempt_at, ' +
      'takže příští tik za minutu vezme i to, co tenhle nestihl. Zahodit ho je žádoucí, ' +
      'protože sken jde přes všechny projekty a může trvat déle než minutu; dva souběžné ' +
      'běhy by se přetahovaly o tatáž doručení.',
    deadLetter: false,
    payloadFields: [],
    source: 'část 1, 3.8 (fronta doplněna po nálezu, viz komentář výš)',
  },
  // `platform.maintain_partitions` SE 7. 8. 2026 VRÁTILA, a je to jediná
  // fronta, která se kdy vrátila ze seznamu zrušených. Proč, ať to nikdo
  // neotočí zpátky bez znalosti obou kroků:
  //
  // ZRUŠENA BYLA PRÁVEM. Slibovala práci s oddíly a nedělala žádnou. Zakládání
  // oddílu je `CREATE TABLE ... PARTITION OF`, tedy DDL, a worker jede pod rolí
  // `mlain_app`, která schéma nevlastní. Obsluha jí proto nikdy nevznikla
  // a pod aplikační rolí ani vzniknout nemohla; v registru jen vypadala jako
  // denní údržba v 02:00.
  //
  // VRÁTILA SE, PROTOŽE NÁHRADA NIKDE NEBĚŽELA. Práci převzal `mlain partitions`
  // pod `DATABASE_URL_MIGRATOR`, jenže ten se pouští z plánovače hostitele,
  // a dodávaná instalace žádný nemá: ani `docker/compose.yml`, ani
  // `compose.scale.yml` nic takového nespouštějí a na PaaS k hostiteli přístup
  // není. Retence odeslané pošty tedy v praxi neběžela NIKDE, jen to tentokrát
  // vypadalo vyřešeně.
  //
  // NÁMITKA Z ROKU PŘEDTÍM UŽ NEPLATÍ. Obsluha neběží pod aplikační rolí:
  // `maintainPartitions()` si otevře vlastní spojení pod migrátorem, takže
  // `mlain_app` žádné právo na DDL nedostává. Přesně tak běží `platform.backup`
  // od P16. Fronta a `mlain partitions` jsou dvě spouštění TÉŽE funkce, ne dva
  // mechanismy; poznají se v auditu podle popisku aktéra.
  //
  // Zakládání dopředu a úklid za lhůtou zůstávají schválně v JEDNÉ úloze: bez
  // zakládání dopředu přestane instalace po čtyřech měsících přijímat zápisy,
  // protože výchozí oddíl se nezakládá a zápis mimo okno tvrdě selže. Viz
  // `packages/core/src/ops/partition-retention.ts`,
  // `packages/core/src/ops/jobs/partition-jobs.ts`
  // a `docs/operations/partitions-retention.md`.
  //
  // Třetí pojistkou zůstává migrační runner: `runMigrations` volá
  // `ensureUpcomingPartitions(client, new Date(), 4)`, takže každý upgrade
  // okno posune, i kdyby worker stál a plánovač nikdo nenastavil.
  {
    name: 'platform.maintain_partitions',
    domain: 'platform',
    owner: 'P16',
    description:
      'Retence odeslané pošty a událostí plus zakládání oddílů čtyři měsíce dopředu. ' +
      'Táž práce, jakou dělá `mlain partitions`, pod rolí migrátora.',
    // O deset minut dřív než ostatní noční úklidy a hodinu před zálohou.
    // Pořadí není libovolné: `DETACH PARTITION CONCURRENTLY` sice bere jen
    // krátký zámek, ale záloha běžící přes odpojování by měla v dumpu tabulku
    // ve dvou různých stavech.
    cron: '5 2 * * *',
    // JEDEN POKUS S ODSTUPEM, ne tři. Když úklid spadne, spadne skoro vždycky
    // na něčem, co se za pár minut nespraví (chybějící migrátorské URL, právo,
    // zamčená tabulka), a další tik přijde stejně zítra. Jeden opakovaný pokus
    // po pěti minutách pokrývá to jediné, co se spravit může: krátkodobě
    // nedostupné spojení při zápisu do auditu.
    retryLimit: 1,
    retryBackoff: false,
    retryDelaySeconds: 300,
    expireInSeconds: 1 * HOUR,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik je neškodný a žádoucí: úklid se řídí stářím dat, takže zítřejší běh ' +
      'zahodí i to, co dnešní nestihl, a oddíly dopředu zakládá se čtyřměsíční rezervou. ' +
      'Nepřijatelné by bylo opačné pořadí, tedy dva souběžné běhy: druhý by odpojoval oddíl, ' +
      'který první právě odpojuje, a skončil by chybou nad polovičním stavem katalogu.',
    deadLetter: true,
    payloadFields: [],
    source: 'část 1, 3.9 (fronta obnovena 7. 8. 2026, viz komentář výš)',
  },
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
  // `platform.cleanup_audit_log` BYLA ZRUŠENA 7. 8. 2026 a retenci auditu
  // převzalo `platform.maintain_partitions`. Ať to nikdo nevrací zpátky:
  //
  // NIKDY ANI JEDNOU NEDOBĚHLA. Mazala příkazem `DELETE FROM audit_log` pod
  // aplikační rolí, jenže migrace 0005, 0009, 0022 i 0026 dělají
  // `REVOKE UPDATE, DELETE ON audit_log FROM mlain_app`. Padala tedy každou noc
  // na `permission denied for table audit_log` (SQLSTATE 42501) a audit se
  // neuklidil nikdy. Ověřeno spuštěním proti čerstvě zmigrované databázi.
  //
  // ODEBRANÉ PRÁVO SE NEVRACÍ. Že aplikace do auditu smí zapisovat a nesmí
  // z něj mazat, je ta vlastnost, kvůli které je audit k něčemu. Migrace, která
  // by roli `DELETE` vrátila, by tu záruku zrušila kvůli úklidu.
  //
  // PRÁCI DĚLÁ ZAHOZENÍ ODDÍLU pod migrátorem, tedy týž mechanismus, jaký už
  // uklízí `messages`, `message_events` a `web_events`; `audit_log` je od téhle
  // změny čtvrtý cíl v `ops/partition-retention.ts`. Lhůtu dál řídí
  // `AUDIT_RETENTION_MONTHS` a platí u ní totéž, co slibovala zrušená fronta:
  // audit se drží DÉLE, nikdy kratší dobu, protože oddíl smí zmizet až tehdy,
  // když je za lhůtou i jeho poslední den.
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
    /*
     * OBNOVA ZASEKNUTÝCH IMPORTŮ. Do registru přidána 7. 8. 2026, do té doby
     * ji nevolal NIKDO, přestože obsluha, test i migrace 0024 (grant a politika
     * pro sken napříč projekty) existovaly.
     *
     * Proč to není kosmetika: `confirmImport` v `import/service.ts` odmítne každý
     * další import v projektu, dokud v něm leží řádek ve stavu `importing`
     * (kód `import_already_running`). Zabitý worker uprostřed importu tedy
     * projektu zamkl importování NATRVALO a jediná cesta ven vedla přes ruční
     * zásah do databáze. Ve vývojové instalaci se to 7. 8. stalo a zadavatel
     * na to narazil.
     *
     * Každých deset minut, ne v noci: zamčené importování je vidět hned a čekat
     * s nápravou do druhého dne by znamenalo den bez importů. Sken sám je levný,
     * je to jeden dotaz nad `imports` s podmínkou na stáří.
     */
    name: 'contacts.recover_stale_imports',
    domain: 'contacts',
    owner: 'P11',
    description:
      'Sken zaseknutých importů napříč projekty. Řádek ve stavu importing, který se ' +
      'nehnul, zařadí zpátky do contacts.import, aby projekt nezůstal se zamčeným importováním.',
    cron: '*/10 * * * *',
    // JEDEN POKUS. Když sken spadne, spadne na nedostupné databázi nebo na právech,
    // a obojí se za deset minut buď spraví samo, nebo ho nespraví ani třetí pokus.
    // Další tik přijde tak jako tak.
    retryLimit: 1,
    retryBackoff: false,
    retryDelaySeconds: 60,
    expireInSeconds: 10 * MINUTE,
    singletonKeyTemplate: 'global',
    policy: 'exclusive',
    discardNote:
      'Zahozený tik je neškodný: sken se řídí STÁŘÍM řádku, takže příští běh najde totéž ' +
      'a ještě víc. Dva souběžné běhy by naopak týž import zařadily dvakrát; před tím ' +
      'chrání i klíč fronty contacts.import, který je ID importu.',
    deadLetter: true,
    payloadFields: [],
    source: 'část 2, import (fronta zapojena 7. 8. 2026, viz komentář výš)',
  },
  {
    name: 'contacts.import',
    domain: 'contacts',
    owner: 'P11',
    // POPIS SE SROVNAL SE SKUTEČNOSTÍ, CHOVÁNÍ SE NEMĚNILO. Stálo tu „jeden běžící
    // import na projekt", což čtenáře vedlo k tomu, že to zařizuje klíč fronty.
    // Nezařizuje: klíč je ID importu, tedy „jeden běh nad jedním importem". Omezení
    // na projekt existuje, ale drží ho DOMÉNA, ne pg-boss: `confirmImport`
    // (`contacts/import/service.ts`) se před přechodem do `importing` podívá, jestli
    // v projektu neběží jiný import, a když ano, odpoví `resource_locked` s kódem
    // `import_already_running`. Je to lepší místo: uživatel dostane srozumitelnou
    // odpověď hned, kdežto klíč projektu by úlohu tiše sloučil.
    description:
      'Import CSV po dávkách s checkpointy. Klíč je ID importu, tedy jeden běh nad jedním ' +
      'importem; jeden běžící import na projekt hlídá confirmImport, ne fronta.',
    retryLimit: 3,
    retryBackoff: true,
    retryDelaySeconds: 30,
    expireInSeconds: 6 * HOUR,
    singletonKeyTemplate: '<import_id>',
    policy: 'exclusive',
    discardNote:
      'OPRAVENO PODLE SKUTEČNÉHO PRODUCENTA. Registr tu měl <workspace_id>, jenže jediný ' +
      'producent (confirmImport v import/service.ts) posílá importId. Fáze validace tu ' +
      'kdysi posílala <workspace_id>:validate:<import_id>, ale ta se ZRUŠILA CELÁ: nahrání ' +
      'souboru dnes do fronty nezařazuje nic, protože obsluha na phase nekoukala a import ' +
      'proběhl dřív, než se uživatel proklikal k volbám. Klíč projektu tu tedy nikdy nikdo ' +
      'neposlal a batch.ts před ním výslovně varuje: zabitý worker by projektu zamkl VŠECHNY ' +
      'další importy, a to i obnovu, protože recover-stale.ts zařazuje s onMerged drop a ' +
      'obnova zaseknutého importu B by se sloučila s běžícím importem A. Zahodí se tedy druhé ' +
      'zařazení TÉHOŽ importu, což je přesně to, co dělá recover-stale.ts, když se plete ' +
      's běžícím během. Práce se neztrácí, pravdu drží řádek v imports i s checkpointem.',
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
      'kontaktů. Přesně tomu má klíč projektu bránit, viz WORKSPACE_SINGLETON_QUEUES. ' +
      'Slib „čekající běh si nastavení načte" platí i pro JAZYK, ale až od 7. 8. 2026: do té ' +
      'doby nesl náklad cílový jazyk (`align_locale.to`) a zahození novějšího požadavku tím ' +
      'zahazovalo SMĚR změny, takže projekt vrácený zpátky na češtinu mohl skončit ' +
      's kontakty v angličtině. Cíl se čte ze sloupce `workspaces.locale` při zpracování.',
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
  // Úklid dělá `platform.maintain_partitions` (a ručně `mlain partitions`),
  // obojí pod `DATABASE_URL_MIGRATOR`, tedy pod toutéž rolí jako migrace. Ta
  // fronta si spojení pod migrátorem otvírá sama uvnitř obsluhy, takže právo
  // na DDL nedostává aplikační role, jen ten jeden běh. Viz
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
  // `retention.drop_message_partitions` výš: odpojení oddílu je DDL a aplikační
  // role na ně nemá a nesmí mít práva. `web_events` i `message_events` uklízí
  // `platform.maintain_partitions` podle `TRACKING_RETENTION_MONTHS`,
  // respektive `MESSAGE_EVENT_RETENTION_DAYS`. Dva úklidy dvou tabulek týmž
  // mechanismem ze dvou míst by znamenaly dvě různá pravidla pro totéž.
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
  // `tracking.erase_contact` TADY UŽ NENÍ a nezakládejte ji znovu.
  //
  // Slibovala, že vymaže stopu kontaktu ve `web_events` a `message_engagement`,
  // a tu práci PRÁVĚ TEĎ dělá `gdpr.sever_links`: ta obě tabulky odpojí od
  // kontaktu a volají ji oba producenti výmazu (`contacts/gdpr/erase.ts`,
  // řádky 125 a 205), tedy jak anonymizace, tak tvrdé smazání.
  //
  // Nebyla to odložená funkce, byla to DRUHÁ CESTA K TÉMUŽ. Neměla producenta
  // ANI obsluhu a `apps/worker/test/handler-coverage.test.ts` u ní ten důvod
  // vedl doslova: „druhá cesta k témuž by znamenala dva výklady toho, co
  // znamená vymazat kontakt". Dokud v registru stála, četla se jako
  // neimplementovaný výmaz stopy, ačkoli výmaz funguje a je otestovaný.
  //
  // Kdyby se někdy ukázalo, že `gdpr.sever_links` nestačí, patří rozšíření do
  // NÍ, ne do nové fronty vedle ní. Výmaz podle článku 17 musí mít jednu cestu,
  // u které jde dokázat, že proběhla celá.
  // `tracking.rebuild_engagement` TADY UŽ NENÍ a nezakládejte ji znovu.
  //
  // Rekonstrukci `contact_engagement` po havárii nebo obnově zálohy dělá příkaz
  // `mlain rebuild-engagement`, který volá dávkovač `ops/rebuild-engagement.ts`
  // PŘÍMO. To je funkční cesta a má svůj test.
  //
  // Fronta vedle něj byla cesta, KTEROU NIKDO NIKDY NESPUSTIL. Poznalo se to na
  // její vlastní obsluze: přijímala náklad ve DVOU tvarech (`workspace_id`
  // i `workspaceId`) naslepo, protože se nedalo ověřit, který z nich by
  // producent posílal. Nespuštěná obsluha není hotová funkce, je to závazek:
  // tváří se jako druhá cesta, na kterou se dá spolehnout.
  //
  // Kdyby se ukázalo, že běh v popředí terminálu vadí (rekonstrukce je dlouhá),
  // fronta se přidá ZNOVU A VĚDOMĚ, s producentem a s testem, který ji projde
  // celou. Rozhodnutí zadavatele: dnes je to volba mezi funkční a nefunkční
  // cestou, ne mezi dvěma funkčními.

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

/**
 * FRONTY, KTERÉ SE ZRUŠILY A MUSÍ ZMIZET I Z BĚŽÍCÍ DATABÁZE.
 *
 * PROČ TENHLE SEZNAM VŮBEC MUSÍ EXISTOVAT. Vyškrtnutí fronty z registru je
 * změna KÓDU, ne dat. Na čisté instalaci se fronta prostě nezaloží, jenže na
 * instalaci, která běží, řádek v `pgboss.queue` zůstane ležet i s tím, co k němu
 * patří: plán v `pgboss.schedule` a nedokončené tiky v `pgboss.job`. Srovnávání
 * politik (`reconcilePolicies`) na ně schválně nesahá, protože chodí jen po
 * frontách z registru, takže se o nich nedozví nikdo.
 *
 * A NENÍ TO KOSMETIKA, JE TO ŽIVÝ CRON. Naměřeno ve vývojové databázi 7. 8.:
 * `platform.maintain_partitions` a `retention.drop_message_partitions` měly
 * v `pgboss.schedule` pořád svůj denní výraz a v `pgboss.job` po čtyřech ticích
 * ve stavu `created`. Zrušená fronta tedy dál každý den tikala do prázdna
 * a v tabulce úloh přibývaly řádky, které si nikdo nikdy nevyzvedne. V seznamu
 * front to navíc vypadalo jako naplánovaná údržba, která se „jen nespouští".
 *
 * DŮVOD JE POVINNÝ a je to tentýž text jako v náhrobním komentáři u fronty.
 * Kdo tenhle seznam čte, musí poznat rozdíl mezi „práci dělá něco jiného"
 * a „ta práce se dneska nedělá vůbec".
 *
 * JAK SE SEM POLOŽKA PŘIDÁVÁ. Zároveň s vyškrtnutím fronty z registru, ne
 * později. Test `retired.test.ts` hlídá obojí: jméno tady nesmí být zároveň
 * v registru a náhrobní komentář v registru musí mít protějšek tady.
 */
export const RETIRED_QUEUES: readonly { readonly name: string; readonly reason: string }[] = [
  // `platform.maintain_partitions` TU UŽ NENÍ, protože se 7. 8. 2026 vrátila do
  // registru. Zrušená byla proto, že pod aplikační rolí nešlo dělat DDL;
  // vrátila se s obsluhou, která si otvírá vlastní spojení pod migrátorem,
  // protože náhradní cesta (`mlain partitions` z plánovače hostitele) se
  // v dodávané instalaci nikdy nespouštěla. Celý rozbor je u fronty v registru.
  // NEPŘIDÁVEJTE ji sem zpátky, aniž byste ji zároveň vyškrtli z registru:
  // worker by ji každý start založil a hned smazal.
  {
    name: 'retention.drop_message_partitions',
    reason:
      'Odpojení oddílu za lhůtou dělá platform.maintain_partitions, a to pod migrátorským ' +
      'spojením, ne pod aplikační rolí. Druhá fronta nad touž prací by znamenala dvě různá ' +
      'pravidla pro totéž a dvě místa, kde se dá zahodit tabulka.',
  },
  {
    name: 'tracking.enforce_retention',
    reason:
      'Retenci web_events i message_events dělá platform.maintain_partitions pod migrátorským ' +
      'spojením. Dva úklidy dvou tabulek týmž mechanismem ze dvou míst by znamenaly dvě různá ' +
      'pravidla pro totéž.',
  },
  {
    name: 'tracking.erase_contact',
    reason:
      'Stopu kontaktu ve web_events a message_engagement odpojuje gdpr.sever_links a volají ji ' +
      'oba producenti výmazu. Druhá cesta k témuž by znamenala dva výklady toho, co znamená ' +
      'vymazat kontakt; výmaz podle článku 17 musí mít jednu cestu.',
  },
  {
    name: 'platform.cleanup_audit_log',
    reason:
      'Retenci audit_log dělá platform.maintain_partitions pod migrátorským spojením. Tahle ' +
      'fronta mazala příkazem DELETE pod aplikační rolí, jenže migrace 0005, 0009, 0022 i 0026 ' +
      'berou mlain_app právo DELETE na audit_log, takže NIKDY ANI JEDNOU NEDOBĚHLA: padala ' +
      'každou noc na permission denied a audit se neuklidil. Vyškrtnuta z registru 7. 8. 2026, ' +
      'sem dopsána 8. 8. 2026, protože do té doby chyběla a fronta zůstala v databázi i s cronem.',
  },
  {
    name: 'tracking.rebuild_engagement',
    reason:
      'Rekonstrukci contact_engagement dělá příkaz `mlain rebuild-engagement`, který volá ' +
      'dávkovač přímo. Fronta vedle něj byla cesta, kterou nikdo nikdy nespustil: její obsluha ' +
      'přijímala náklad ve dvou tvarech naslepo, protože se nedalo ověřit, který by chodil.',
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

/**
 * Předpona front, které si zakládá pg-boss sám pro svůj vlastní provoz.
 *
 * Do žádného počtu ani do žádné kontroly nepatří: uživatel je nezaložil, registr
 * o nich neví a nikdo je nespravuje. Jejich desetitisíce doběhlých úloh by
 * v součtu přebily všechnu skutečnou práci a v kontrole na fronty mimo registr
 * by se tvářily jako sirotci.
 */
export const INTERNAL_QUEUE_PREFIX = '__pgboss__';

/**
 * JEDINÝ TVAR VOLEB, SE KTERÝM SE FRONTA ZAKLÁDÁ. Používá ho worker
 * (`registerQueues`) i testovací prostředí (`test-support/pgboss.ts`).
 *
 * PROČ TO NENÍ DVAKRÁT OPSANÉ, JAKO BYLO. Testovací prostředí zakládalo fronty
 * samo a posílalo jedinou volbu, `deadLetter`. Politika slučování tedy v testech
 * zůstávala `standard`, kdežto v provozu byla `exclusive` nebo `stately`, a to
 * je přesně ten rozdíl, kvůli kterému test nezměří, co dělá provoz: v testu se
 * druhá úloha s týmž klíčem ZAŘADÍ, v provozu se zahodí. Test na slučování by
 * tedy prošel, i kdyby se slučování celé rozbilo, a test, který se spoléhá na
 * to, že druhé zařazení projde, by byl v provozu nepravdivý.
 *
 * `pgboss.create_queue` má `ON CONFLICT DO NOTHING`, takže na existující frontě
 * tyhle volby nic nezmění; od toho je `reconcilePolicies` ve workeru. Tady jde
 * o čistou instalaci, a tou je každá testovací databáze.
 */
export function queueCreateOptions(entry: QueueEntry): Record<string, unknown> {
  return {
    // Konvence 9.1: explicitně, nikdy se nespoléhat na výchozí hodnoty.
    retryLimit: entry.retryLimit,
    retryBackoff: entry.retryBackoff,
    retryDelay: entry.retryDelaySeconds,
    expireInSeconds: entry.expireInSeconds,
    // Slučování duplicitních úloh. Bez tohohle řádku uloží pg-boss `singletonKey`
    // do sloupce a NIC podle něj neslučuje, protože pro politiku `standard` ho
    // ignoruje. Přesně v tom stavu byl produkt: 47 front klíč deklarovalo,
    // producenti ho posílali, a nesloučila se ani jedna úloha.
    //
    // Fronta bez `policy` v registru zůstává `standard` schválně, důvod je
    // u každé takové v jejím `discardNote`.
    ...(entry.policy ? { policy: entry.policy } : {}),
    ...(entry.deadLetter ? { deadLetter: dlqName(entry.name) } : {}),
  };
}

/**
 * Volby fronty pro nedoručitelné úlohy.
 *
 * BEZ POLITIKY, a to je rozhodnutí, ne opomenutí: slučovat nedoručitelné úlohy
 * by znamenalo tiše zahodit právě to, co se má vyšetřit. BEZ OPAKOVÁNÍ ze
 * stejného důvodu: úloha se sem dostala až po vyčerpání pokusů ve své frontě.
 */
export function dlqCreateOptions(entry: QueueEntry): Record<string, unknown> {
  return {
    retryLimit: 0,
    retryBackoff: false,
    retryDelay: 0,
    expireInSeconds: entry.expireInSeconds,
  };
}

/**
 * Úplný předpis zakládání front: co založit, s jakými volbami a V JAKÉM POŘADÍ.
 *
 * Jedna funkce pro provoz i pro testy. Kdyby si obě strany jen půjčovaly
 * `queueCreateOptions` a cyklus si psaly samy, rozešly by se v pořadí, a to je
 * druhá polovina téhož problému: pg-boss trvá na tom, aby fronta pro
 * nedoručitelné existovala DŘÍV než ta, která na ni odkazuje, jinak řekne
 *
 *   Error: Queue platform.webhook_fanout.dlq does not exist
 *
 * Dokud si pg-boss migroval schéma sám, zakládal si chybějící fronty mimoděk
 * při prvním `send`, takže na pořadí nezáleželo. Od chvíle, kdy schéma vlastní
 * migrátor a worker jede s `migrate: false`, je `createQueue()` jediná cesta
 * a pořadí najednou rozhoduje; kontejner na tom skončil v restartové smyčce.
 */
/**
 * Jména k odstranění z běžící databáze, V POŘADÍ, ve kterém se smí mazat.
 *
 * POŘADÍ JE OPAČNÉ NEŽ PŘI ZAKLÁDÁNÍ, a to není symetrie pro symetrii, ale
 * cizí klíče. `queue.dead_letter` i `job.dead_letter` odkazují na `queue.name`
 * s `ON DELETE RESTRICT`, takže smazat napřed `<fronta>.dlq` by skončilo na
 * porušení cizího klíče, dokud na ni hlavní fronta (nebo kterákoli její úloha)
 * ukazuje. Napřed tedy hlavní fronta i s úlohami, teprve pak její dead letter.
 *
 * Dead letter fronta se přidává vždy: registr už neví, jestli ji zrušená fronta
 * měla, a smazání neexistující fronty je v pg-bossu tichá prázdná operace.
 */
export function retiredQueueDeleteOrder(): readonly string[] {
  return RETIRED_QUEUES.flatMap((retired) => [retired.name, dlqName(retired.name)]);
}

export function queueCreatePlan(): readonly { name: string; options: Record<string, unknown> }[] {
  const plan: { name: string; options: Record<string, unknown> }[] = [];
  for (const entry of QUEUE_REGISTRY) {
    if (entry.deadLetter)
      plan.push({ name: dlqName(entry.name), options: dlqCreateOptions(entry) });
    plan.push({ name: entry.name, options: queueCreateOptions(entry) });
  }
  return plan;
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
