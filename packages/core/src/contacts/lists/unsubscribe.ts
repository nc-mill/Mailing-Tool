import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../../identity/types';
import { emitWebhookEvent } from '../../platform/webhooks/emit';
import { withWorkspace } from '../../tx';
import { writeAudit } from '../audit';
import { revokePendingMessages } from '../campaigns-port';
import { recordConsent } from '../repo/consents';
import { findContactByEmail } from '../repo/contacts-query';
import { byId as listById } from '../repo/lists';
import { findSubscription } from '../repo/subscriptions';
import { addSuppression } from '../repo/suppressions';
import { transition, type SubscriptionState } from './state-machine';
import { subscriptionEmails } from './subscribe-service';

export type UnsubscribeReason =
  'link' | 'one_click' | 'preference_center' | 'api' | 'manual' | 'global' | 'objection';

export type UnsubscribeInput = {
  contactId: string;
  /**
   * Rozsah odhlášení. null znamená globální.
   *
   * POZOR: tahle hodnota se dál předává do revokePendingMessages, kde je parametr
   * VOLITELNÝ. Předává se proto vždy explicitně, i když je null. Vynechání by v části 4a
   * znamenalo "zruš všechny čekající zprávy kontaktu", tedy jiný rozsah, než jaký
   * uživatel zvolil, a byla by to tichá ztráta pošty. Viz kritérium 79.
   */
  listId: string | null;
  reason: UnsubscribeReason;
  campaignId?: string | null;
};

/**
 * Zdroj odvolání souhlasu pro tabulku `consents`.
 *
 * ZÁSAH SPRÁVCE SE MUSÍ POZNAT OD PROJEVU VŮLE PŘÍJEMCE. Do téhle chvíle spadlo
 * všechno kromě one-click a námitky na `preference_center`, tedy na „odhlásil se sám
 * ze stránky předvoleb". Ruční i hromadné odhlášení správcem se tak v historii kontaktu
 * tvářilo jako rozhodnutí příjemce, což je přesně ten údaj, kvůli kterému se souhlasy
 * vedou. `admin`, `api` i `objection` jsou v `ck_consents__source` povolené hodnoty,
 * takže to není migrace.
 *
 * Rozdíl mezi `admin` a `api` je schválně: `manual` je člověk v rozhraní správce,
 * `api` je integrace nebo příchozí zpráva zpracovaná strojově (`jobs/inbound-process`).
 * Sloučit je do jedné hodnoty by znamenalo tvrdit, že za odhlášením z e-shopu stál
 * konkrétní správce.
 *
 * Námitka podle článku 21 se zapisuje jako `objection` bez ohledu na rozsah: dřív to
 * platilo jen u globálního odhlášení, i když námitka omezená na jeden seznam je táž
 * právní věc.
 */
function consentSourceFor(reason: UnsubscribeReason): string {
  if (reason === 'one_click') return 'one_click';
  if (reason === 'objection') return 'objection';
  if (reason === 'manual') return 'admin';
  if (reason === 'api') return 'api';
  return 'preference_center';
}

/**
 * Odhlášení podle tabulky rozsahů ve 4.9.2 části 2.
 *
 * Rozdíl mezi odhlášením ze seznamu a globálním je nejčastější zdroj nedorozumění,
 * proto je na stránce předvoleb napsaný doslova a proto ho tahle funkce nikdy neodhaduje:
 * rozhoduje výhradně přítomnost listId v tokenu.
 */
export async function unsubscribe(
  ctx: WorkspaceContext,
  input: UnsubscribeInput,
): Promise<{ scope: 'list' | 'global' }> {
  const global = input.listId === null;
  const dbReason = input.reason;

  const result = await unsubscribeIn(ctx, input, global, dbReason);
  // Rozloučení AŽ PO TRANSAKCI a nikdy uvnitř ní. Odhlášení je hotové a zapsané;
  // neodeslaný e-mail ho nesmí vrátit zpátky, a naopak dlouhé odesílání nesmí
  // držet zámek nad kontaktem.
  await sendGoodbyeEmail(ctx, input);
  return result;
}

/**
 * Rozloučení po odhlášení.
 *
 * JEN U ODHLÁŠENÍ Z JEDNOHO SEZNAMU, ne u globálního, a je to věcné rozhodnutí,
 * ne zjednodušení. Rozloučení je nastavení SEZNAMU (`lists.send_goodbye`),
 * takže u globálního odhlášení není podle čeho vybrat, který text poslat, a poslat
 * jich několik by z „odhlaste mě ze všeho" udělalo několik dalších e-mailů. Přesně
 * to je ten případ, kdy je rozloučení vnímané jako drzost, kvůli kterému je celá
 * funkce ve výchozím stavu vypnutá.
 *
 * NIKDY NEVYHODÍ VÝJIMKU. Odhlášení je právní povinnost a nesmí spadnout kvůli
 * e-mailu; důvod neodeslání zapisuje `sendSubscriptionEmail` do auditu.
 */
