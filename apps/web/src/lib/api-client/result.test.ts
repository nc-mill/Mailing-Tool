import { describe, expect, it } from 'vitest';
import { localProblem } from './problem';
import { err, isOk, ok, unwrapOr, type Result } from './result';

const PROBLEM = localProblem({ code: 'service_unavailable', instance: '/api/v1/members' });

describe('Result', () => {
  it('ok nese data', () => {
    const result = ok({ count: 3 });
    expect(result.ok).toBe(true);
    expect(isOk(result)).toBe(true);
    if (result.ok) expect(result.data.count).toBe(3);
  });

  it('err nese Problem', () => {
    const result: Result<number> = err(PROBLEM);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.code).toBe('service_unavailable');
  });

  it('unwrapOr vrátí data nebo náhradu', () => {
    expect(unwrapOr(ok(7), 0)).toBe(7);
    expect(unwrapOr(err(PROBLEM) as Result<number>, 0)).toBe(0);
  });

  it('zúžení typu funguje bez přetypování', () => {
    const result: Result<{ id: string }> = ok({ id: 'a' });
    if (isOk(result)) {
      const id: string = result.data.id;
      expect(id).toBe('a');
    }
  });
});
