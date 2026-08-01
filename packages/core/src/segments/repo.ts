import { loadConfig } from '../config/index';
import type { WorkspaceContext } from '../identity/types';
import { invalidAst } from './errors';
import { SegmentAstV1, type SegmentAst } from './ast';
import { assertWithinLimits } from './limits';
import { resolveReferences } from './references';
import { compileSegmentSql } from './compile/index';
import { buildEnvelope } from './compile/envelope';
import { ParamBag } from './compile/params';
import { toSql } from './compile/params';
import { compileListCondition } from './compile/tag-list-consent';
import { compileSegmentRefCondition } from './compile/segment-ref';
import type { SegmentWarning } from './compile/engagement-event';
import { runCountWithEstimate, runReadOnly } from './sql-runner';

export type Audience = { segmentIds?: string[]; listIds?: string[]; ast?: SegmentAst };
export type CompileOpts = { alias: string; paramOffset: number; asOf: Date; timezone: string };
export type Compiled = { sql: string; params: unknown[]; warnings: string[] };

let previewTimeoutMs: number | null = null;

function defaultTimeoutMs(): number {
  previewTimeoutMs ??= loadConfig().SEGMENT_PREVIEW_TIMEOUT_MS;
  return previewTimeoutMs;
}

/** Jen pro testy: zapomene načtenou konfiguraci. */
export function resetSegmentRepoConfig(): void {
  previewTimeoutMs = null;
}

/**
 * Jediná podporovaná cesta, jak sestavit publikum. Část 4 nesmí psát vlastní SQL
 * nad contacts, list_subscriptions ani suppressions. Obálku, kterou tahle funkce
 * přidá, volající nemůže vynechat.
 */
export async function compileAudienceToSql(
  ctx: WorkspaceContext,
  audience: Audience,
  opts: CompileOpts,
): Promise<Compiled> {
  const hasSomething =
    (audience.segmentIds?.length ?? 0) + (audience.listIds?.length ?? 0) > 0 ||
    audience.ast != null;
  if (!hasSomething) invalidAst('audience', 'audience_empty', 'audience selects nothing');

  const parts: string[] = [];
  const warnings: SegmentWarning[] = [];
  const bag = new ParamBag(opts.paramOffset);
  bag.add(ctx.workspaceId, 'uuid');
  bag.add(opts.asOf.toISOString(), 'timestamptz');
  bag.add(opts.timezone);

  if (audience.ast) {
    const ast = SegmentAstV1.parse(audience.ast);
    assertWithinLimits(ast);
    const refs = await resolveReferences(ctx, ast);
    // Kompilace uzlů běží nad vlastním ParamBagem, jehož offset navazuje za pevné
    // parametry a jehož první tři hodnoty jsou tytéž tři pevné.
    const inner = compileSegmentSql(ast, {
      alias: opts.alias,
      paramOffset: opts.paramOffset,
      workspaceId: ctx.workspaceId,
      asOf: opts.asOf,
      timezone: opts.timezone,
      fieldClasses: refs.fieldClasses,
      segmentKinds: refs.segmentKinds,
    });
    parts.push(inner.sql);
    warnings.push(...inner.warnings);
    bag.values.length = 0;
    bag.values.push(...inner.params);
  }

  for (const listId of audience.listIds ?? []) {
    parts.push(compileListCondition(opts.alias, listId, 'is_member', bag));
  }
  for (const segmentId of audience.segmentIds ?? []) {
    const refs = await resolveReferences(ctx, {
      version: 1,
      root: {
        type: 'group',
        op: 'and',
        children: [
          {
            type: 'condition',
            field: { kind: 'segment', segment_id: segmentId },
            operator: 'in',
          },
        ],
      },
    });
    const target = refs.segmentKinds[segmentId];
    if (target === undefined) throw new Error(`segment ${segmentId} was not resolved`);
    parts.push(
      compileSegmentRefCondition(opts.alias, segmentId, 'in', target, bag, (childAlias) => {
        const childAst = target.ast;
        if (childAst === undefined) throw new Error('dynamic segment without ast');
        return compileSegmentSql(childAst, {
          alias: childAlias,
          paramOffset: opts.paramOffset,
          workspaceId: ctx.workspaceId,
          asOf: opts.asOf,
          timezone: opts.timezone,
          fieldClasses: refs.fieldClasses,
          segmentKinds: refs.segmentKinds,
        }).sql;
      }),
    );
  }

  // segmentIds a listIds zároveň znamenají sjednocení: "kdo je v kterémkoliv
  // z těchhle seznamů nebo segmentů". Odpovídá to tomu, jak se publikum skládá v UI.
  const audienceSql = parts.length === 1 ? (parts[0] as string) : `(${parts.join(') OR (')})`;
  return {
    sql: buildEnvelope(opts.alias, audienceSql, bag),
    params: bag.values,
    warnings: [...new Set(warnings)],
  };
}

export type SegmentCountResult = {
  count: number;
  exact: boolean;
  durationMs: number;
  warnings: string[];
};

export async function countSegment(
  ctx: WorkspaceContext,
  ast: SegmentAst,
  opts: { timeoutMs?: number; asOf?: Date; timezone?: string } = {},
): Promise<SegmentCountResult> {
  const asOf = opts.asOf ?? new Date();
  const timezone = opts.timezone ?? 'Europe/Prague';
  const compiled = await compileAudienceToSql(
    ctx,
    { ast },
    {
      alias: 'a',
      paramOffset: 0,
      asOf,
      timezone,
    },
  );
  // Projekce se mění, podmínky zůstávají bajt za bajt tytéž jako u publika kampaně.
  // Kdyby se lišily, uživatel by viděl 12 000 a odeslalo by se 11 300.
  const countSql = compiled.sql.replace(
    'SELECT a.id AS contact_id',
    'SELECT count(*)::int AS count',
  );
  const out = await runCountWithEstimate(
    ctx,
    countSql,
    compiled.params,
    opts.timeoutMs ?? defaultTimeoutMs(),
  );
  return {
    ...out,
    warnings: out.exact ? compiled.warnings : [...compiled.warnings, 'segment_count_estimated'],
  };
}

export type ContactSample = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
};

export async function listSegmentContacts(
  ctx: WorkspaceContext,
  ast: SegmentAst,
  page: { limit: number; cursor?: string },
  opts: { asOf?: Date; timezone?: string } = {},
): Promise<{ rows: ContactSample[]; hasMore: boolean }> {
  const asOf = opts.asOf ?? new Date();
  const timezone = opts.timezone ?? 'Europe/Prague';
  const compiled = await compileAudienceToSql(
    ctx,
    { ast },
    {
      alias: 'a',
      paramOffset: 0,
      asOf,
      timezone,
    },
  );
  const params = [...compiled.params];
  const projected = compiled.sql.replace(
    'SELECT a.id AS contact_id',
    'SELECT a.id, a.email::text AS email, a.first_name, a.last_name',
  );
  // Řazení a stránkování si dělá volající, kompilátor je do sql nikdy nevkládá.
  const cursorClause =
    page.cursor === undefined ? '' : ` AND a.id > $${params.push(page.cursor)}::uuid`;
  const text = `${projected}${cursorClause}\n ORDER BY a.id ASC\n LIMIT $${params.push(page.limit + 1)}`;
  const { rows } = await runReadOnly(ctx, (tx) => tx.execute<ContactSample>(toSql(text, params)));
  return { rows: rows.slice(0, page.limit), hasMore: rows.length > page.limit };
}