async function sendGoodbyeEmail(ctx: WorkspaceContext, input: UnsubscribeInput): Promise<void> {
  if (input.listId === null) return;
  try {
    const list = await listById(ctx, input.listId);
    if (list === null || !list.sendGoodbye) return;
    await (
      await subscriptionEmails()
    ).sendGoodbye({
      workspaceId: ctx.workspaceId,
      contactId: input.contactId,
      listId: list.id,
      listName: list.name,
    });
  } catch {
    // Viz hlavička.
  }
}

async function unsubscribeIn(
  ctx: WorkspaceContext,
  input: UnsubscribeInput,
  global: boolean,
  dbReason: UnsubscribeReason,
): Promise<{ scope: 'list' | 'global' }> {
  return withWorkspace(ctx, async (tx) => {
    const contact = await tx.execute<{ id: string; email: string }>(sql`
      SELECT id, email::text AS email FROM contacts
       WHERE id = ${input.contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND deleted_at IS NULL
       FOR UPDATE
    `);
    const found = contact.rows[0];
    if (found === undefined) return { scope: global ? 'global' : 'list' };
    const email = found.email;

    if (global) {
      // Globální odhlášení: všechny seznamy, stav kontaktu, suppression a odvolání
      // souhlasu bez rozsahu. Suppression platí pro celý projekt, proto vzniká
      // jen tady a ne u odhlášení ze seznamu.
      await tx.execute(sql`
        UPDATE list_subscriptions
           SET status = 'unsubscribed', unsubscribed_at = now(),
               unsubscribe_reason = ${dbReason},
               unsubscribe_campaign_id = ${input.campaignId ?? null}::uuid,
               updated_at = now()
         WHERE contact_id = ${input.contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
           AND status <> 'unsubscribed'
      `);

      await addSuppression(ctx, {
        email,
        reason: input.reason === 'one_click' ? 'one_click_unsubscribe' : 'global_unsubscribe',
        source: input.reason,
        tx,
      });

      await recordConsent(ctx, {
        contactId: input.contactId,
        purpose: 'email_marketing',
        status: 'withdrawn',
        legalBasis: 'consent',
        scopeListId: null,
        source: consentSourceFor(input.reason),
        tx,
      });
    } else {
      await tx.execute(sql`
        UPDATE list_subscriptions
           SET status = 'unsubscribed', unsubscribed_at = now(),
               unsubscribe_reason = ${dbReason},
               unsubscribe_campaign_id = ${input.campaignId ?? null}::uuid,
               updated_at = now()
         WHERE contact_id = ${input.contactId}::uuid AND list_id = ${input.listId}::uuid
           AND workspace_id = ${ctx.workspaceId}::uuid
      `);

      await recordConsent(ctx, {
        contactId: input.contactId,
        purpose: 'email_marketing',
        status: 'withdrawn',
        legalBasis: 'consent',
        scopeListId: input.listId,
        source: consentSourceFor(input.reason),
        tx,
      });
    }

    // Zrušení čekajících zpráv ve STEJNÉ transakci. listId se předává vždy,
    // i jako null, viz komentář u typu.
    await revokePendingMessages({
      workspaceId: ctx.workspaceId,
      contactIds: [input.contactId],
      listId: input.listId,
      reason: 'unsubscribed',
    });

    await emitWebhookEvent(tx, {
      workspaceId: ctx.workspaceId,
      type: 'contact.unsubscribed',
      occurredAt: new Date(),
      data: {
        contact_id: input.contactId,
        email,
        list_id: input.listId,
        scope: global ? 'global' : 'list',
        reason: input.reason,
      },
    });

    return { scope: global ? 'global' : 'list' };
  });
}

/**
 * Výsledek jedné položky hromadného odhlášení.
 *
 * `unchanged` znamená, že se nemělo co zapsat: kontakt v seznamu vůbec není, nebo v něm
 * odhlášený už je. Přeskočení bez výsledku tu být nesmí, protože pak by volající nepoznal
 * rozdíl mezi „hotovo" a „nic se nestalo".
 */
export type BulkUnsubscribeOutcome = 'unsubscribed' | 'unchanged' | 'unknown_contact';

export type BulkUnsubscribeItem = {
  index: number;
  outcome: BulkUnsubscribeOutcome;
  contactId: string | null;
};

/**
 * Hromadné odhlášení ze seznamu. Protějšek `subscribeToList` v hromadné podobě.
 *
 * O KAŽDÉ POLOŽCE ROZHODUJE STAVOVÝ AUTOMAT, ne parametr volajícího. Přečte se skutečný
 * stav přihlášení, `transition()` k němu vydá cílový stav a teprve podle něj se rozhodne,
 * jestli se má co zapsat. Kdyby se místo toho jen pustilo UPDATE nad všemi řádky, byl by
 * v produktu druhý výklad pravidel vedle automatu a rozešel by se s ním po první změně.
 *
 * ZÁPIS DĚLÁ `unsubscribe()`, ne tahle funkce. Odvolání souhlasu, zrušení čekajících
 * zpráv i odchozí událost tak vzniknou úplně stejně jako u odhlášení jednoho kontaktu.
 * Vlastní SQL by znamenalo druhou implementaci a v historii kontaktu by se hromadné
 * odhlášení od jednotlivého lišilo.
 *
 * NIC SE TIŠE NEPŘESKAKUJE. Neznámá adresa i kontakt mimo seznam mají vlastní výsledek,
 * takže volající vždycky ví, co se s každou položkou stalo.
 */
