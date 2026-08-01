import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_TRANSITIONS,
  allowedFrom,
  canTransition,
  assertTransition,
} from '../state-machine';

describe('stavovy stroj kampane', () => {
  it('draft smi na scheduled a queueing, nikam jinam', () => {
    expect(allowedFrom('draft').sort()).toEqual(['queueing', 'scheduled']);
  });

  it('queueing smi na paused, coz drivejsi zneni zakazovalo', () => {
    expect(canTransition('queueing', 'paused')).toBe(true);
  });

  it('paused se vraci do queueing i do sending', () => {
    expect(canTransition('paused', 'queueing')).toBe(true);
    expect(canTransition('paused', 'sending')).toBe(true);
  });

  it.each([
    ['sent', 'sending'],
    ['cancelled', 'sending'],
    ['paused', 'sent'],
    ['sending', 'draft'],
    ['partially_sent', 'draft'],
  ] as const)('zakazany prechod %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('failed se smi vratit do draftu, protoze nic neodeslo', () => {
    expect(canTransition('failed', 'draft')).toBe(true);
  });

  it('assertTransition vyhodi chybu s kodem invalid_state_transition', () => {
    expect(() => assertTransition('sent', 'sending')).toThrowError(/invalid_state_transition/);
  });

  it('kazdy stav z vyctu ma radek v tabulce prechodu', () => {
    expect(Object.keys(CAMPAIGN_TRANSITIONS).sort()).toEqual([
      'cancelled',
      'draft',
      'failed',
      'partially_sent',
      'paused',
      'queueing',
      'schedule_missed',
      'scheduled',
      'sending',
      'sent',
    ]);
  });
});
