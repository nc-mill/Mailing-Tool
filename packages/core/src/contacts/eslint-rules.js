/**
 * Pravidla `no-restricted-syntax` pro `packages/core/src/contacts/**`.
 *
 * PROČ TENHLE SOUBOR LEŽÍ TADY A NE V KONFIGURACI ESLINTU. Plán (úkol 13, krok 6) je chce
 * v konfiguraci pro tuhle doménu. Konfiguraci ESLintu vlastní P01 a je to jeden sdílený
 * soubor (`packages/config/eslint/index.js`), do kterého souběžně sahá jiný agent. Blok
 * je proto napsaný tady, hotový k zapojení jedním řádkem, a je zapsaný jako požadavek
 * na P01.
 *
 * Do doby, než ho P01 zapojí, NENÍ tahle ochrana bez zubů: totéž chování hlídá
 * `test/keyring-guard.test.ts`, který běží v každé sadě a ptá se na tvar zdrojáku,
 * a `test/fingerprint.test.ts`, který se ptá na chování při padesáti pokoleních.
 *
 * Zapojení v `packages/config/eslint/index.js`:
 *
 *   import { contactsRestrictedSyntax } from '../../core/src/contacts/eslint-rules.js';
 *   // a do pole bloků:
 *   {
 *     name: 'mlain/contacts-keyring',
 *     files: ['packages/core/src/contacts/**\/*.ts'],
 *     rules: { 'no-restricted-syntax': ['error', ...contactsRestrictedSyntax] },
 *   },
 */
export const contactsRestrictedSyntax = [
  {
    // Keyring je Map z kontraktu P02, takže se nezkracuje polem, ale průchodem přes
    // klíče. Pravidlo proto hlídá právě tenhle tvar: Array.from(keyring.keys()).slice(...)
    // a [...keyring.values()].slice(...), tedy oba způsoby, jak by šlo pokolení oříznout.
    selector:
      'CallExpression[callee.property.name=/^(slice|splice)$/]' +
      "[callee.object.callee.property.name='values'], " +
      'CallExpression[callee.property.name=/^(slice|splice)$/]' +
      "[callee.object.callee.property.name='keys']",
    message:
      'Keyring se nikdy nezkracuje. Otisk suppression záznamu nejde přepočítat, takže ' +
      'vynechané pokolení znamená, že se vymazaný člověk vrátí prvním importem a nic o tom ' +
      'nebude vědět. Viz kapitola 3.10 části 1 a rozhodnutí o zrušení stropu.',
  },
  {
    selector:
      "CallExpression[callee.name='revokePendingMessages'] > " +
      "ObjectExpression:not(:has(Property[key.name='listId']))",
    message:
      'revokePendingMessages musí vždy dostat listId, i když je null. Parametr je v části 4a ' +
      'volitelný, takže jeho vynechání projde typovou kontrolou, ale zruší veškerou čekající ' +
      'poštu kontaktu místo zvoleného rozsahu. Tichá ztráta pošty, viz kritérium 79.',
  },
  {
    selector: "Identifier[name='SUPPRESSION_HASH_KEY']",
    message:
      'Proměnná SUPPRESSION_HASH_KEY neexistuje a nesmí vzniknout. Klíč pro otisky se odvozuje ' +
      'ze SECRET_KEY přes HKDF pod purpose mailer/v1/suppression-fingerprint. Nerotovatelný ' +
      'klíč by po incidentu znamenal navždy kompromitovanou část systému.',
  },
];
