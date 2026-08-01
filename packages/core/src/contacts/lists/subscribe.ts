import { ApiError } from '../../errors/api-error';
import type { WorkspaceContext } from '../../identity/types';
import { normalizeEmail } from '../email';
import { canResendConfirmation } from './confirmation';
import { transition, type SubscriptionStatus, type SuppressionSnapshot } from './state-machine';

export type ListSnapshot = {
  id: string;
  name: string;
  optIn: 'single' | 'double';
  confirmationTtlHours: number;
  confirmationMaxResends: number;
  sendWelcome: boolean;
};

export type SubscriptionSnapshot = {
  status: SubscriptionStatus;
  confirmationSentAt: Date | null;
};

export type SubscribeInput = {
  listId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  attributes?: Record<string, unknown>;
  locale?: string | null;
  source: 'manual' | 'import' | 'api' | 'form' | 'webhook' | 'preference_center' | 'migration';
  sourceRef?: string | null;
  /** Vyžádaná věc (e-book, kupon). Doručuje se vždy, když vůbec smíme odesílat. */
  deliverable?: string | null;
  skipConfirmation?: boolean;
  declaration?: boolean;
  consentText?: string | null;
  requestIp?: string | null;
  userAgent?: string | null;
  pageUrl?: string | null;
};

export type SubscribeOutcome =
  | 'confirmation_sent'
  | 'confirmed'
  | 'already_confirmed'
  | 'resend_throttled'
  | 'blocked_complaint'
  | 'blocked_suppressed'
  | 'invalid_email';

export type SubscribeResult = {
  /** Veřejná odpověď. Je vždy stejná, ať kontakt existuje, nebo ne (rozhodnutí R9). */
  response: 'accepted';
  /** Vnitřní výsledek. Čte ho audit, metriky a API vrstva, která z něj skládá 409. */
  outcome: SubscribeOutcome;
  contactId: string | null;
  subscriptionStatus: SubscriptionStatus | null;
};

export type SubscribePorts = {
  now(): Date;
  checkSuppression(email: string): Promise<SuppressionSnapshot | null>;
  findList(listId: string): Promise<ListSnapshot | null>;
  upsertContact(input: {
    email: string;
    firstName: string | null;
    lastName: string | null;
    attributes: Record<string, unknown>;
    locale: string | null;
    source: SubscribeInput['source'];
    sourceRef: string | null;
  }): Promise<{ contactId: string; created: boolean }>;
  readSubscription(contactId: string, listId: string): Promise<SubscriptionSnapshot | null>;
  writeSubscription(input: {
    contactId: string;
    listId: string;
    status: SubscriptionStatus;
    source: SubscribeInput['source'];
    sourceRef: string | null;
    confirmedAt?: Date | null;
    confirmationSentAt?: Date | null;
    bumpResends?: boolean;
  }): Promise<void>;
  countResends(contactId: string, listId: string): Promise<number>;
  issueConfirmation(input: {
    contactId: string;
    listId: string;
    ttlHours: number;
  }): Promise<{ token: string }>;
  recordConsent(input: {
    contactId: string;
    scopeListId: string | null;
    status: 'granted';
    source: string;
    consentText: string | null;
    evidence: Record<string, unknown>;
    occurredAt: Date;
  }): Promise<void>;
  sendConfirmationEmail(input: {
    contactId: string;
    list: ListSnapshot;
    token: string;
  }): Promise<void>;
  sendWelcomeEmail(input: { contactId: string; list: ListSnapshot }): Promise<void>;
  deliverRequestedItem(input: { contactId: string; deliverable: string }): Promise<void>;
  emit(type: 'contact.subscribed', data: Record<string, unknown>): Promise<void>;
};

/** Důvody suppression, po kterých se kontakt ani nezaloží (4.10.5). */
const HARD_BLOCK_REASONS = new Set(['complaint', 'gdpr_erasure']);

/**
 * Přihlášení do seznamu podle 4.8 části 2.
 *
 * Tři pravidla, která rozhoduje zadavatel a která se nesmí obejít:
 *
 * 1. Vyžádaná věc se doručí vždy, když vůbec smíme odesílat. Kdo si stáhl e-book, musí ho
 *    dostat i tehdy, když se do seznamu nakonec nepřihlásí.
 * 2. Potvrzovací a uvítací e-mail dostane jen skutečně nový nebo dříve odhlášený kontakt.
 *    Kdo už je potvrzený, dostane jen to, o co požádal. Jinak by opakované odeslání formuláře
 *    s cizí adresou znamenalo, že naše doména rozešle e-maily za útočníka.
 * 3. Odpověď je vždy stejná, ať kontakt existuje, nebo ne. Rozdílná odpověď by z formuláře
 *    udělala nástroj na ověřování, kdo je v databázi.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ tsconfigem. Volitelná pole portů jsou psaná jako
 * `T | null` a volající dopisuje `?? null`. Pod `exactOptionalPropertyTypes` se totiž
 * `string | null | undefined` do `?: string | null` přiřadit nedá a plánový tvar by
 * se nepřeložil. Chování je stejné, jen se `undefined` normalizuje na hranici portu.
 */
