import { ApiError } from '../../errors/api-error';
import type { WorkspaceContext } from '../../identity/types';
import {
  canResendConfirmation,
  classifyConfirmation,
  type ConfirmationState,
} from './confirmation';
import { transition, type SubscriptionStatus, type SuppressionSnapshot } from './state-machine';
import type { ListSnapshot, SubscriptionSnapshot } from './subscribe';

export type ConfirmationMode = 'one_step' | 'two_step';

export type ConfirmationRecord = {
  id: string;
  contactId: string;
  listId: string;
  expiresAt: Date;
  consumedAt: Date | null;
};

export type ConfirmView =
  'confirm_prompt' | 'done' | 'expired' | 'expired_resent' | 'already_used' | 'invalid';

export type ConfirmPageResult = { view: ConfirmView; autoSubmit: boolean; status: 200 };

export type ConfirmResult = {
  view: ConfirmView;
  status: 200;
  autoSubmit: boolean;
  listName: string | null;
};

export type ConfirmPorts = {
  now(): Date;
  findConfirmation(token: string): Promise<ConfirmationRecord | null>;
  consumeConfirmation(
    token: string,
    options: { consumedIp: string | null },
  ): Promise<ConfirmationRecord | null>;
  findList(listId: string): Promise<(ListSnapshot & { confirmationMode: ConfirmationMode }) | null>;
  readSubscription(contactId: string, listId: string): Promise<SubscriptionSnapshot | null>;
  writeSubscription(input: {
    contactId: string;
    listId: string;
    status: SubscriptionStatus;
    source: 'double_opt_in';
    confirmedAt?: Date | null;
    confirmationSentAt?: Date | null;
    bumpResends?: boolean;
  }): Promise<void>;
  checkSuppression(contactId: string): Promise<SuppressionSnapshot | null>;
  removeUnsubscribeSuppression(contactId: string): Promise<void>;
  activateContact(contactId: string): Promise<void>;
  recordConsent(input: {
    contactId: string;
    scopeListId: string | null;
    status: 'granted';
    source: 'double_opt_in';
    evidence: Record<string, unknown>;
    occurredAt: Date;
  }): Promise<void>;
  sendWelcomeEmail(input: { contactId: string; list: ListSnapshot }): Promise<void>;
  issueConfirmation(input: {
    contactId: string;
    listId: string;
    ttlHours: number;
  }): Promise<{ token: string }>;
  sendConfirmationEmail(input: {
    contactId: string;
    list: ListSnapshot;
    token: string;
  }): Promise<void>;
  countResends(contactId: string, listId: string): Promise<number>;
  emit(type: 'contact.subscribed', data: Record<string, unknown>): Promise<void>;
};

/**
 * Potvrzení provádí vždy POST, nikdy GET, a to v OBOU režimech (rozhodnutí R2 plánu).
 *
 * Kapitola 4.8.3 části 2 popisuje 'one_step' jako "GET potvrdí rovnou". Zadavatel zvolil
 * variantu s vyšší konverzí, ale s výslovnou podmínkou, že potvrzuje POST: firemní
 * bezpečnostní skenery a náhledové služby odkazy v e-mailech samy proklikávají metodou GET
 * a přihlásily by lidi, kteří o tom nevědí. Rozdíl mezi režimy je tím jen v tom, jestli
 * formulář odešle za uživatele skript, nebo jestli musí kliknout na tlačítko.
 *
 * Tuhle funkci volá jak route handler, tak server action. Vynechat ji nesmí ani jeden.
 */
export function assertConfirmMethod(method: string, _mode: ConfirmationMode): void {
  if (method !== 'POST') throw new ApiError('method_not_allowed');
}

/**
 * Co uvidí návštěvník na GET podle tabulky 4.8.4. Návratový kód je vždy 200, nikdy 404:
 * rozdílný kód by z potvrzovací stránky udělal nástroj na zjišťování, kdo je v databázi.
 */
export function confirmationPageView(
  state: ConfirmationState,
  mode: ConfirmationMode,
): ConfirmPageResult {
  switch (state) {
    case 'valid':
      // autoSubmit je jediný rozdíl mezi režimy. Skript odešle formulář za uživatele,
      // bez JavaScriptu zůstane na stránce tlačítko a stránka funguje dál.
      return { view: 'confirm_prompt', autoSubmit: mode === 'one_step', status: 200 };
    case 'expired':
      return { view: 'expired', autoSubmit: false, status: 200 };
    case 'consumed':
      return { view: 'already_used', autoSubmit: false, status: 200 };
    case 'unknown':
      return { view: 'invalid', autoSubmit: false, status: 200 };
  }
}

