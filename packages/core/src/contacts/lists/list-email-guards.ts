import { and, eq, or } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import type { Document } from '@mlain/emails/document/types';
import { validationFailed } from '../../errors/api-error';
import { wsEq } from '../../identity/scope';
import type { WorkspaceContext } from '../../identity/types';
import type { Tx } from '../../tx';
import type { FieldCatalog } from '../fields/catalog';
import { documentHasConfirmLink, documentUsesUnsubscribeUrl } from './confirm-link-guard';

/**
 * Závory e-mailů seznamu při UKLÁDÁNÍ ŠABLONY, která už je někde připojená.
 *
 * PROČ TO NESTAČILO HLÍDAT PŘI PŘIPOJENÍ. Připojení šablony k seznamu je jeden
 * okamžik, úprava jejího obsahu jich je libovolně mnoho potom. Kdo si z
 * potvrzovacího e-mailu smaže tlačítko, projde první závorou dávno a druhou
 * (odeslání) se dozví až tím, že se lidem nedaří potvrdit přihlášení. Tahle
 * závora to chytí ve chvíli, kdy to člověk dělá, tedy jediné, kdy s tím ještě
 * něco zmůže.
 *
 * ROLE JE VLASTNOST VAZBY, NE ŠABLONY. Tentýž dokument je jako uvítací e-mail
 * v pořádku a jako potvrzovací ne. Pravidlo se proto neptá, co šablona je, ale
 * kde je připojená, a nepřipojená šablona neprojde žádnou kontrolou navíc.
 *
 * BYDLÍ V DOMÉNĚ KONTAKTŮ, přestože ji volá doména šablon. Vlastní ji seznam:
 * jsou to jeho sloupce, jeho rozhodnutí a jeho význam. Doména šablon o rolích
 * `confirmation`, `welcome` a `goodbye` nic neví a vědět nemá, volá jedinou
 * funkci a nezná ani jeden z těch názvů.
 */
export type ListEmailRoles = {
  /** Šablona je někde připojená jako potvrzovací e-mail. */
  confirmation: boolean;
  /** Šablona je někde připojená jako uvítací nebo rozloučovací e-mail. */
  welcomeOrGoodbye: boolean;
};

/**
 * V jakých rolích je šablona připojená k seznamům.
 *
 * Jedna šablona smí být připojená na víc seznamech i ve víc rolích naráz, takže
 * se vrací obojí, ne jen ta první nalezená.
 */
export async function listEmailRolesOf(
  tx: Tx,
  ctx: WorkspaceContext,
  templateId: string,
): Promise<ListEmailRoles> {
  const rows = await tx
    .select({
      confirmationTemplateId: schema.lists.confirmationTemplateId,
      welcomeTemplateId: schema.lists.welcomeTemplateId,
      goodbyeTemplateId: schema.lists.goodbyeTemplateId,
    })
    .from(schema.lists)
    .where(
      and(
        wsEq(ctx, schema.lists),
        or(
          eq(schema.lists.confirmationTemplateId, templateId),
          eq(schema.lists.welcomeTemplateId, templateId),
          eq(schema.lists.goodbyeTemplateId, templateId),
        ),
      ),
    );

  return {
    confirmation: rows.some((row) => row.confirmationTemplateId === templateId),
    welcomeOrGoodbye: rows.some(
      (row) => row.welcomeTemplateId === templateId || row.goodbyeTemplateId === templateId,
    ),
  };
}

/**
 * Je šablona připojená k seznamu jako některý z jeho tří e-mailů?
 *
 * ČTE TO PŘEDODESÍLACÍ KONTROLA, aby po autorovi nechtěla odhlašovací odkaz.
 * Bez toho si dvě pravidla produktu odporovala a člověk se z toho nemohl
 * dostat: kontrola říkala „doplň odkaz na odhlášení", a jakmile ho doplnil,
 * závora na uložení řekla „odhlašovací odkaz sem nepatří, vede do prázdna".
 */
export async function isListEmailTemplate(
  tx: Tx,
  ctx: WorkspaceContext,
  templateId: string,
): Promise<boolean> {
  const roles = await listEmailRolesOf(tx, ctx, templateId);
  return roles.confirmation || roles.welcomeOrGoodbye;
}

export async function assertListEmailDocument(
  tx: Tx,
  ctx: WorkspaceContext,
  templateId: string,
  document: Document,
  fields: FieldCatalog,
): Promise<void> {
  const { confirmation: asConfirmation, welcomeOrGoodbye: asWelcomeOrGoodbye } =
    await listEmailRolesOf(tx, ctx, templateId);
  if (!asConfirmation && !asWelcomeOrGoodbye) return;

  if (asConfirmation && !documentHasConfirmLink(document, fields)) {
    throw validationFailed([
      {
        path: 'design',
        code: 'confirmation_template_missing_confirm_link',
        message:
          'Tenhle e-mail je připojený jako potvrzovací, takže musí obsahovat odkaz na potvrzení, tedy {{ data.confirm_url }} v tlačítku nebo v odkazu. Bez něj se přihlášení nedá dokončit.',
      },
    ]);
  }

  if (asWelcomeOrGoodbye && documentUsesUnsubscribeUrl(document, fields)) {
    throw validationFailed([
      {
        path: 'design',
        code: 'subscription_email_has_unsubscribe_link',
        message:
          'Tenhle e-mail je připojený k seznamu, takže odchází jako transakční zpráva a odhlašovací odkaz v něm vede do prázdna. Vypněte odhlášení v patičce, případně odkaz na {{ unsubscribe_url }} odeberte z textu.',
      },
    ]);
  }
}
