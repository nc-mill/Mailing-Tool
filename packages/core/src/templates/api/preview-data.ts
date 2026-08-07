import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { sampleFor as sampleForLanguage, sampleRenderData } from '@mlain/emails/preview-data';
import type { SampleRenderData } from '@mlain/emails/preview-data';
import { readGreetingSettings } from '../../contacts/settings';
import { postalAddressOf } from '../../identity/workspace-service';
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
 * Kořen `workspace` ze SKUTEČNÉHO projektu, ne z ukázky.
 *
 * TOHLE JE MÍSTO, KDE SE NÁHLED ROZCHÁZEL S ODESLÁNÍM. `sampleRenderData`
 * vrací „Demo s.r.o., Na Příkopě 1", takže náhled i zkušební odeslání ukazovaly
 * vyplněnou poštovní adresu i projektu, který žádnou nemá, a ostrá kampaň
 * odešla s prázdným místem v patičce. Rozdíl přitom šel poznat jedině tím, že
 * se člověk podíval do doručené pošty.
 *
 * Ukázkové hodnoty tady tedy nemají co dělat: název projektu i jeho poštovní
 * adresu aplikace ZNÁ. Prázdná adresa zůstane prázdná, protože přesně tak
 * dopadne odeslaný e-mail.
 *
 * Kořen `campaign` se takhle doplnit nedá a je to v pořádku: náhled šablony
 * žádnou kampaň nemá. Při odeslání ho dodá odesílač z hlavičky kampaně.
 */
export async function workspacePreviewRoot(
  tx: Tx,
  ctx: WorkspaceContext,
): Promise<{ name: string; sender_address: string }> {
  const [row] = await tx
    .select({ name: schema.workspaces.name, settings: schema.workspaces.settings })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, ctx.workspaceId))
    .limit(1);
  if (!row) return { name: '', sender_address: '' };
  return { name: row.name, sender_address: postalAddressOf(row.settings) };
}

/**
 * Ukázková data se skutečným kořenem `workspace` a se SKUTEČNÝM NASTAVENÍM
 * OSLOVENÍ.
 *
 * Nastavení je tu ze stejného důvodu jako poštovní adresa o pár řádků výš:
 * náhled má ukazovat, co odejde. Vzorek se do 7. 8. 2026 skládal s výchozím
 * vykáním, takže projekt přepnutý na tykání viděl v náhledu „Dobrý den, Jano"
 * u e-mailu, který odejde s „Ahoj Jano". Rozdíl přitom šel poznat jedině tím,
 * že se člověk podíval do doručené pošty.
 */
export async function samplePreviewData(
  tx: Tx,
  ctx: WorkspaceContext,
  language: 'cs' | 'en',
  variant: 'default' | 'no_name',
): Promise<SampleRenderData> {
  const [greeting, workspace] = await Promise.all([
    readGreetingSettings(tx, ctx),
    workspacePreviewRoot(tx, ctx),
  ]);
  const base = sampleForLanguage(language, variant, greeting);
  return { ...base, workspace };
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
    // Skutečný projekt, ne ukázka. Tahle data si do `messages.render_data`
    // ukládá i transakční odeslání a e-maily seznamu, takže by ukázková adresa
    // „Demo s.r.o., Na Příkopě 1" odešla SKUTEČNÉMU příjemci.
    workspace: await workspacePreviewRoot(tx, ctx),
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
