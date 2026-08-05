import { describe, expect, it } from 'vitest';
import type { SegmentAst } from './ast';
import { activityDependentSegmentIds, isActivityDependent } from './activity';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

function ast(...children: SegmentAst['root']['children']): SegmentAst {
  return { version: 1, root: { type: 'group', op: 'and', children } };
}

const statusEq = {
  type: 'condition',
  field: { kind: 'contact', key: 'status' },
  operator: 'eq',
  value: 'active',
} as const;

const lastActivity = {
  type: 'condition',
  field: { kind: 'contact', key: 'last_activity_at' },
  operator: 'not_in_last_days',
  value: 90,
} as const;

const webEvent = {
  type: 'condition',
  field: { kind: 'event', name: 'purchase', since_days: 30 },
  operator: 'did',
} as const;

const engagementOpened = {
  type: 'condition',
  field: { kind: 'engagement', metric: 'opened', scope: { since_days: 30 } },
  operator: 'did_not',
} as const;

function segmentRef(id: string) {
  return {
    type: 'condition',
    field: { kind: 'segment', segment_id: id },
    operator: 'is_member',
  } as const;
}

describe('závislost segmentu na aktivitě kontaktu', () => {
  it('webová událost dělá ze segmentu závislý', () => {
    expect(isActivityDependent(ast(webEvent))).toBe(true);
  });

  it('last_activity_at dělá ze segmentu závislý', () => {
    expect(isActivityDependent(ast(lastActivity))).toBe(true);
  });

  it('běžné pole kontaktu závislost nezakládá', () => {
    expect(isActivityDependent(ast(statusEq))).toBe(false);
  });

  /**
   * Nejdůležitější negativní případ. `engagement.*` plní doména trackingu
   * z `message_events`, ne webová událost, takže by přepočet po každé návštěvě
   * stránky byl čistá zátěž navíc. Kdyby se to změnilo, spadne tenhle test.
   */
  it('engagement metriky nejsou webová aktivita', () => {
    expect(isActivityDependent(ast(engagementOpened))).toBe(false);
  });

  it('najde závislost i ve vnořené skupině', () => {
    const nested = ast({
      type: 'group',
      op: 'or',
      children: [statusEq, webEvent],
    });
    expect(isActivityDependent(nested)).toBe(true);
  });

  it('segment odkazující na závislý segment je závislý taky', () => {
    const found = activityDependentSegmentIds([
      { id: A, definition: ast(webEvent) },
      { id: B, definition: ast(statusEq, segmentRef(A)) },
      { id: C, definition: ast(statusEq) },
    ]);
    expect([...found].sort()).toEqual([A, B].sort());
  });

  it('odkaz na nezávislý segment závislost nezakládá', () => {
    const found = activityDependentSegmentIds([
      { id: A, definition: ast(statusEq) },
      { id: B, definition: ast(segmentRef(A)) },
    ]);
    expect([...found]).toEqual([]);
  });

  it('odkazy se sbírají i z větve, kde už závislost padla', () => {
    // `scan` nesmí po nálezu přestat procházet strom: kdyby ano, odkaz na B
    // by se do grafu nedostal a C by zůstalo mimo množinu.
    const found = activityDependentSegmentIds([
      { id: A, definition: ast(webEvent, segmentRef(B)) },
      { id: B, definition: ast(statusEq) },
      { id: C, definition: ast(segmentRef(A)) },
    ]);
    expect([...found].sort()).toEqual([A, C].sort());
  });

  it('nečitelná definice se počítá jako závislá, ne jako nezávislá', () => {
    expect(isActivityDependent({ version: 1 })).toBe(true);
    expect(isActivityDependent(null)).toBe(true);
  });

  it('prázdný vstup vrátí prázdnou množinu', () => {
    expect(activityDependentSegmentIds([]).size).toBe(0);
  });
});
