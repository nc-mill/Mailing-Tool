/**
 * Exit kódy CLI. Prvních pět předepisuje specifikace, poslední dva doplnil
 * plán P01 (rozhodnutí D9).
 */
export const EXIT_OK = 0;
/** Migrace spadla. Runner vypíše číslo migrace a příkaz (část 1, 3.13). */
export const EXIT_MIGRATION_FAILED = 3;
/** Přeskočená major verze (část 1, 3.13). */
export const EXIT_VERSION_SKIP = 4;
/** schema_version_ahead, databáze je novější než image (část 1, 3.13). */
export const EXIT_SCHEMA_AHEAD = 5;
/** EX_USAGE: neznámý podpříkaz nebo špatné argumenty. */
export const EXIT_USAGE = 64;
/** EX_UNAVAILABLE: příkaz je deklarovaný, ale v tomhle buildu neimplementovaný. */
export const EXIT_UNAVAILABLE = 69;
/** EX_TEMPFAIL: timeout na advisory lock migrací (část 1, 3.13). */
export const EXIT_TEMPFAIL = 75;
/** EX_CONFIG: konfigurace není platná (část 1, 4.9). */
export const EXIT_CONFIG = 78;
