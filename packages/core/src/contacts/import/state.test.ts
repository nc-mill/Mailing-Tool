import { describe, expect, it } from 'vitest';
import { buildIdempotencyKey } from './idempotency';
import { assertTransition, TERMINAL_STATES } from './state';
import { importErrorCode } from './errors';

const sha = Buffer.alloc(32, 1);
const ws = '00000000-0000-0000-0000-000000000001';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return importErrorCode(error);
  }
}

describe('idempotency', () => {
  it('is stable for the same file, mapping and options', () => {
    const a = buildIdempotencyKey({
      contentSha256: sha,
      workspaceId: ws,
      mapping: { '0': { target: 'email' } },
      options: { on_conflict: 'update' },
    });
    const b = buildIdempotencyKey({
      contentSha256: sha,
      workspaceId: ws,
      mapping: { '0': { target: 'email' } },
      options: { on_conflict: 'update' },
    });
    expect(a).toBe(b);
  });

  it('changes when the mapping changes, because that is a different import', () => {
    const a = buildIdempotencyKey({
      contentSha256: sha,
      workspaceId: ws,
      mapping: { '0': { target: 'email' } },
      options: {},
    });
    const b = buildIdempotencyKey({
      contentSha256: sha,
      workspaceId: ws,
      mapping: { '0': { target: 'first_name' } },
      options: {},
    });
    expect(a).not.toBe(b);
  });

  it('changes with a force nonce', () => {
    const a = buildIdempotencyKey({
      contentSha256: sha,
      workspaceId: ws,
      mapping: {},
      options: {},
    });
    const b = buildIdempotencyKey({
      contentSha256: sha,
      workspaceId: ws,
      mapping: {},
      options: {},
      nonce: 'abc',
    });
    expect(a).not.toBe(b);
  });
});

describe('state machine', () => {
  it('allows the documented path', () => {
    for (const [from, to] of [
      ['pending', 'validating'],
      ['validating', 'previewing'],
      ['previewing', 'importing'],
      ['importing', 'completed'],
    ] as const) {
      expect(() => assertTransition(from, to)).not.toThrow();
    }
  });

  it('forbids going back from previewing to validating', () => {
    expect(codeOf(() => assertTransition('previewing', 'validating'))).toBe(
      'invalid_state_transition',
    );
  });

  it('forbids leaving any terminal state', () => {
    for (const state of TERMINAL_STATES) {
      expect(codeOf(() => assertTransition(state, 'importing'))).toBe('invalid_state_transition');
    }
  });
});
