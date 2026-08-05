import { sql } from 'drizzle-orm';
import { loadConfig } from '../../config';
import type { WorkspaceContext } from '../../identity/types';
import { emitWebhookEvent } from '../../platform/webhooks/emit';
import { withWorkspace } from '../../tx';
import { sendFormDeliveryEmail } from '../forms/delivery-email';
import { recordConsent, type ConsentPurpose } from '../repo/consents';
import { findFormOfLastSubmission } from '../repo/forms';
import { byId as listById } from '../repo/lists';
import {
  consumeConfirmation,
  countResendsIn24h,
  findConfirmation,
  findSubscription,
  issueConfirmation,
  writeSubscriptionIn,
} from '../repo/subscriptions';
import {
  checkSingleSuppression,
  removeUnsubscribeSuppressionForContact,
} from '../repo/suppressions';
import {
  confirmSubscription,
  type ConfirmPorts,
  type ConfirmResult,
  type ConfirmationMode,
} from './confirm';
import { subscriptionEmailPort } from './subscribe-service';

/**
 * Zapojení `confirmSubscription()` na repozitář, obdoba `subscribePorts` z úkolu 26.
 *
 * Bez tohohle souboru je potvrzovací stránka nespustitelná: čistá logika v `confirm.ts`
 * má jen porty a nikdo je dosud nezapojil. Rozhodování zůstává tam, tady je jen
 * překlad na dotazy.
 */
export function confirmPorts(ctx: WorkspaceContext): ConfirmPorts {
  return {
    now: () => new Date(),

    async findConfirmation(token) {
      const row = await findConfirmation(ctx, token);
      return row === null
        ? null
        : {
            id: row.id,
            contactId: row.contactId,
            listId: row.listId,
            expiresAt: row.expiresAt,
            consumedAt: row.consumedAt,
          };
    },

    async consumeConfirmation(token, options) {
      const row = await consumeConfirmation(ctx, token, { consumedIp: options.consumedIp });
      return row === null
        ? null
        : {
            id: row.id,
            contactId: row.contactId,
            listId: row.listId,
            expiresAt: row.expiresAt,
            consumedAt: row.consumedAt,
          };
    },

    async findList(listId) {
      const row = await listById(ctx, listId);
      if (row === null) return null;
      return {
        id: row.id,
        name: row.name,
        optIn: row.optIn,
        confirmationTtlHours: row.confirmationTtlHours,
        confirmationMaxResends: row.confirmationMaxResends,
        sendWelcome: row.sendWelcome,
        confirmationMode: row.confirmationMode as ConfirmationMode,
      };
    },

    async readSubscription(contactId, listId) {
      const row = await findSubscription(ctx, contactId, listId);
      return row === null
        ? null
        : { status: row.status, confirmationSentAt: row.confirmationSentAt };
    },

    async writeSubscription(input) {
      await withWorkspace(ctx, async (tx) => {
        await writeSubscriptionIn(tx, ctx, {
          contactId: input.contactId,
          listId: input.listId,
          status: input.status,
          source: input.source,
          sourceRef: null,
          ...(input.confirmedAt === undefined ? {} : { confirmedAt: input.confirmedAt }),
          ...(input.confirmationSentAt === undefined
            ? {}
            : { confirmationSentAt: input.confirmationSentAt }),
          ...(input.bumpResends === undefined ? {} : { bumpResends: input.bumpResends }),
        });
      });
    },

    async checkSuppression(contactId) {
      const email = await emailOf(ctx, contactId);
      if (email === null) return null;
      const hit = await checkSingleSuppression(ctx, email);
      return hit === null
        ? null
        : { reason: hit.reason, createdAt: hit.createdAt, removedAt: null };
    },

    async removeUnsubscribeSuppression(contactId) {
      // Samotný dotaz leží v `repo/suppressions.ts`, protože zápis do suppression listu
      // smí být podle `test/repo/suppressions.query-shape.test.ts` jedině tam: druhá
      // brána do něj by se nedala uhlídat.
      await removeUnsubscribeSuppressionForContact(ctx, contactId);
    },

    async activateContact(contactId) {
      await withWorkspace(ctx, async (tx) => {
        // Jen z 'pending'. Kontakt, který je 'unsubscribed' nebo 'bounced', se
        // potvrzením přihlášení do jednoho seznamu neoživuje sám od sebe.
        await tx.execute(sql`
          UPDATE contacts SET status = 'active', updated_at = now()
           WHERE id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
             AND status = 'pending' AND deleted_at IS NULL
        `);
      });
    },

    async recordConsent(input) {
      await recordConsent(ctx, {
        contactId: input.contactId,
        purpose: 'email_marketing' satisfies ConsentPurpose,
        status: input.status,
        legalBasis: 'consent',
        scopeListId: input.scopeListId,
        source: input.source,
        evidence: input.evidence as never,
        occurredAt: input.occurredAt,
      });
    },

    async sendWelcomeEmail(input) {
      await subscriptionEmailPort()?.sendWelcome({
        workspaceId: ctx.workspaceId,
        contactId: input.contactId,
        listId: input.list.id,
        listName: input.list.name,
      });
    },

    async issueConfirmation(input) {
      const { token } = await issueConfirmation(ctx, {
        contactId: input.contactId,
        listId: input.listId,
        ttlHours: input.ttlHours,
      });
      return { token };
    },

    async sendConfirmationEmail(input) {
      await subscriptionEmailPort()?.sendConfirmation({
        workspaceId: ctx.workspaceId,
        contactId: input.contactId,
        listId: input.list.id,
        listName: input.list.name,
        token: input.token,
      });
    },

    async countResends(contactId, listId) {
      return withWorkspace(ctx, async (tx) =>
        countResendsIn24h(tx, ctx, contactId, listId, new Date()),
      );
    },

    async emit(type, data) {
      await withWorkspace(ctx, async (tx) => {
        await emitWebhookEvent(tx, {
          workspaceId: ctx.workspaceId,
          type,
          occurredAt: new Date(),
          data,
        });
      });
    },
  };
}

