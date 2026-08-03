import { defineAuditActions } from '../audit/action';
import { writeAuditLog } from '../audit/write';
import { actorInfo, type WorkspaceContext } from '../identity/types';
import type { Tx } from '../tx';

/**
 * Auditní akce domény assetů. Tvar `<entita>.<sloveso v minulém čase>` z 3.7,
 * jedinečnost napříč doménami hlídá `audit/audit-actions.test.ts`.
 *
 * PROČ SE AUDITUJE PRÁVĚ TOHLE. Nahrání je zápis cizího souboru na disk
 * serveru a musí být dohledatelné, kdo ho tam dal. Skrytí a fyzické smazání
 * jsou pak jediné dvě operace, po kterých se obrázek přestane zobrazovat
 * v e-mailech, které už někomu leží ve schránce; když se na to někdo za půl
 * roku zeptá, musí existovat odpověď.
 *
 * Změna `alt_text` se NEAUDITUJE schválně: je to obsah, ne oprávnění ani
 * ztráta dat, a zahltila by log při běžné práci v editoru.
 */
export const ASSETS_AUDIT_ACTIONS = ['asset.uploaded', 'asset.hidden', 'asset.purged'] as const;

export type AssetsAuditAction = (typeof ASSETS_AUDIT_ACTIONS)[number];

export const AssetsAuditActions = defineAuditActions(ASSETS_AUDIT_ACTIONS);

/**
 * Tenký adaptér nad zapisovačem z P04, stejný tvar jako v doméně kontaktů.
 * Vlastní `INSERT` by obešel redakci metadat, kterou dělá `writeAuditLog`.
 */
export async function writeAssetAudit(
  tx: Tx,
  ctx: WorkspaceContext,
  entry: {
    action: AssetsAuditAction;
    targetId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await writeAuditLog(tx, {
    action: AssetsAuditActions[entry.action],
    workspaceId: ctx.workspaceId,
    actor: actorInfo(ctx.actor, actorLabelOf(ctx)),
    targetType: 'asset',
    targetId: entry.targetId,
    metadata: entry.metadata ?? {},
  });
}

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