const INVALID: ConfirmResult = { view: 'invalid', status: 200, autoSubmit: false, listName: null };

/**
 * ODCHYLKA OD PLÁNU, DROBNÁ. Plán načítal potvrzovací řádek ještě před kontrolou metody
 * (a držel ho v proměnné `list0`). Kontrola metody je tady první: požadavek, který nesmí
 * nic potvrdit, nemá důvod sahat do databáze a pořadí je tím zároveň čitelné.
 */
export async function confirmSubscription(
  ctx: WorkspaceContext,
  input: { token: string; method: 'POST'; requestIp?: string | null; userAgent?: string | null },
  ports: ConfirmPorts,
): Promise<ConfirmResult> {
  void ctx;
  assertConfirmMethod(input.method, 'two_step');

  const record = await ports.findConfirmation(input.token);
  if (record === null) return INVALID;

  const list = await ports.findList(record.listId);
  if (list === null) return INVALID;

  const now = ports.now();
  const state = classifyConfirmation(record, now);

  if (state === 'consumed') {
    return { view: 'already_used', status: 200, autoSubmit: false, listName: list.name };
  }

  // Kontakt, který mezitím podal stížnost, nesmí projít ani s platným tokenem, a nesmí to
  // poznat: vidí tutéž generickou hlášku jako držitel neplatného odkazu.
  const suppression = await ports.checkSuppression(record.contactId);
  if (
    suppression !== null &&
    suppression.removedAt === null &&
    suppression.reason === 'complaint'
  ) {
    return INVALID;
  }

  const existing = await ports.readSubscription(record.contactId, record.listId);

  if (state === 'expired') {
    const resend = canResendConfirmation({
      lastSentAt: existing?.confirmationSentAt ?? null,
      resendsIn24h: await ports.countResends(record.contactId, record.listId),
      maxResends: list.confirmationMaxResends,
      now,
    });
    if (!resend.ok) {
      return { view: 'expired', status: 200, autoSubmit: false, listName: list.name };
    }
    const reissued = await ports.issueConfirmation({
      contactId: record.contactId,
      listId: record.listId,
      ttlHours: list.confirmationTtlHours,
    });
    await ports.writeSubscription({
      contactId: record.contactId,
      listId: record.listId,
      status: 'pending',
      source: 'double_opt_in',
      confirmationSentAt: now,
      bumpResends: true,
    });
    await ports.sendConfirmationEmail({ contactId: record.contactId, list, token: reissued.token });
    return { view: 'expired_resent', status: 200, autoSubmit: false, listName: list.name };
  }

  const from = existing?.status ?? 'none';
  const decision = transition(from, { kind: 'confirm', token: 'valid', now });
  if (!decision.allowed) return INVALID;

  // Spotřebování je podmíněné v UPDATE, takže souběžné dvojkliknutí potvrdí jen jednou.
  const consumed = await ports.consumeConfirmation(input.token, {
    consumedIp: input.requestIp ?? null,
  });
  if (consumed === null) {
    return { view: 'already_used', status: 200, autoSubmit: false, listName: list.name };
  }

  if (decision.effects.includes('remove_unsubscribe_suppression')) {
    // Návrat přes double opt-in je jediná cesta, jak zmizí global_unsubscribe
    // a one_click_unsubscribe. Je to rozhodnutí příjemce, ne marketéra (4.10.2).
    await ports.removeUnsubscribeSuppression(record.contactId);
  }

  await ports.writeSubscription({
    contactId: record.contactId,
    listId: record.listId,
    status: 'confirmed',
    source: 'double_opt_in',
    confirmedAt: now,
  });

  await ports.recordConsent({
    contactId: record.contactId,
    scopeListId: record.listId,
    status: 'granted',
    source: 'double_opt_in',
    evidence: {
      double_opt_in_at: now.toISOString(),
      confirmation_ip: input.requestIp ?? null,
      user_agent: input.userAgent ?? null,
    },
    occurredAt: now,
  });

  await ports.activateContact(record.contactId);
  if (list.sendWelcome) await ports.sendWelcomeEmail({ contactId: record.contactId, list });
  await ports.emit('contact.subscribed', {
    contact_id: record.contactId,
    list_id: record.listId,
    list_name: list.name,
    source: 'double_opt_in',
    confirmed_at: now.toISOString(),
  });

  return { view: 'done', status: 200, autoSubmit: false, listName: list.name };
}
