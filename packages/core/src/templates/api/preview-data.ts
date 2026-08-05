import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { sampleRenderData, type SampleRenderData } from '@mlain/emails/preview-data';
import { wsEq } from '../../identity/scope';
import type { WorkspaceContext } from '../../identity/types';
import type { Tx } from '../../tx';

export type PreviewDataInput =
  { type: 'sample'; variant: 'default' | 'no_name' } | { type: 'contact'; contact_id: string };

/**
 * `sampleFor` se přestěhovala do `@mlain/emails/preview-data` a odsud se jen
 * reexportuje, aby volající v `templates.routes.ts` zůstali beze změny.
 *
 * Důvod stěhování: tentýž výpočet potřebuje i editor v prohlížeči, když volba
 * „Zobrazit jako" dosazuje hodnoty přímo do plátna. `@mlain/core` sahá na
 * databázi a do prohlížeče nesmí, takže by jinak vznikla druhá definice toho,
 * co znamená „kontakt bez jména".
 */
export { sampleFor } from '@mlain/emails/preview-data';

/**
 * Data skutečného kontaktu pro náhled. Systémové adresy zůstávají ze vzorku:
 * odhlašovací odkaz se podepisuje až při odeslání a kvůli náhledu se pro cizí
 * kontakt nepodepisuje (viz komentář u `sampleRenderData`).
 */
export async function contactPreviewData(
  tx: Tx,
  ctx: WorkspaceContext,
  language: 'cs' | 'en',
  contactId: string,
): Promise<SampleRenderData | null> {
  const [row] = await tx
    .select()
    .from(schema.contacts)
    .where(
      and(
        eq(schema.contacts.id, contactId),
        wsEq(ctx, schema.contacts),
        isNull(schema.contacts.deletedAt),
      ),
    );
  if (!row) return null;

  const base = sampleRenderData(language);
  return {
    ...base,
    contact: {
      email: row.email,
      first_name: row.firstName ?? '',
      last_name: row.lastName ?? '',
      middle_name: row.middleName ?? '',
      title_prefix: row.titlePrefix ?? '',
      title_suffix: row.titleSuffix ?? '',
      gender: row.gender,
      first_name_vocative: row.firstNameVocative ?? '',
      last_name_vocative: row.lastNameVocative ?? '',
      greeting: row.greeting,
      locale: row.locale,
      created_at: row.createdAt.toISOString(),
      attr: (row.attributes ?? {}) as Record<string, unknown>,
    },
    _context: { timezone: row.timezone ?? base._context.timezone, locale: row.locale },
  };
}
