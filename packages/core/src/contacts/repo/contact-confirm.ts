import { sql } from 'drizzle-orm';
import { ApiError } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import type { WorkspaceContext } from '../../identity/types';
import { withWorkspace } from '../../tx';
import { writeAudit } from '../audit';
import type { SuppressionReason } from '../suppression/rank';
import type { ContactStatus } from '../types';
import { recordConsent } from './consents';
import { checkSingleSuppression, releaseSuppressionsForManualConfirm } from './suppressions';

/**
 * Ruční povýšení kontaktu na potvrzený, tedy VÝSLOVNÉ ROZHODNUTÍ SPRÁVCE.
 *
 * PROČ TO NEJDE PŘES `writeContact`. Pravidlo 3 ze 4.1.2 části 2 („status se nikdy
 * nepovyšuje") drží `applyWriteRules` A NAVÍC nezávisle SQL v `repo/contacts.ts`.
 * Obojí zamčený stav (`unsubscribed`, `bounced`, `complained`) při zápisu MLČKY zachová:
 * příkaz projde, odpověď je 200 a stav zůstane. Rozhraní, které by na tuhle cestu
 * poslalo odhlášený kontakt, by tedy ohlásilo úspěch u změny, která se nestala, a to je
 * horší než odmítnutí. Pravidlo 3 samo připouští druhou cestu: „ručním zásahem správce
 * se záznamem v auditu". Tenhle soubor je ta cesta a je jediná.
 *
 * CO SE ZÁMĚRNĚ NEDĚJE: nesahá se na jméno, vokativ, oslovení ani na `attributes`.
 * `UPDATE` níž mění jediný sloupec, `status`. Kdyby povýšení šlo přes upsert, přepočítal
 * by se vokativ z těla požadavku a zamknutý tvar oslovení by se ztratil (pravidlo 6).
 *
 * STAV KONTAKTU NENÍ JEDINÁ BRÁNA. `evaluateMailability` z `mailable.ts` má suppression
 * jako PRVNÍ vrstvu, nad stavem, a totéž dělá odesílací cesta: Go sender vylučuje
 * zablokované adresy hned po claimu (`apps/sender/internal/outbox/suppression.go`).
 * Povýšení proto řeší i blokaci adresy a v návratové hodnotě říká, co s ní udělalo.
 * Blokaci, kterou sundat nesmí, hlásí volajícímu, aby ji uživateli mohl ukázat;
 * zamlčení by znamenalo potvrzený kontakt, kterému se dál nic nedoručí.
 */

/** Stavy, které se povyšují přes tuhle cestu, protože je zápis mlčky zachová. */
const LOCKED_STATUSES: readonly ContactStatus[] = ['unsubscribed', 'bounced', 'complained'];

export type ManualConfirmResult = {
  contactId: string;
  /** Stav před zásahem. Jde do auditu a rozhoduje o hlášce v rozhraní. */
  fromStatus: ContactStatus;
  /** Změnil se stav doopravdy? `false` u kontaktu, který už potvrzený byl. */
  changed: boolean;
  /** Kolik přihlášení do seznamů se potvrdilo. */
  listsConfirmed: number;
  /** Blokace adresy, které povýšení sundalo. */
  suppressionRemoved: SuppressionReason[];
  /**
   * Blokace, která na adrese ZŮSTÁVÁ. Kontakt je potvrzený, ale neodešle se mu.
   * Volající to musí uživateli říct, ne spolknout.
   */
  suppressionBlocking: SuppressionReason | null;
};

/**
 * Doklad, který se zapisuje do souhlasu. `declaration` je totéž pole, jaké nese ruční
 * založení kontaktu a import s prohlášením správce, takže historie souhlasů umí obojí
 * zobrazit bez další větve.
 */
const DECLARATION_EVIDENCE = { declaration: true, method: 'manual_confirm' } as const;

/** Poznámka k odebrání blokace. Ukládá se do `suppressions.removal_note`. */
const REMOVAL_NOTE = 'manual_confirm';