/** Potvrzení přihlášení se zapojenými porty. Tohle volá veřejná stránka i API. */
export async function confirmPublicSubscription(
  ctx: WorkspaceContext,
  input: { token: string; requestIp?: string | null; userAgent?: string | null },
): Promise<ConfirmResult> {
  /*
   * Kdo potvrzuje, se musí zjistit PŘED potvrzením. Potvrzení token spotřebuje,
   * takže potom už z něj kontakt nedohledáme, a `ConfirmResult` ho nenese:
   * veřejná stránka ho vědět nesmí, jinak by se z ní stal nástroj na zjišťování,
   * komu která adresa patří.
   */
  const record = await findConfirmation(ctx, input.token);
  const result = await confirmSubscription(ctx, { ...input, method: 'POST' }, confirmPorts(ctx));

  if (result.view === 'done' && record !== null) {
    await deliverFormEmailAfterConfirm(ctx, record.contactId);
  }
  return result;
}

/**
 * Slíbený e-mail po potvrzení přihlášení.
 *
 * TADY, ne v `subscribe()`: u formuláře se zapnutým potvrzováním adresy nesmí nic
 * odejít dřív, než člověk klikne na potvrzovací odkaz. Kdyby e-book odešel hned
 * po vyplnění, bylo by dvojí potvrzení jen ozdoba, protože slíbenou věc by dostal
 * i ten, kdo o ni nepožádal, a jeho adresu by šlo takhle zneužít k rozesílce.
 *
 * NIKDY NEVYHODÍ VÝJIMKU. Přihlášení je v tuhle chvíli potvrzené a zapsané;
 * neodeslaný e-mail nesmí ten zápis shodit ani zobrazit člověku chybu. Důvod
 * neodeslání zůstává v návratové hodnotě `sendFormDeliveryEmail` a v logu senderu.
 */
async function deliverFormEmailAfterConfirm(
  ctx: WorkspaceContext,
  contactId: string,
): Promise<void> {
  try {
    const form = await findFormOfLastSubmission(ctx, contactId);
    if (form === null || form.deliveryTemplateId === null) return;

    const email = await emailOf(ctx, contactId);
    if (email === null) return;

    await sendFormDeliveryEmail(ctx, {
      form,
      contactId,
      email,
      assetBaseUrl: loadConfig().ASSET_BASE_URL,
    });
  } catch {
    // Viz hlavička: potvrzené přihlášení nesmí spadnout kvůli e-mailu.
  }
}

async function emailOf(ctx: WorkspaceContext, contactId: string): Promise<string | null> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ email: string }>(sql`
      SELECT email::text AS email FROM contacts
       WHERE id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
    `);
    return rows[0]?.email ?? null;
  });
}
