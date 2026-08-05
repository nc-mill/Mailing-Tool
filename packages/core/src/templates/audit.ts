import { defineAuditActions } from '../audit/action';
import { writeAuditLog } from '../audit/write';
import { actorInfo, type WorkspaceContext } from '../identity/types';
import type { Tx } from '../tx';

/**
 * Auditní akce vlastněné doménou šablon. Konvence 3.7: <entita v jednotném
 * čísle>.<sloveso v minulém čase>. Jedinečnost napříč doménami hlídá
 * `packages/core/src/audit/audit-actions.test.ts`, který sbírá všechny
 * soubory `audit.ts` v jádře.
 *
 * Zapisují se JEN akce, které mění dostupnost šablony pro celý projekt.
 * Uložení návrhu tady schválně není: verzování už drží kdo a kdy měnil obsah
 * (`template_versions.created_by`), takže by audit říkal totéž podruhé.
 */
export const TEMPLATES_AUDIT_ACTIONS = [
  // Smazání je měkké, ale pro ostatní členy projektu je to zmizení šablony
  // z knihovny. Kdo se ptá „kam se poděla šablona, kterou jsme používali",
  // musí najít odpověď, ne mlčení.
  'template.deleted',
  // Vrácení zpět. Bez záznamu by v auditu zůstalo smazání a šablona by přitom
  // v knihovně zase byla, což vypadá jako chyba evidence.
  'template.restored',
  /*
   * Přejmenování. Není to kosmetika: z `design.meta.name` se skládá PŘEDMĚT
   * odesílaného e-mailu, a to na dvou místech nezávisle (`templates/test-send.ts`
   * a `contacts/forms/delivery-email.ts`). Přejmenování tedy mění, co uvidí
   * příjemce ve schránce, což je změna téže váhy jako zmizení šablony
   * z knihovny. Bez záznamu by po stížnosti „proč nám chodí e-mail s tímhle
   * předmětem" nebylo kde hledat.
   *
   * Uložení návrhu v auditu dál není a je to bez rozporu: obsah drží verze
   * (`template_versions.created_by`), kdežto jméno vlastní verzi nemá.
   */
  'template.renamed',
] as const;

export type TemplatesAuditAction = (typeof TEMPLATES_AUDIT_ACTIONS)[number];

export const TemplatesAuditActions = defineAuditActions(TEMPLATES_AUDIT_ACTIONS);

/**
 * Tenký adaptér nad zapisovačem z P04, stejný vzor jako `contacts/audit.ts`.
 * Doménový kód drží `WorkspaceContext`, zapisovač chce rozbalenou položku
 * s aktérem; překlad se dělá na jednom místě, ne u každého volání.
 */
export async function writeTemplatesAudit(
  tx: Tx,
  ctx: WorkspaceContext,
  entry: {
    action: TemplatesAuditAction;
    targetId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await writeAuditLog(tx, {
    action: TemplatesAuditActions[entry.action],
    workspaceId: ctx.workspaceId,
    actor: actorInfo(ctx.actor, actorLabelOf(ctx)),
    targetType: 'template',
    targetId: entry.targetId,
    metadata: entry.metadata ?? {},
  });
}

/**
 * Popisek aktéra je ZMRAZENÝ TEXT, ne odkaz: po smazání uživatele musí audit
 * dál dávat smysl. `Actor` z `@mlain/db` žádné pole `label` nemá, takže se
 * skládá z identifikátoru, který kontext nese.
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
