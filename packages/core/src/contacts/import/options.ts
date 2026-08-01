import { z } from 'zod';
import { invalidImport } from './errors';

export const ImportOptionsSchema = z
  .object({
    on_conflict: z.enum(['skip', 'update', 'overwrite']).default('update'),
    duplicate_in_file: z.enum(['last', 'first', 'error']).default('last'),
    name_order: z.enum(['auto', 'first_last', 'last_first']).default('auto'),
    split_full_name: z.boolean().default(true),
    trim_whitespace: z.boolean().default(true),
    empty_means_null: z.boolean().default(true),
    number_format: z.enum(['auto', 'cs', 'en']).default('auto'),
    date_format: z.enum(['auto', 'cs', 'en']).default('auto'),
    list_ids: z.array(z.uuid()).default([]),
    subscription_status: z.enum(['pending', 'confirmed']).default('pending'),
    send_confirmation_emails: z.boolean().default(false),
    tag_ids: z.array(z.uuid()).default([]),
    consent: z
      .object({
        purpose: z.literal('email_marketing'),
        legal_basis: z.enum(['consent', 'legitimate_interest', 'soft_opt_in']),
        source: z.string().min(1).max(120),
        consent_text: z.string().max(4000).optional(),
        declaration: z.boolean(),
      })
      .strict()
      .nullable()
      .default(null),
    skip_suppressed: z.boolean().default(true),
    dry_run: z.boolean().default(false),
  })
  .strict();

export type ImportOptions = z.infer<typeof ImportOptionsSchema>;

export function defaultOptions(): ImportOptions {
  return ImportOptionsSchema.parse({});
}

export type OptionsContext = {
  doubleOptInListIds: string[];
  estimatedRows?: number;
  inMemoryDedupMaxRows?: number;
};

export function assertOptionsConsistent(
  options: ImportOptions,
  ctx: OptionsContext,
): { alwaysSkippedReasons: string[] } {
  const touchesDouble = options.list_ids.some((id) => ctx.doubleOptInListIds.includes(id));
  if (
    options.subscription_status === 'confirmed' &&
    touchesDouble &&
    options.consent?.declaration !== true
  ) {
    invalidImport(
      'options',
      'declaration_required',
      'Confirmed status on a double opt-in list needs an explicit declaration.',
      { listIds: options.list_ids },
    );
  }
  if (
    options.duplicate_in_file === 'error' &&
    ctx.estimatedRows !== undefined &&
    ctx.inMemoryDedupMaxRows !== undefined &&
    ctx.estimatedRows > ctx.inMemoryDedupMaxRows
  ) {
    // Bez paměťové mapy nejde druhý výskyt spolehlivě odlišit od aktualizace
    // existujícího kontaktu, takže volba není dostupná a UI ji zašedne.
    invalidImport(
      'options',
      'duplicate_error_unavailable',
      'The file is too large for in-memory duplicate detection.',
      { rows: ctx.estimatedRows, limit: ctx.inMemoryDedupMaxRows },
    );
  }
  // Stížnost a výmaz podle čl. 17 se přeskakují vždy, ani vlastník to nevypne.
  return { alwaysSkippedReasons: ['complaint', 'gdpr_erasure'] };
}
