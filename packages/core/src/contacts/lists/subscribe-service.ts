import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../../identity/types';
import { emitWebhookEvent } from '../../platform/webhooks/emit';
import { withWorkspace } from '../../tx';
import { findEffectiveConsent, recordConsent, type ConsentPurpose } from '../repo/consents';
import { writeContact } from '../repo/contacts';
import { byId as listById } from '../repo/lists';
import {
  countResendsIn24h,
  findSubscription,
  issueConfirmation,
  writeSubscriptionIn,
} from '../repo/subscriptions';
import { checkSingleSuppression } from '../repo/suppressions';
import {
  subscribe,
  type SubscribeInput,
  type SubscribePorts,
  type SubscribeResult,
} from './subscribe';

/**
 * Zapojení doménové funkce `subscribe()` na repozitář.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. Plán volal z handleru `subscribeToList(ctx, ...)`,
 * funkci, která v doméně není. Existuje `subscribe(ctx, input, ports)`, tedy čistá logika
 * s porty, a ty dosud nikdo nezapojil. Tenhle soubor je to zapojení; logika zůstává tam,
 * kde byla, a používá ho i veřejný formulář a příchozí webhook, až vzniknou.
 *
 * Odesílání e-mailů je REGISTROVANÝ PORT, stejně jako `campaigns-port.ts`. Šablony
 * potvrzovacího a uvítacího e-mailu vlastní P08 a odesílání P13, takže dokud je nikdo
 * nezaregistruje, e-mail neodejde a přihlášení se dokončí. Alternativa, tedy tvrdý import
 * neexistujícího modulu, by shodila celou doménu.
 */

export type SubscriptionEmailPort = {
  sendConfirmation(input: {
    workspaceId: string;
    contactId: string;
    listId: string;
    listName: string;
    token: string;
  }): Promise<void>;
  sendWelcome(input: {
    workspaceId: string;
    contactId: string;
    listId: string;
    listName: string;
  }): Promise<void>;
  deliverRequestedItem(input: {
    workspaceId: string;
    contactId: string;
    deliverable: string;
  }): Promise<void>;
};

let emails: SubscriptionEmailPort | null = null;

/** Registruje P08 a P13 při startu procesu. Druhá registrace přepíše první. */
export function registerSubscriptionEmails(port: SubscriptionEmailPort): void {
  emails = port;
}

/** Jen pro testy: vrátí port do výchozího stavu. */
export function resetSubscriptionEmails(): void {
  emails = null;
}

/** Byl port zaregistrovaný? Čte to diagnostika, aby šlo poznat tiché neodeslání. */
export function areSubscriptionEmailsAvailable(): boolean {
  return emails !== null;
}

/**
 * Zaregistrovaný port, nebo null. Čte ho `confirm-service.ts`, které posílá tytéž dva
 * e-maily z druhé strany potvrzovacího odkazu. Bez tohohle přístupu by měl vlastní
 * registraci, a to by znamenalo dva porty, ze kterých by P08 zaregistroval jeden.
 */
export function subscriptionEmailPort(): SubscriptionEmailPort | null {
  return emails;
}

/**
 * Porty nad skutečnou databází. Každý z nich je jediné volání existující funkce
 * repozitáře, žádná logika navíc: rozhodování patří do `subscribe()`.
 */
