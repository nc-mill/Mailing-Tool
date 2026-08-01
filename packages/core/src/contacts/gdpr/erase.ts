import { sql } from 'drizzle-orm';
import { keyringFromEnv } from '@mlain/contracts/keyring';
import { ApiError } from '../../errors/api-error';
import type { WorkspaceContext } from '../../identity/types';
import { withWorkspace } from '../../tx';
import { writeAudit } from '../audit';
import { revokePendingMessages } from '../campaigns-port';
import { erasedEmail } from '../constants';
import { computeCurrentFingerprint } from '../fingerprint';
import { enqueue } from '../jobs/enqueue';
import { addSuppression } from '../repo/suppressions';
import { eraseConsentsUnderGdprRole } from './consents-role';

/**
 * Anonymizace kontaktu podle článku 17. Výchozí režim výmazu; tvrdé smazání je
 * vyhrazené vlastníkovi projektu.
 *
 * POZOR NA locale. Tabulka ve 4.14.4 části 2 u něj říká "NULL nebo výchozí", ale sloupec
 * je text NOT NULL DEFAULT 'cs' s omezením ck_contacts__locale nad regulárním výrazem.
 * Zápis NULL skončí chybou 23502, zápis prázdného řetězce chybou 23514, a obojí shodí
 * celou transakci. Výmaz by tedy neselhal někdy, ale POKAŽDÉ.
 *
 * Anonymizace proto nastavuje locale na jazyk projektu. Ostatní sloupce dotčené
 * anonymizací jsou ověřené proti svým omezením:
 *   status 'deleted'      je v ck_contacts__status,
 *   gender 'unknown'      je v ck_contacts__gender,
 *   placeholder adresy    má 59 znaků a vejde se do ck_contacts__email_len (3 až 254),
 *   attributes '{}'       projde oběma omezeními nad attributes,
 *   timezone a source_ref jsou nullable, takže NULL projde.
 */
export async function anonymizeContact(
  ctx: WorkspaceContext,
  contactId: string,
): Promise<{ alreadyAnonymized: boolean }> {
  const keyring = keyringFromEnv();

  return withWorkspace(ctx, async (tx) => {
    const found = await tx.execute<{
      email: string;
      anonymized_at: Date | string | null;
      workspace_locale: string;
    }>(sql`
      SELECT c.email::text AS email, c.anonymized_at, w.locale AS workspace_locale
        FROM contacts c
        JOIN workspaces w ON w.id = c.workspace_id
       WHERE c.id = ${contactId}::uuid AND c.workspace_id = ${ctx.workspaceId}::uuid
       FOR UPDATE OF c
    `);
    if (found.rows.length === 0) throw new ApiError('not_found');

    const row = found.rows[0]!;
    // Idempotence: druhý běh po pádu workeru nesmí nic zkazit ani založit druhý
    // suppression řádek.
    if (row.anonymized_at !== null) return { alreadyAnonymized: true };

    const originalEmail = row.email;
    const { fingerprint } = computeCurrentFingerprint(keyring, originalEmail);

    // 1. Suppression se zakládá JAKO PRVNÍ, dokud plaintext ještě máme.
    //    Je to jediná stopa, která po výmazu zbývá, a jediná ochrana proti tomu,
    //    aby příští import stejného souboru smazaného člověka nevzkřísil.
    //    Bez ní by výmaz vydržel do dalšího importu, což je horší porušení než otisk.
    await addSuppression(ctx, {
      email: originalEmail,
      reason: 'gdpr_erasure',
      source: 'gdpr',
      sourceRef: contactId,
      tx,
    });

    // 2. Anonymizace samotného kontaktu.
    await tx.execute(sql`
      UPDATE contacts
         SET email = ${erasedEmail(contactId)}::citext,
             -- Prázdné pole, ne otisk původní adresy: kontakt po anonymizaci nesmí
             -- nést druhý záznam téhož údaje. Ochranu nese suppression řádek.
             email_fingerprints = '{}'::bytea[],
             first_name = NULL, last_name = NULL, middle_name = NULL,
             title_prefix = NULL, title_suffix = NULL,
             first_name_key = NULL, last_name_key = NULL, search_key = NULL,
             first_name_vocative = NULL, last_name_vocative = NULL,
             vocative_confidence = 'none', vocative_locked = false,
             greeting = '', greeting_neutral = '',
             gender = 'unknown', gender_source = 'none',
             attributes = '{}'::jsonb,
             -- locale MUSÍ zůstat platnou hodnotou, viz komentář u funkce.
             locale = ${row.workspace_locale},
             timezone = NULL, source_ref = NULL,
             status = 'deleted', deleted_at = now(), anonymized_at = now(),
             updated_at = now()
       WHERE id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
    `);

    // 3. Navázané záznamy s osobními údaji, na které STAČÍ aplikační role.
    await tx.execute(sql`DELETE FROM contact_consent_state WHERE contact_id = ${contactId}::uuid`);
    await tx.execute(sql`DELETE FROM list_subscriptions WHERE contact_id = ${contactId}::uuid`);
    await tx.execute(sql`DELETE FROM contact_tags WHERE contact_id = ${contactId}::uuid`);
    await tx.execute(sql`DELETE FROM segment_members WHERE contact_id = ${contactId}::uuid`);
    await tx.execute(
      sql`DELETE FROM subscription_confirmations WHERE contact_id = ${contactId}::uuid`,
    );

    await tx.execute(sql`
      UPDATE form_submissions
         SET payload = '{}'::jsonb, ip = NULL, user_agent = NULL, page_url = NULL
       WHERE contact_id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
    `);
    await tx.execute(sql`
      UPDATE import_errors SET raw_line = '[erased]'
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND raw_line LIKE ${`%${originalEmail}%`}
    `);

    // 4. Zrušení čekajících zpráv. Důvod contact_anonymized se vědomě neslučuje
    //    s contact_status_changed: článek 17 a článek 18 jsou dva různé právní důvody
    //    s různou vratností a report kampaně je musí umět odlišit.
    await revokePendingMessages({
      workspaceId: ctx.workspaceId,
      contactIds: [contactId],
      listId: null,
      reason: 'contact_anonymized',
    });

    // 5. Odstřižení vazeb v cizích doménách běží asynchronně.
    await enqueue(tx, 'gdpr.sever_links', { workspaceId: ctx.workspaceId, contactId });

    await writeAudit(tx, ctx, {
      action: 'contact.anonymized',
      targetType: 'contact',
      targetId: contactId,
      // E-mail se do metadat NIKDY neukládá, jen otisk.
      metadata: { fingerprint: fingerprint.toString('hex') },
    });

    // 6. Souhlasy jako POSLEDNÍ krok, a pod jinou rolí. Podrobnosti a důvod, proč to
    //    při chybějící roli selže hlasitě, jsou v `gdpr/consents-role.ts`.
    //    Pořadí je záměrné: kdyby role nebyla dostupná, zruší se celá transakce
    //    a po výmazu nezůstane polovina anonymizovaného kontaktu.
    await eraseConsentsUnderGdprRole(ctx, contactId);

    return { alreadyAnonymized: false };
  });
}

