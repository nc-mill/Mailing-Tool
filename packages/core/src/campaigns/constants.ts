/**
 * Meze planovani jsou konstanty, ne konfiguracni promenne. Duvod je v casti 4a, 3.5.2:
 * je to validace vstupu verejneho API, ne provozni parametr. Kdyby to byly promenne
 * prostredi, choval by se POST /campaigns/{id}/schedule na dvou instalacich jinak
 * a klient by to nemohl vedet predem.
 */
export const SCHEDULE_MIN_LEAD_MINUTES = 5;
export const SCHEDULE_MAX_AHEAD_DAYS = 365;
export const SCHEDULE_GRANULARITY_SECONDS = 60;

/** Strop personalizacnich dat na zpravu. Pri prekroceni vznika radek rovnou jako skipped. */
export const RENDER_DATA_MAX_BYTES = 8 * 1024;

/** Uklid outboxu pri zruseni bezi po davkach, aby transakce nebyla dlouha. */
export const CANCEL_CLEANUP_BATCH_SIZE = 10_000;

/** Uzivatel nikdy neceka na nahled publika dele nez 5 sekund. */
export const AUDIENCE_PREVIEW_TIMEOUT_MS = 5_000;
export const AUDIENCE_PREVIEW_SAMPLE_SIZE = 20;

/**
 * Vlastni strop pro zachranny EXPLAIN po vyprseni stropu presneho poctu.
 *
 * DOPLNEK PROTI PLÁNU, vynuceny nalezem z databazoveho testu. Plán pouzival pro odhad
 * TYZ timeout jako pro presny pocet. Kdyz je nastaveny nizko, vyprsi i EXPLAIN
 * a uzivatel misto slibeneho priblizneho cisla dostane chybu 57014. Overeno spustenim
 * se stropem 1 ms. EXPLAIN bez ANALYZE jen planuje, takze vlastni strop je levny.
 */
export const AUDIENCE_ESTIMATE_TIMEOUT_MS = 1_000;

/**
 * Ochrana proti segmentu, ktery se zkompiluje do draheho SQL (cast 4a, 7.3, bod 4).
 * Po treti davce, ktera spadne na timeout, jde kampan do failed.
 */
export const MATERIALIZE_STATEMENT_TIMEOUT_MS = 30_000;
export const MATERIALIZE_TIMEOUT_STRIKES = 3;

/** Watchdog uzavira kampan az po 10 s bez zmeny citacu, kvuli zavodu s dobehem davky. */
export const WATCHDOG_QUIET_SECONDS = 10;

/**
 * Kdy uz je kampan se zbyvajicimi zpravami zaseknuta (`outbox.stall_watch`).
 *
 * Prah je 120 sekund, tedy vyrazne vic nez `WATCHDOG_QUIET_SECONDS`, a je to
 * schvalne. Hlidac kampani resi zavod s dobehem davky, kdezto tenhle prah odpovida
 * na otazku "sahl na tuhle kampan vubec nekdo?". Sender bere davku kazdou sekundu
 * (SENDER_POLL_INTERVAL_MS) a claim mu vyprsi za 300 sekund
 * (SENDER_CLAIM_TTL_SECONDS), takze dve minuty ticha uz nejde vysvetlit beznym
 * provozem ani jednou pomalejsi davkou. Niz by hlaseni chodilo pri kazde vetsi
 * kampani, vys by se ztratila prvni hodina vypadku.
 *
 * Je to konstanta, ne promenna prostredi: je to prah HLASENI, ne provozni
 * parametr, a nic podle nej nerozhoduje o osudu zpravy.
 */
export const STALL_WATCH_QUIET_SECONDS = 120;

/** Testovaci odeslani: 1 az 5 adres. */
export const TEST_SEND_MAX_RECIPIENTS = 5;

/** Tolerance u confirm_recipient_count pri odeslani, cast 4a, 4.1.1. */
export const AUDIENCE_CONFIRM_TOLERANCE = 0.01;

/** Rate limit rucni kontroly domeny: jednou za 30 s na domenu. */
export const DOMAIN_CHECK_MIN_INTERVAL_SECONDS = 30;

/** Delegacni odkaz na DNS zaznamy plati 14 dni (cast 6, 8.2.5). */
export const DELEGATION_TTL_DAYS = 14;

/** Zkusebni rezim: nejvyse 10 overenych adres a 50 zprav za 24 hodin (cast 6, 8.2.8). */
export const TRIAL_MAX_VERIFIED_ADDRESSES = 10;
export const TRIAL_MAX_MESSAGES_PER_DAY = 50;

/**
 * Platnost potvrzovaciho odkazu na overovanou adresu.
 *
 * DOPLNEK NAD PLÁN: plán zkusebni rezim popisuje, ale zivotnost odkazu nikde nerika.
 * Tyden je kompromis mezi „prisel jsem k tomu az v pondeli" a tim, ze odkaz je
 * bezstavovy (rozhodnuti D15 zakazuje vlastni tabulku), takze ho nejde odvolat jinak
 * nez vyprsenim nebo rotaci klice.
 */
export const TRIAL_VERIFY_TTL_DAYS = 7;