export function subscribePorts(ctx: WorkspaceContext): SubscribePorts {
  return {
    now: () => new Date(),

    async checkSuppression(email) {
      const hit = await checkSingleSuppression(ctx, email);
      // `checkSuppression` vrací jen ŽIVÉ blokace (removed_at IS NULL), takže odebraná
      // blokace se sem nedostane a removedAt je vždy null.
      return hit === null
        ? null
        : { reason: hit.reason, createdAt: hit.createdAt, removedAt: null };
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
      };
    },

    /**
     * PŘIHLÁŠENÍ DO SEZNAMU NENÍ ZMĚNA JMÉNA.
     *
     * Port má jména psaná jako `string | null`, protože `subscribe()` normalizuje
     * `undefined` na `null` na hranici portu (viz hlavička `subscribe.ts`). Do zápisu
     * se ale `null` posílat NESMÍ: pro `writeContact` je „null" tvrzení „jméno má být
     * prázdné", zatímco tady znamená „přihlášení jméno vůbec nenese". Rozdíl se dřív
     * ztratil a hromadné přidání do seznamu tím shodilo ručně potvrzený tvar oslovení
     * (v auditu `contact.vocative_lock_released` s důvodem `name_changed` u kontaktů,
     * kterým se jméno nezměnilo).
     *
     * Prázdné jméno se proto vynechává úplně a `writeContact` pak jméno, vokativ ani
     * oslovení nemá o čem přepočítat. Formulář, který jméno vyplněné MÁ, ho posílá dál
     * a chová se přesně jako dřív.
     */
    async upsertContact(input) {
      const result = await writeContact(ctx, {
        email: input.email,
        ...(input.firstName === null ? {} : { firstName: input.firstName }),
        ...(input.lastName === null ? {} : { lastName: input.lastName }),
        attributes: input.attributes,
        ...(input.locale === null ? {} : { locale: input.locale }),
        source: input.source,
        sourceRef: input.sourceRef,
        mode: 'update',
      });
      if (result.rejected === 'suppressed') {
        // Sem se běh nedostane: tvrdé blokace odfiltruje `subscribe()` dřív. Kdyby
        // přesto nastal závod se zápisem stížnosti, chová se to jako blokace.
        return { contactId: '', created: false };
      }
      return { contactId: result.id, created: result.inserted };
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
          sourceRef: input.sourceRef,
          ...(input.confirmedAt === undefined ? {} : { confirmedAt: input.confirmedAt }),
          ...(input.confirmationSentAt === undefined
            ? {}
            : { confirmationSentAt: input.confirmationSentAt }),
          ...(input.bumpResends === undefined ? {} : { bumpResends: input.bumpResends }),
        });
      });
    },

    async countResends(contactId, listId) {
      return withWorkspace(ctx, async (tx) =>
        countResendsIn24h(tx, ctx, contactId, listId, new Date()),
      );
    },

    async findConsent(contactId, listId) {
      const proof = await findEffectiveConsent(ctx, { contactId, listId });
      return proof === null
        ? null
        : {
            consentId: proof.consentId,
            scopeListId: proof.scopeListId,
            source: proof.source,
            occurredAt: proof.occurredAt,
          };
    },

    async issueConfirmation(input) {
      const { token } = await issueConfirmation(ctx, {
        contactId: input.contactId,
        listId: input.listId,
        ttlHours: input.ttlHours,
      });
      return { token };
    },

    async recordConsent(input) {
      await recordConsent(ctx, {
        contactId: input.contactId,
        purpose: 'email_marketing' satisfies ConsentPurpose,
        status: input.status,
        legalBasis: 'consent',
        scopeListId: input.scopeListId,
        source: input.source,
        ...(input.consentText === null ? {} : { consentText: input.consentText }),
        evidence: input.evidence as never,
        occurredAt: input.occurredAt,
      });
    },

    async sendConfirmationEmail(input) {
      await emails?.sendConfirmation({
        workspaceId: ctx.workspaceId,
        contactId: input.contactId,
        listId: input.list.id,
        listName: input.list.name,
        token: input.token,
      });
    },

    async sendWelcomeEmail(input) {
      await emails?.sendWelcome({
        workspaceId: ctx.workspaceId,
        contactId: input.contactId,
        listId: input.list.id,
        listName: input.list.name,
      });
    },

    async deliverRequestedItem(input) {
      await emails?.deliverRequestedItem({
        workspaceId: ctx.workspaceId,
        contactId: input.contactId,
        deliverable: input.deliverable,
      });
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

/** Přihlášení do seznamu se zapojenými porty. Tohle volá API, formulář i webhook. */
export async function subscribeToList(
  ctx: WorkspaceContext,
  input: SubscribeInput,
): Promise<SubscribeResult> {
  return subscribe(ctx, input, subscribePorts(ctx));
}

/**
 * Opakované odeslání potvrzovacího e-mailu. Je to tentýž průchod jako přihlášení,
 * jen bez změny dat kontaktu: `subscribe()` sám rozhodne, jestli se smí poslat,
 * a limit tří odeslání za 24 hodin hlídá `canResendConfirmation`.
 */
export async function resendConfirmation(
  ctx: WorkspaceContext,
  input: { listId: string; contactId: string },
): Promise<SubscribeResult> {
  const email = await withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ email: string }>(sql`
      SELECT email::text AS email FROM contacts
       WHERE id = ${input.contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND deleted_at IS NULL
    `);
    return rows[0]?.email ?? null;
  });
  if (email === null)
    return {
      response: 'accepted',
      outcome: 'invalid_email',
      contactId: null,
      subscriptionStatus: null,
    };

  return subscribeToList(ctx, { listId: input.listId, email, source: 'api' });
}