export async function bulkUnsubscribeFromList(
  ctx: WorkspaceContext,
  input: { listId: string; emails: readonly string[]; reason: UnsubscribeReason },
): Promise<BulkUnsubscribeItem[]> {
  const results: BulkUnsubscribeItem[] = [];
  let changed = 0;

  for (const [index, email] of input.emails.entries()) {
    const contact = await findContactByEmail(ctx, email);
    if (contact === null) {
      results.push({ index, outcome: 'unknown_contact', contactId: null });
      continue;
    }

    const existing = await findSubscription(ctx, contact.id, input.listId);
    const from: SubscriptionState = existing === null ? 'none' : existing.status;
    const decision = transition(from, {
      kind: 'unsubscribe',
      scope: 'list',
      reason: input.reason,
      now: new Date(),
    });

    if (!decision.allowed) {
      // Nedosažitelné: automat odhlášení nikdy neodmítá. Kdyby to někdo změnil, ať to
      // skončí výslovným výsledkem místo tichého přeskočení.
      results.push({ index, outcome: 'unchanged', contactId: contact.id });
      continue;
    }

    // Řádek, který neexistuje, není co odhlašovat, a stav, který se rovná cílovému,
    // není co měnit. Obojí je legitimní výsledek, ne chyba.
    if (from === 'none' || decision.next === from) {
      results.push({ index, outcome: 'unchanged', contactId: contact.id });
      continue;
    }

    await unsubscribe(ctx, { contactId: contact.id, listId: input.listId, reason: input.reason });
    changed += 1;
    results.push({ index, outcome: 'unsubscribed', contactId: contact.id });
  }

  // Audit se zapisuje jednou za dávku, ne za položku: hromadné odhlášení je JEDEN
  // zásah správce a stovka řádků v auditu by dohledávání spíš ztížila. Adresy se do
  // metadat nedávají, `writeAudit` je stejně redaguje.
  await withWorkspace(ctx, async (tx) => {
    await writeAudit(tx, ctx, {
      action: 'contact.bulk_unsubscribed',
      targetType: 'list',
      targetId: input.listId,
      metadata: {
        requested: input.emails.length,
        unsubscribed: changed,
        unchanged: results.length - changed,
        reason: input.reason,
      },
    });
  });

  return results;
}

/**
 * Pozastavení odběru. Měkčí volba, kterou stránka předvoleb nabízí PŘED odhlášením,
 * protože ji většina lidí uvítá a projekt o kontakt nepřijde. Stav přihlášení
 * zůstává confirmed, jen se nastaví snooze_until.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ POSTGRESQL. Plán skládal interval výrazem
 * `(${days} || ' days')::interval`. Vázaný parametr má v tom výrazu neznámý typ, takže
 * PostgreSQL odmítne operátor `||` chybou 42883 a pozastavení by nešlo vůbec. Interval
 * se proto skládá funkcí `make_interval`, která bere počet dní jako číslo.
 */
export async function snooze(
  ctx: WorkspaceContext,
  input: { contactId: string; listId: string | null; days: 30 | 60 | 90 },
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(sql`
      UPDATE list_subscriptions
         SET snooze_until = now() + make_interval(days => ${input.days}), updated_at = now()
       WHERE contact_id = ${input.contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND (${input.listId}::uuid IS NULL OR list_id = ${input.listId}::uuid)
    `);
  });
}

/**
 * Zrušení pozastavení. Protějšek `snooze`, který v produktu do téhle chvíle CHYBĚL:
 * pozastavit odběr uměla stránka předvoleb i správce, zrušit ho neuměl nikdo, takže
 * kontakt pozastavený na 90 dní byl 90 dní nedosažitelný a nešlo s tím nic dělat.
 *
 * Vrací počet dotčených přihlášení, ne void. Rozhraní podle něj pozná rozdíl mezi
 * "pauza zrušena" a "žádná pauza tam nebyla", a nemusí to hádat z toho, že nic nespadlo.
 *
 * Zápis je podmíněný na `snooze_until IS NOT NULL`, takže druhý běh nemá co měnit
 * a nezvedne `updated_at` řádkům, kterých se netýká.
 */
export async function cancelSnooze(
  ctx: WorkspaceContext,
  input: { contactId: string; listId: string | null },
): Promise<{ cleared: number }> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ list_id: string }>(sql`
      UPDATE list_subscriptions
         SET snooze_until = NULL, updated_at = now()
       WHERE contact_id = ${input.contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND (${input.listId}::uuid IS NULL OR list_id = ${input.listId}::uuid)
         AND snooze_until IS NOT NULL
      RETURNING list_id
    `);

    if (rows.length > 0) {
      await writeAudit(tx, ctx, {
        action: 'contact.snooze_cancelled',
        targetType: 'contact',
        targetId: input.contactId,
        metadata: { list_id: input.listId, cleared: rows.length },
      });
    }

    return { cleared: rows.length };
  });
}
