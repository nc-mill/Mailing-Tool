import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  canTransition,
  MESSAGE_STATUSES,
  TERMINAL_STATUSES,
  type TransitionActor,
  type MessageStatus,
} from '../src/outbox';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type TransitionCase = {
  id: string;
  from: MessageStatus;
  to: MessageStatus;
  actor: TransitionActor;
  error_code?: string | null;
  allowed: boolean;
};

const registry = JSON.parse(
  await readFile(path.join(packageRoot, 'fixtures', 'outbox', 'scenarios.json'), 'utf8'),
) as { transitions: TransitionCase[] };

describe('stavy a přechody messages', () => {
  it('má právě pět stavů ve tvaru z CHECK constraintu', () => {
    expect(MESSAGE_STATUSES).toEqual(['pending', 'claimed', 'sent', 'failed', 'skipped']);
  });

  it('má tři koncové stavy', () => {
    expect(TERMINAL_STATUSES).toEqual(['sent', 'failed', 'skipped']);
  });

  it('má čtrnáct případů přechodu a žádné id se neopakuje', () => {
    expect(registry.transitions).toHaveLength(14);
    expect(new Set(registry.transitions.map((c) => c.id)).size).toBe(14);
  });

  // Tytéž případy pouští Go strana přes RunOutboxTransitions nad TÍMTÉŽ souborem.
  // Kdyby si je jedna strana opsala, testovala by opis, ne kontrakt.
  it.each(registry.transitions)('$id: $from -> $to ($actor) je allowed=$allowed', (testCase) => {
    expect(
      canTransition({
        from: testCase.from,
        to: testCase.to,
        actor: testCase.actor,
        errorCode: testCase.error_code ?? undefined,
      }),
    ).toBe(testCase.allowed);
  });

  it('OB-07: pending -> sent bez claimu odmítne aplikační kontrola, ne databáze', () => {
    expect(canTransition({ from: 'pending', to: 'sent', actor: 'sender' })).toBe(false);
  });

  it('assertTransition hodí chybu s popisem, ne jen false', () => {
    expect(() => assertTransition({ from: 'sent', to: 'failed', actor: 'app' })).toThrow(
      /sent -> failed/,
    );
  });
});
