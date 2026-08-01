import type { GroupNode, SegmentAst } from './ast';

export type PresetKey =
  | 'never_opened'
  | 'never_clicked'
  | 'inactive_90d'
  | 'no_open_last_n'
  | 'unconfirmed_30d'
  | 'repeated_soft_bounces';

export type PresetArgs = { listId?: string };

export type SegmentPreset = {
  key: PresetKey;
  /** Klíč do katalogu segments.json, ne hotový text. */
  labelKey: string;
  explanationKey: string;
  definition: (args: PresetArgs) => SegmentAst;
};

const group = (children: GroupNode['children'], op: 'and' | 'or' = 'and'): SegmentAst => ({
  version: 1,
  root: { type: 'group', op, children },
});

export const SEGMENT_PRESETS: SegmentPreset[] = [
  {
    key: 'never_opened',
    labelKey: 'presets.neverOpened.title',
    explanationKey: 'presets.neverOpened.explanation',
    // Podmínka „dostali aspoň 3 e-maily" je podstatná: bez ní by sem spadli
    // i lidé, kterým jsme nikdy nic neposlali. Je to nejčastější chyba
    // konkurenčních nástrojů, a proto je i na kartě, ne jen v nápovědě.
    definition: () =>
      group([
        {
          type: 'condition',
          field: { kind: 'engagement', metric: 'sent', scope: {} },
          operator: 'count_gte',
          value: 3,
        },
        {
          type: 'condition',
          field: { kind: 'engagement', metric: 'opened', scope: {} },
          operator: 'did_not',
        },
      ]),
  },
  {
    key: 'never_clicked',
    labelKey: 'presets.neverClicked.title',
    explanationKey: 'presets.neverClicked.explanation',
    definition: () =>
      group([
        {
          type: 'condition',
          field: { kind: 'engagement', metric: 'sent', scope: {} },
          operator: 'count_gte',
          value: 5,
        },
        {
          type: 'condition',
          field: { kind: 'engagement', metric: 'clicked', scope: {} },
          operator: 'did_not',
        },
      ]),
  },
  {
    key: 'inactive_90d',
    labelKey: 'presets.inactive90d.title',
    explanationKey: 'presets.inactive90d.explanation',
    definition: () =>
      group([
        {
          type: 'group',
          op: 'or',
          children: [
            {
              type: 'condition',
              field: { kind: 'contact', key: 'last_activity_at' },
              operator: 'not_in_last_days',
              value: 90,
            },
            {
              type: 'condition',
              field: { kind: 'contact', key: 'last_activity_at' },
              operator: 'is_empty',
            },
          ],
        },
        {
          type: 'condition',
          field: { kind: 'contact', key: 'created_at' },
          operator: 'not_in_last_days',
          value: 90,
        },
      ]),
  },
  {
    key: 'no_open_last_n',
    labelKey: 'presets.noOpenLastN.title',
    explanationKey: 'presets.noOpenLastN.explanation',
    definition: () =>
      group([
        {
          type: 'condition',
          field: { kind: 'engagement', metric: 'sent', scope: { last_n_campaigns: 5 } },
          operator: 'count_gte',
          value: 5,
        },
        {
          type: 'condition',
          field: { kind: 'engagement', metric: 'opened', scope: { last_n_campaigns: 5 } },
          operator: 'did_not',
        },
      ]),
  },
  {
    key: 'unconfirmed_30d',
    labelKey: 'presets.unconfirmed30d.title',
    explanationKey: 'presets.unconfirmed30d.explanation',
    // Preset potřebuje seznam. Když ho volající nepředá, vznikne segment jen
    // s podmínkou na stáří a UI u něj zobrazí výběr seznamu. Tvrdá chyba by tu
    // byla horší: uživatel by na kartu klikl a dostal hlášku místo segmentu.
    definition: (args) =>
      group([
        ...(args.listId === undefined
          ? []
          : [
              {
                type: 'condition' as const,
                field: { kind: 'list' as const, list_id: args.listId },
                operator: 'is_pending' as const,
              },
            ]),
        {
          type: 'condition',
          field: { kind: 'contact', key: 'created_at' },
          operator: 'not_in_last_days',
          value: 30,
        },
      ]),
  },
  {
    key: 'repeated_soft_bounces',
    labelKey: 'presets.repeatedSoftBounces.title',
    explanationKey: 'presets.repeatedSoftBounces.explanation',
    definition: () =>
      group([
        {
          type: 'condition',
          field: { kind: 'engagement', metric: 'bounced', scope: {} },
          operator: 'count_gte',
          value: 3,
        },
        {
          type: 'condition',
          field: { kind: 'contact', key: 'status' },
          operator: 'eq',
          value: 'active',
        },
      ]),
  },
];

export function presetByKey(key: PresetKey): SegmentPreset {
  const found = SEGMENT_PRESETS.find((p) => p.key === key);
  if (!found) throw new Error(`unknown preset ${key}`);
  return found;
}
