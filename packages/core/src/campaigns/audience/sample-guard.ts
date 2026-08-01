/**
 * Ochrana proti tomu, aby ukazkovy kontakt dostal ostrou kampan.
 *
 * Stoji na DVOU nezavislych mechanismech a obe jsou nutne (rozhodnuti A1 planu P16):
 *  - **manifest** ukazkove sady je autoritativni pro jeji rozsah a prezije to, ze
 *    uzivatel kontakt upravi a znacku smaze,
 *  - **znacka v `source_ref`** je zachytna sit pro kontakty mimo manifest, tedy pro
 *    starsi pokoleni sady a pro obnovu ze zalohy.
 *
 * Overeno spustenim: na 200 000 kontaktech s 50 ukazkovymi, kde deset melo prepsany
 * `source_ref`, propustil filtr jen podle znacky deset kontaktu do publika.
 *
 * ODCHYLKA OD PLÁNU: pozadavek R-P01.8 chtel `DEMO_SOURCE_REF` a `parseDemoManifest`
 * importovat z `@mlain/core/demo`, tedy od P16. Ta domena v repozitari zatim NENI
 * (`packages/core/src/demo` neexistuje). Vzor je proto zatim tady a je oznaceny, aby
 * ho slo pri prichodu P16 nahradit importem, ne aby se konvence opsala natrvalo.
 */
export const SAMPLE_SOURCE_REF_PREFIX = 'demo-data:';

/** Vzor pro `NOT LIKE` v kandidatskem dotazu materializace. */
export const SAMPLE_SOURCE_REF_PATTERN = `${SAMPLE_SOURCE_REF_PREFIX}%`;

export function isSampleSourceRef(sourceRef: string | null | undefined): boolean {
  return (sourceRef ?? '').startsWith(SAMPLE_SOURCE_REF_PREFIX);
}
