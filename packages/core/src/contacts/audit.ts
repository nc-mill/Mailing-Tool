import { defineAuditActions } from '../audit/action';
import { writeAuditLog } from '../audit/write';
import { actorInfo } from '../identity/types';
import type { WorkspaceContext } from '../identity/types';
import type { Tx } from '../tx';

/**
 * Názvy auditních akcí vlastněné částí 2, podle kapitoly 7.5.
 * Konvence: <entita v jednotném čísle>.<sloveso v minulém čase> (kapitola 3.7 části 1).
 *
 * U contact.anonymized a contact.purged se do metadat NIKDY neukládá e-mail, jen otisk.
 */
export const CONTACTS_AUDIT_ACTIONS = [
  'contact.created',
  'contact.updated',
  'contact.deleted',
  'contact.anonymized',
  'contact.purged',
  'contact.restored',
  'contact.email_changed',
  'contact.bulk_deleted',
  'contact.vocative_lock_released',
  'contact.vocative_bulk_confirmed',
  // Zrušení pozastavení odběru. Je to zásah správce do rozhodnutí, které za sebe
  // udělal sám kontakt na stránce předvoleb, takže musí být dohledatelný.
  'contact.snooze_cancelled',
  // Zápis prošel, ale seznam nebo souhlas se kvůli živé suppression nezapsal (pravidlo 4).
  // Tiché zahození bez stopy je u projevu vůle příjemce nepřijatelné: kdo se ptá, proč
  // se člověk po importu neobjevil v seznamu, musí najít odpověď, ne mlčení.
  'contact.suppressed_write_skipped',
  'contact.processing_restricted',
  'contact.processing_restriction_lifted',
  'field.created',
  'field.archived',
  'field.deleted',
  'field.indexed',
  'tag.created',
  'tag.merged',
  // Smazání štítku bere kaskádou i všechny jeho vazby na kontakty, takže musí být
  // dohledatelné stejně jako sloučení. Bez téhle položky se `deleteTag` nezkompiluje.
  'tag.deleted',
  'list.created',
  'list.archived',
  'list.default_changed',
  'list.opt_in_changed',
  'subscription.forced_confirmed',
  'suppression.added',
  'suppression.reason_promoted',
  'suppression.removed',
  'form.created',
  'form.double_opt_in_disabled',
  'inbound.mapping_changed',
  'gdpr.request_created',
  'gdpr.request_completed',
  'gdpr.request_rejected',
  // Prodloužení lhůty podle čl. 12 odst. 3 se musí dát obhájit před dozorovým úřadem,
  // takže patří do auditu stejně jako zamítnutí. Bez téhle položky se
  // `extendGdprRequest` nezkompiluje.
  'gdpr.request_extended',
  'gdpr.exported',
  'gdpr.erased',
  'retention.policy_changed',
  'retention.run_completed',
  'name_override.created',
] as const;

export type ContactsAuditAction = (typeof CONTACTS_AUDIT_ACTIONS)[number];

/**
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. Plán počítal se sdíleným typovým unionem
 * `AuditAction` skládaným v `packages/core/identity`. P01 ho vědomě nezaložil, protože
 * jeden soubor s unionem všech akcí by byl konflikt v každém z šestnácti plánů, a místo
 * něj má branded typ plněný `defineAuditActions`. Registrace tedy není řádek v cizím
 * souboru, ale tenhle jeden řádek tady; jedinečnost napříč doménami hlídá mechanicky
 * `packages/core/src/audit/audit-actions.test.ts`.
 */
export const ContactsAuditActions = defineAuditActions(CONTACTS_AUDIT_ACTIONS);

/** Klíče, které se z metadat auditu vždy vyřadí, i kdyby je volající předal. */
export const AUDIT_REDACTED_KEYS = ['email', 'raw_line', 'payload', 'secret'] as const;

/**
 * Tenký adaptér nad zapisovačem auditu z P04.
 *
 * P04 vystavuje `writeAuditLog(tx, entry)` s plnou položkou, tedy včetně `workspaceId`
 * a `actor` ve tvaru `AuditActorInfo`. Doménový kód má v ruce `WorkspaceContext`, takže
 * by to jinak musel rozbalovat na šedesáti místech. Adaptér ten překlad dělá jednou.
 *
 * Funkce se jmenuje `writeAudit`, protože pod tím jménem ji volá celý zbytek tohohle
 * plánu; zapisovač si NEPÍŠE, jen mapuje kontext a deleguje. Kdyby si psala vlastní
 * INSERT, obešla by redakci metadat, kterou P04 dělá v `writeAuditLog`, a e-mail by
 * se do auditu dostal přesně tou cestou, které se plán jinde vyhýbá.
 */
export async function writeAudit(
  tx: Tx,
  ctx: WorkspaceContext,
  entry: {
    action: ContactsAuditAction;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await writeAuditLog(tx, {
    action: ContactsAuditActions[entry.action],
    workspaceId: ctx.workspaceId,
    actor: actorInfo(ctx.actor, actorLabelOf(ctx)),
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    metadata: entry.metadata ?? {},
  });
}

/**
 * Popisek aktéra je ZMRAZENÝ TEXT, ne odkaz: po smazání uživatele musí audit dál
 * dávat smysl.
 *
 * ODCHYLKA OD PLÁNU: plán četl `ctx.actor.label`. Typ `Actor` z `@mlain/db` žádné
 * pole `label` nemá (user má userId a role, api_key má apiKeyId a scopes), takže by
 * se to nezkompilovalo. Popisek se proto skládá z identifikátoru, který kontext nese.
 * Volající, který má po ruce e-mail nebo jméno klíče, si zapíše audit s bohatším
 * popiskem přímo přes `writeAuditLog`.
 */
function actorLabelOf(ctx: WorkspaceContext): string {
  switch (ctx.actor.type) {
    case 'user':
      return ctx.actor.userId;
    case 'api_key':
      return `api_key:${ctx.actor.apiKeyId}`;
    case 'system':
      return ctx.actor.job;
  }
}
