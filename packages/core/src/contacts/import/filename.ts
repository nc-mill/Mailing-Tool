/**
 * Název nahraného souboru z hlavičky `X-Filename`.
 *
 * Hlavičky HTTP unesou jen Latin-1, takže „kontakty-červen.csv" se v nich
 * nedá poslat tak, jak je: prohlížeč na tom spadne ještě před odesláním
 * (`String contains non ISO-8859-1 code point`) a nahrávání se zastaví, aniž
 * by se čehokoli dotklo. Klient proto jméno kóduje procentově nad UTF-8
 * (`encodeFilename` v `apps/web/src/features/import/use-import-upload.ts`)
 * a tahle funkce ho vrací do původní podoby.
 *
 * Bez dekódování by v `imports.filename` skončilo „kontakty-%C4%8Derven.csv"
 * a přesně takhle by se to ukázalo v seznamu importů i v hlášce „Tenhle soubor
 * jste už nahráli".
 */
export function decodeUploadFilename(raw: string | null | undefined): string {
  if (raw === null || raw === undefined || raw === '') return 'import.csv';
  try {
    return decodeURIComponent(raw);
  } catch {
    // Osamocené procento („sleva 50%.csv") není důvod odmítnout nahrání.
    // Takové jméno prostě zakódované nebylo a bere se, jak přišlo.
    return raw;
  }
}