/**
 * Fyzické smazání. Dostupné jen vlastníkovi projektu.
 *
 * Riziko, které je potřeba říct nahlas: po kontaktu nezbude v tabulce contacts nic,
 * takže se může vrátit dalším importem. Tomu brání JEN suppression řádek, proto
 * se zakládá i v tomhle režimu, stejně jako u anonymizace.
 */
export async function purgeContact(
  ctx: WorkspaceContext,
  contactId: string,
  requestId?: string,
): Promise<void> {
  const keyring = keyringFromEnv();

  await withWorkspace(ctx, async (tx) => {
    const found = await tx.execute<{ email: string }>(sql`
      SELECT email::text AS email FROM contacts
       WHERE id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
       FOR UPDATE
    `);
    if (found.rows.length === 0) return;
    const email = found.rows[0]!.email;
    const { fingerprint } = computeCurrentFingerprint(keyring, email);

    await addSuppression(ctx, {
      email,
      reason: 'gdpr_erasure',
      source: 'gdpr',
      sourceRef: contactId,
      tx,
    });

    const counts = await tx.execute<{
      consents: number;
      subscriptions: number;
      tags: number;
    }>(sql`
      SELECT
        (SELECT count(*) FROM consents WHERE contact_id = ${contactId}::uuid)::int AS consents,
        (SELECT count(*) FROM list_subscriptions
          WHERE contact_id = ${contactId}::uuid)::int AS subscriptions,
        (SELECT count(*) FROM contact_tags WHERE contact_id = ${contactId}::uuid)::int AS tags
    `);

    // Kaskády smažou navázané řádky. Provádí je systém, ne role, takže odebrané
    // DELETE právo na consents kaskádu neblokuje.
    await tx.execute(sql`
      DELETE FROM contacts
       WHERE id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
    `);

    if (requestId !== undefined) {
      await tx.execute(sql`
        UPDATE gdpr_requests
           SET affected = ${JSON.stringify({ contacts: 1, ...counts.rows[0] })}::jsonb,
               status = 'completed', completed_at = now()
         WHERE id = ${requestId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
      `);
    }

    await enqueue(tx, 'gdpr.sever_links', { workspaceId: ctx.workspaceId, contactId });
    await writeAudit(tx, ctx, {
      action: 'contact.purged',
      targetType: 'contact',
      targetId: contactId,
      metadata: { fingerprint: fingerprint.toString('hex') },
    });
  });
}
