import { customType } from 'drizzle-orm/pg-core';

/** citext: e-mailové adresy. Porovnání je necitlivé na velikost písmen v databázi,
 *  ne v aplikaci, protože aplikací je víc a jedna z nich je v Go. */
export const citext = customType<{ data: string; driverData: string }>({
  dataType: () => 'citext',
});

/** bytea: hashe tokenů, otisky adres, CSRF sekrety. Nikdy text: hex zdvojnásobí
 *  velikost indexu a svádí k porovnávání řetězců místo bajtů. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/**
 * bytea[]: contacts.email_fingerprints nese otisk pod každým pokolením klíče.
 *
 * `driverData` je `Buffer[]`, NE `string`, a je to ověřené spuštěním proti
 * ovladači `pg` 8.22, ne odvozené: `SELECT $1::bytea[]` vrátí
 * `[ <Buffer 9f 86 …>, <Buffer 0d 1b …> ]` a stejné pole i přijme jako
 * parametr. Konverzní funkce `toDriver` a `fromDriver` proto tenhle typ
 * nepotřebuje a **nesmí je mít**: kdo je dopíše podle vzoru pro `bytea`,
 * rozbije jimi hodnotu.
 *
 * Špatně deklarovaný `driverData: string` byl přesně ta pobídka konverzi
 * dopsat. Tichá ztráta otisků je přitom podle specifikace nejhorší scénář,
 * jaký suppression má: otisk se přestane shodovat, kontrola projde a vymazaný
 * člověk dostane e-mail, aniž by cokoli selhalo. Průchod přes skutečný ovladač
 * proto hlídá test v `core-tables.test.ts`; tvar `driverData` je vlastnost
 * ovladače, ne tohohle souboru, a testem v paměti se dokázat nedá.
 */
export const byteaArray = customType<{ data: Buffer[]; driverData: Buffer[] }>({
  dataType: () => 'bytea[]',
});

export const inet = customType<{ data: string; driverData: string }>({
  dataType: () => 'inet',
});

export const inetArray = customType<{ data: string[]; driverData: string }>({
  dataType: () => 'inet[]',
});

export const cidr = customType<{ data: string; driverData: string }>({
  dataType: () => 'cidr',
});
