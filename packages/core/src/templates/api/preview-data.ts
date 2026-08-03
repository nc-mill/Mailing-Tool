import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { sampleRenderData, type SampleRenderData } from '@mlain/emails/preview-data';
import { wsEq } from '../../identity/scope';
import type { WorkspaceContext } from '../../identity/types';
import type { Tx } from '../../tx';

export type PreviewDataInput =
  { type: 'sample'; variant: 'default' | 'no_name' } | { type: 'contact'; contact_id: string };

/**
 * Osobní údaje, které varianta `no_name` vyprazdňuje. E-mail mezi nimi
 * SCHVÁLNĚ není: kontakt bez adresy neexistuje a náhled bez ní by vypadal
 * rozbitě z jiného důvodu, než se testuje.
 */
const PERSONAL_FIELDS = [
  'first_name',
  'last_name',
  'middle_name',
  'title_prefix',
  'title_suffix',
  'first_name_vocative',
  'last_name_vocative',
  'greeting',
] as const;

/**
 * Vzorová data pro náhled. Varianta `no_name` je požadavek P08-R2 z kapitoly
 * 9.2 plánu P12 a kritérium 55 části 6: uživatel musí vidět, jak e-mail vypadá
 * pro kontakt, u kterého žádné osobní údaje nejsou. Nahradit to výběrem
 * skutečného kontaktu nejde, protože kontakt bez jména v projektu být nemusí.
 */
export function sampleFor(language: 'cs' | 'en', variant: 'default' | 'no_name'): SampleRenderData {
  const data = sampleRenderData(language);
  if (variant === 'default') return data;
  const contact = { ...data.contact };
  for (const field of PERSONAL_FIELDS) contact[field] = '';
  // Vlastní atributy se vyprazdňují taky: podmíněný blok nad `contact.attr.city`
  // se v téhle variantě musí chovat stejně jako u kontaktu bez vyplněných polí.
  contact.attr = Object.fromEntries(
    Object.keys((data.contact.attr as Record<string, unknown>) ?? {}).map((key) => [key, '']),
  );
  return { ...data, contact };
}

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