export async function confirmContactManually(
  ctx: WorkspaceContext,
  contactId: string,
): Promise<ManualConfirmResult> {
  assertPermission(ctx, 'contacts:write');

  const current = await withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ email: string; status: ContactStatus }>(sql`
      SELECT email::text AS email, status FROM contacts
       WHERE id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND deleted_at IS NULL
    `);
    return rows[0] ?? null;
  });
  if (current === null) throw new ApiError('not_found');

  /*
   * Odblokovat adresu je pravomoc správce, ne editora, a povýšení ji fakticky používá.
   * Kdyby se ptalo jen na `contacts:write`, obešel by editor matici rolí oklikou:
   * odblokování přes `DELETE /suppressions/{id}` by mu server odmítl, přes „označit jako
   * potvrzený" by prošlo. Ptá se proto na TÝŽ `suppressions:write` jako
   * `liftProcessingRestriction`, a to už ve chvíli, kdy na adrese ŽIVÁ BLOKACE JE, ne
   * teprve podle stavu kontaktu: blokace může viset i na kontaktu ve stavu `unconfirmed`.
   */
  const suppressed = await checkSingleSuppression(ctx, current.email);
  if (suppressed !== null || LOCKED_STATUSES.includes(current.status)) {
    assertPermission(ctx, 'suppressions:write');
  }

  return withWorkspace(ctx, async (tx) => {
    // Zámek řádku na celou transakci. Bez něj by dvě souběžná povýšení obě přečetla
    // výchozí stav `unsubscribed` a obě by ho zapsala do auditu, přestože změnu
    // provedlo jen jedno z nich.
    const locked = await tx.execute<{ status: ContactStatus }>(sql`
      SELECT status FROM contacts
       WHERE id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND deleted_at IS NULL
       FOR UPDATE
    `);
    const fromStatus = locked.rows[0]?.status;
    if (fromStatus === undefined) throw new ApiError('not_found');

    // Blokace se sundává PŘED změnou stavu. Opačné pořadí by mezi oběma příkazy
    // nechalo kontakt ve stavu `active` se živou blokací, což je přesně ta kombinace,
    // která vypadá jako "smí se posílat" a přitom se neposílá.
    const suppression = await releaseSuppressionsForManualConfirm(ctx, contactId, {
      note: REMOVAL_NOTE,
      tx,
    });

    const promoted = await tx.execute<{ id: string }>(sql`
      UPDATE contacts SET status = 'active', updated_at = now()
       WHERE id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND deleted_at IS NULL AND status <> 'active'
      RETURNING id
    `);

    /*
     * Potvrzení přihlášení do seznamů. Bez něj by byl kontakt potvrzený, ale v seznamu
     * dál nepotvrzený, tedy pro kampaň na seznam pořád mimo: podle 4.1.6 je skutečnou
     * branou `list_subscriptions.status`, ne `contacts.status`.
     *
     * `snooze_until` se nuluje, protože totéž dělá `writeSubscriptionIn` u každého zápisu
     * přihlášení; kdyby zůstalo, byla by to čtvrtá tichá brána vedle stavu, seznamu
     * a blokace. `unsubscribed_at` se naopak NECHÁVÁ: je to doklad, že se člověk kdysi
     * odhlásil, a ten se nepřepisuje.
     */
    const lists = await tx.execute<{ list_id: string; status: string }>(sql`
      UPDATE list_subscriptions
         SET status = 'confirmed',
             confirmed_at = coalesce(confirmed_at, now()),
             snooze_until = NULL,
             updated_at = now()
       WHERE contact_id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND status <> 'confirmed'
      RETURNING list_id, status
    `);

    for (const row of lists.rows) {
      await writeAudit(tx, ctx, {
        action: 'subscription.forced_confirmed',
        targetType: 'list_subscription',
        targetId: row.list_id,
        metadata: { contact_id: contactId, source: 'manual_confirm' },
      });
    }

    /*
     * Souhlas se zapisuje se zdrojem `admin`, ne `api`. Je to doklad a „přes API"
     * versus „správce to odklikal v rozhraní" jsou dvě různá tvrzení o tom, kdo za
     * souhlas ručí; historie souhlasů obojí pojmenovává zvlášť. Číselník
     * `ck_consents__source` zná `admin` a NEZNÁ `manual`, viz `consentSourceOf`
     * v `contacts-api.ts`.
     */
    await recordConsent(ctx, {
      contactId,
      purpose: 'email_marketing',
      status: 'granted',
      legalBasis: 'consent',
      scopeListId: null,
      source: 'admin',
      evidence: DECLARATION_EVIDENCE,
      tx,
    });

    await writeAudit(tx, ctx, {
      action: 'contact.manually_confirmed',
      targetType: 'contact',
      targetId: contactId,
      metadata: {
        from_status: fromStatus,
        changed: promoted.rows.length > 0,
        lists_confirmed: lists.rows.length,
        suppression_removed: suppression.removed,
        suppression_blocking: suppression.blocking?.reason ?? null,
      },
    });

    return {
      contactId,
      fromStatus,
      changed: promoted.rows.length > 0,
      listsConfirmed: lists.rows.length,
      suppressionRemoved: suppression.removed,
      suppressionBlocking: suppression.blocking?.reason ?? null,
    };
  });
}
