import { baseSectionSpecSchema } from '@mlain/emails/base';
import { z } from 'zod';

/**
 * Schéma, které dostane model. Staví na `baseSectionSpecSchema` z P08, takže
 * změna blokového modelu se sem propíše sama a nevznikne druhý zdroj pravdy.
 *
 * Rozhodnutí D8: model neplní `Document`, ale `BaseSectionSpec[]`. Dokument
 * z toho staví generátor `buildBaseTemplate`, takže model nerozhoduje o
 * barvách, odsazení ani o vnořené struktuře bloků.
 */
export const composeSchema = z.object({
  meta: z.object({
    name: z.string().min(1).max(120),
    previewText: z.string().min(1).max(150),
  }),
  sections: z.array(baseSectionSpecSchema).min(1).max(12),
  paletteHint: z.enum(['brand', 'neutral']).default('brand'),
});

export type ComposeOutput = z.infer<typeof composeSchema>;

/**
 * Seznam validačních chyb v podobě, kterou lze poslat modelu při opravném
 * pokusu. Obecné „nevalidní odpověď" model neopraví; konkrétní cesta a důvod ano.
 */
export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(kořen)';
      return `- ${path}: ${issue.message}`;
    })
    .join('\n');
}