export async function subscribe(
  ctx: WorkspaceContext,
  input: SubscribeInput,
  ports: SubscribePorts,
): Promise<SubscribeResult> {
  void ctx;
  const list = await ports.findList(input.listId);
  // Neexistující seznam není veřejný povrch: sem se dá dostat jen s ID, které volající zná,
  // a mlčení by z chyby v integraci udělalo tichý propad zápisů.
  if (list === null) throw new ApiError('not_found');

  const normalized = normalizeEmail(input.email);
  if (!normalized.ok) {
    return {
      response: 'accepted',
      outcome: 'invalid_email',
      contactId: null,
      subscriptionStatus: null,
    };
  }
  const email = normalized.email;
  const now = ports.now();

  const suppression = await ports.checkSuppression(email);
  if (
    suppression !== null &&
    suppression.removedAt === null &&
    HARD_BLOCK_REASONS.has(suppression.reason)
  ) {
    // Nic se nezakládá, nic se neposílá, ani vyžádaná věc: suppression zakazuje odeslání.
    return {
      response: 'accepted',
      outcome: suppression.reason === 'complaint' ? 'blocked_complaint' : 'blocked_suppressed',
      contactId: null,
      subscriptionStatus: null,
    };
  }

  const contact = await ports.upsertContact({
    email,
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    attributes: input.attributes ?? {},
    locale: input.locale ?? null,
    source: input.source,
    sourceRef: input.sourceRef ?? null,
  });

  const existing = await ports.readSubscription(contact.contactId, list.id);
  const from = existing?.status ?? 'none';

  const decision = transition(from, {
    kind: 'subscribe',
    optIn: list.optIn,
    source: input.source,
    suppression,
    ...(input.skipConfirmation === undefined ? {} : { skipConfirmation: input.skipConfirmation }),
    ...(input.declaration === undefined ? {} : { declaration: input.declaration }),
    now,
  });

  if (!decision.allowed) {
    return {
      response: 'accepted',
      outcome:
        decision.code === 'subscribe_blocked_complaint'
          ? 'blocked_complaint'
          : 'blocked_suppressed',
      contactId: contact.contactId,
      subscriptionStatus: from === 'none' ? null : from,
    };
  }

  // Vyžádaná věc jde ven bez ohledu na to, jak dopadne samotné přihlášení.
  const deliverable = input.deliverable ?? '';
  if (deliverable !== '') {
    await ports.deliverRequestedItem({ contactId: contact.contactId, deliverable });
  }

  if (decision.next === 'confirmed' && from === 'confirmed') {
    // Už potvrzený kontakt: nic se nemění a žádný e-mail od nás navíc nepřijde.
    return {
      response: 'accepted',
      outcome: 'already_confirmed',
      contactId: contact.contactId,
      subscriptionStatus: 'confirmed',
    };
  }

  if (decision.next === 'confirmed') {
    await ports.writeSubscription({
      contactId: contact.contactId,
      listId: list.id,
      status: 'confirmed',
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      confirmedAt: now,
    });
    await ports.recordConsent({
      contactId: contact.contactId,
      scopeListId: list.id,
      status: 'granted',
      source: input.source === 'form' ? 'form' : input.source,
      consentText: input.consentText ?? null,
      evidence: {
        ip: input.requestIp ?? null,
        user_agent: input.userAgent ?? null,
        page_url: input.pageUrl ?? null,
        declaration: input.declaration === true,
      },
      occurredAt: now,
    });
    if (list.sendWelcome) await ports.sendWelcomeEmail({ contactId: contact.contactId, list });
    await ports.emit('contact.subscribed', {
      contact_id: contact.contactId,
      email,
      list_id: list.id,
      list_name: list.name,
      source: input.source,
      confirmed_at: now.toISOString(),
    });
    return {
      response: 'accepted',
      outcome: 'confirmed',
      contactId: contact.contactId,
      subscriptionStatus: 'confirmed',
    };
  }

  // Zbývá jediná větev: přechod do pending, tedy vydání tokenu a potvrzovací e-mail.
  const resend = canResendConfirmation({
    lastSentAt: existing?.confirmationSentAt ?? null,
    resendsIn24h: existing === null ? 0 : await ports.countResends(contact.contactId, list.id),
    maxResends: list.confirmationMaxResends,
    now,
  });

  if (!resend.ok) {
    // Stav se zapíše i tak: člověk o přihlášení požádal a pending o tom musí být záznam.
    await ports.writeSubscription({
      contactId: contact.contactId,
      listId: list.id,
      status: 'pending',
      source: input.source,
      sourceRef: input.sourceRef ?? null,
    });
    return {
      response: 'accepted',
      outcome: 'resend_throttled',
      contactId: contact.contactId,
      subscriptionStatus: 'pending',
    };
  }

  await ports.writeSubscription({
    contactId: contact.contactId,
    listId: list.id,
    status: 'pending',
    source: input.source,
    sourceRef: input.sourceRef ?? null,
    confirmationSentAt: now,
    bumpResends: existing !== null,
  });

  const { token } = await ports.issueConfirmation({
    contactId: contact.contactId,
    listId: list.id,
    ttlHours: list.confirmationTtlHours,
  });
  await ports.sendConfirmationEmail({ contactId: contact.contactId, list, token });

  return {
    response: 'accepted',
    outcome: 'confirmation_sent',
    contactId: contact.contactId,
    subscriptionStatus: 'pending',
  };
}
