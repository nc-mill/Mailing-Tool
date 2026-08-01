import type { AudiencePort } from '../ports';
import type { CampaignAudience } from '../types';

/**
 * Vstup skladani publika.
 *
 * `workspaceId` je tady OBSAH, ne autorizace: predava se kompilatoru casti 2 jako
 * hodnota do jeho poddotazu. Autorizaci drzi transakcni kontext, ktery otevira
 * volajici. Pojmenovany typ existuje proto, ze `scope.test.ts` zakazuje exportovanou
 * funkci mimo `packages/core/src/tx` s parametrem `workspaceId: string` primo
 * v seznamu parametru; vzorem je `IssueUnsubscribeTokenInput` v domene kontaktu.
 */
export type BuildAudienceSqlInput = {
  workspaceId: string;
  audience: CampaignAudience;
  paramOffset: number;
  asOf: Date;
  targetAlias?: string;
};

/**
 * Kompilator casti 2 bere jen sjednoceni (segmentIds, listIds), kdezto CampaignAudience
 * ma include i exclude. Skladame tedy dve volani:
 *
 *   publikum = (sjednoceni include.lists a include.segments)
 *              minus (sjednoceni exclude.lists a exclude.segments)
 *
 * include je sjednoceni, ne prunik. Prunik se dela segmentem, protoze segment uz umi AND.
 * Vlastni SQL nad contacts tim nevznika: obe strany generuje kompilator vcetne sve
 * ctyrclenne obalky (workspace_id, deleted_at, processing_restricted, suppression).
 */
export async function buildAudienceSql(
  port: AudiencePort,
  input: BuildAudienceSqlInput,
): Promise<{ sql: string; params: unknown[]; nextParamOffset: number }> {
  const target = input.targetAlias ?? 'c';

  const include = await port.compileToSql({
    workspaceId: input.workspaceId,
    selection: {
      listIds: input.audience.include.lists,
      segmentIds: input.audience.include.segments,
    },
    alias: 'inc',
    paramOffset: input.paramOffset,
    asOf: input.asOf,
  });

  const params = [...include.params];
  let sql = `${target}.id IN (${include.sql})`;

  const hasExclude =
    input.audience.exclude.lists.length + input.audience.exclude.segments.length > 0;

  if (hasExclude) {
    const exclude = await port.compileToSql({
      workspaceId: input.workspaceId,
      selection: {
        listIds: input.audience.exclude.lists,
        segmentIds: input.audience.exclude.segments,
      },
      alias: 'exc',
      paramOffset: input.paramOffset + include.params.length,
      asOf: input.asOf,
    });
    params.push(...exclude.params);
    sql += ` AND ${target}.id NOT IN (${exclude.sql})`;
  }

  return { sql, params, nextParamOffset: input.paramOffset + params.length };
}
