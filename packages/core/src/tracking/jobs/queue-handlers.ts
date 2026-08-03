import { perJob } from '../../queues';
import { handleIdentityMerge, type IdentityMergeJobData } from './identity-merge';

/**
 * Vstupní bod, který hledá codegen workeru (P01, rozhodnutí D4).
 *
 * Jméno souboru i jméno exportu `handlers` jsou ZÁVAZNÁ: codegen globuje
 * `packages/core/src/<domena>/jobs/queue-handlers.ts`. Pod jiným jménem se
 * soubor přeloží, testy projdou a fronta se zaregistruje BEZ OBSLUHY: úloha se
 * zařadí, nikdo si ji nevyzvedne a nikde to nespadne.
 *
 * Klíč `./tracking/jobs` v mapě `exports` balíčku už existoval, jenže mířil na
 * tenhle soubor, který do teď nebyl. Import z workeru by se nerozřešil až při
 * stavbě produkční image, tedy daleko od příčiny.
 */
export const handlers = {
  /**
   * Navázání anonymní stopy na kontakt.
   *
   * Do téhle chvíle nebyla obsluha ani logika. Návštěvník se prokázal e-mailem
   * (klik v kampani, odeslaný formulář, přihlášení), úloha se zařadila do
   * fronty, ze které nikdo nečetl, a jeho dosavadní web události zůstaly
   * navždy viset na `anonymous_id`. V časové ose kontaktu tedy chyběla celá
   * část historie a nikde se to neohlásilo.
   *
   * `perJob` je POVINNÝ obal: pg-boss volá obsluhu s DÁVKOU úloh, kdežto
   * `handleIdentityMerge` bere jednu.
   */
  'identity.merge': perJob<IdentityMergeJobData>(async (job) => {
    await handleIdentityMerge(job);
  }),
} as const;
