import { z } from 'zod';

export const CONTACT_FIELD_KEYS = [
  'email',
  'email_domain',
  'first_name',
  'last_name',
  'gender',
  'status',
  'locale',
  'source',
  'created_at',
  'updated_at',
  'last_activity_at',
  'vocative_confidence',
  'processing_restricted',
] as const;

export type ContactFieldKey = (typeof CONTACT_FIELD_KEYS)[number];

export const ENGAGEMENT_METRICS = ['sent', 'delivered', 'opened', 'clicked', 'bounced'] as const;

export type EngagementMetric = (typeof ENGAGEMENT_METRICS)[number];

export const CONSENT_PURPOSES = [
  'email_marketing',
  'analytics',
  'personalization',
  'profiling',
  'third_party',
] as const;

/**
 * Čtyřicet unikátních kódů (rozhodnutí R7). Počet hlídá test, aby se matice
 * nedala tiše rozšířit ani zúžit.
 */
export const OPERATORS = [
  'eq',
  'neq',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'in',
  'not_in',
  'is_empty',
  'is_not_empty',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'is_true',
  'is_false',
  'on',
  'before',
  'after',
  'in_last_days',
  'not_in_last_days',
  'in_next_days',
  'has_any',
  'has_all',
  'has_none',
  'is_member',
  'is_not_member',
  'is_confirmed',
  'is_pending',
  'is_unsubscribed',
  'is_granted',
  'is_withdrawn',
  'is_missing',
  'is_suppressed',
  'is_not_suppressed',
  'did',
  'did_not',
  'count_gte',
  'count_lte',
] as const;

export type Operator = (typeof OPERATORS)[number];

const ScalarValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const EngagementScope = z
  .object({
    campaign_id: z.uuid().optional(),
    since_days: z.number().int().min(1).max(730).optional(),
    last_n_campaigns: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export const FieldRef = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('contact'), key: z.enum(CONTACT_FIELD_KEYS) }).strict(),
  z.object({ kind: z.literal('attribute'), key: z.string().min(1).max(64) }).strict(),
  z.object({ kind: z.literal('tag') }).strict(),
  z.object({ kind: z.literal('list'), list_id: z.uuid() }).strict(),
  z.object({ kind: z.literal('consent'), purpose: z.enum(CONSENT_PURPOSES) }).strict(),
  z.object({ kind: z.literal('suppression') }).strict(),
  z
    .object({
      kind: z.literal('engagement'),
      metric: z.enum(ENGAGEMENT_METRICS),
      scope: EngagementScope,
    })
    .strict(),
  z
    .object({
      kind: z.literal('event'),
      name: z.string().min(1).max(64),
      property: z.string().max(64).optional(),
      since_days: z.number().int().min(1).max(3650).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('segment'), segment_id: z.uuid() }).strict(),
]);

export const ConditionNodeSchema = z
  .object({
    type: z.literal('condition'),
    field: FieldRef,
    operator: z.enum(OPERATORS),
    value: ScalarValue.optional(),
    values: z.array(ScalarValue).min(1).max(1000).optional(),
  })
  .strict();

export type ConditionNode = z.infer<typeof ConditionNodeSchema>;

export type FieldRefValue = ConditionNode['field'];

export type GroupNode = {
  type: 'group';
  op: 'and' | 'or';
  not?: boolean | undefined;
  children: Node[];
};

export type Node = GroupNode | ConditionNode;

/**
 * `children` je minimálně jedno schválně: skupina bez podmínek nemá v SQL co
 * vygenerovat. Prázdný segment znamená „všichni kontakty" a to zajistí obálka
 * sama, viz `buildEnvelope`.
 */
export const GroupNodeSchema: z.ZodType<GroupNode> = z.lazy(() =>
  z
    .object({
      type: z.literal('group'),
      op: z.enum(['and', 'or']),
      not: z.boolean().optional(),
      children: z
        .array(z.union([GroupNodeSchema, ConditionNodeSchema]))
        .min(1)
        .max(50),
    })
    .strict(),
);

export const SegmentAstV1 = z.object({ version: z.literal(1), root: GroupNodeSchema }).strict();

export type SegmentAst = z.infer<typeof SegmentAstV1>;

/** Náhrada za prázdný segment, kterou AST unese: „e-mail je vyplněný". */
export const EMPTY_AST: SegmentAst = {
  version: 1,
  root: {
    type: 'group',
    op: 'and',
    children: [
      { type: 'condition', field: { kind: 'contact', key: 'status' }, operator: 'is_not_empty' },
    ],
  },
};
