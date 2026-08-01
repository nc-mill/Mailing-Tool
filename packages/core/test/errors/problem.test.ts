import { describe, expect, it } from 'vitest';
import { buildProblem } from '../../src/errors/problem';

describe('obálka RFC 9457', () => {
  it('poskládá povinná pole a dogeneruje type URI', () => {
    const problem = buildProblem({
      code: 'validation_failed',
      instance: '/api/v1/contacts',
      requestId: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071',
      detail: "Pole 'email' není platná e-mailová adresa.",
      errors: [{ path: 'email', code: 'invalid_email', message: 'Není platná e-mailová adresa.' }],
    });
    expect(problem).toEqual({
      type: 'https://docs.mlain.dev/errors/validation_failed',
      title: 'Validation failed',
      status: 422,
      detail: "Pole 'email' není platná e-mailová adresa.",
      instance: '/api/v1/contacts',
      code: 'validation_failed',
      request_id: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071',
      errors: [{ path: 'email', code: 'invalid_email', message: 'Není platná e-mailová adresa.' }],
    });
  });

  it('doplní retry_after u opakovatelného kódu z registru', () => {
    const problem = buildProblem({
      code: 'domain_dmarc_missing',
      instance: '/api/v1/providers/1/verify',
      requestId: 'r1',
    });
    expect(problem['retry_after']).toBe(300);
  });

  it('nikdy nevrátí about:blank', () => {
    const problem = buildProblem({ code: 'internal_error', instance: '/x', requestId: 'r1' });
    expect(problem['type']).not.toBe('about:blank');
  });

  it('odmítne findings bez jediné severity error', () => {
    expect(() =>
      buildProblem({
        code: 'campaign_not_sendable',
        instance: '/x',
        requestId: 'r1',
        findings: [{ code: 'domain_dmarc_missing', severity: 'warning', message: 'DMARC chybí.' }],
      }),
    ).toThrow(/aspoň jeden nález se severity "error"/);
  });

  it('odmítne neregistrovaný kód', () => {
    expect(() => buildProblem({ code: 'made_up_code', instance: '/x', requestId: 'r1' })).toThrow(
      /Neregistrovaný chybový kód/,
    );
  });

  it('odmítne errors[] u jiného kódu než validation_failed', () => {
    expect(() =>
      buildProblem({
        code: 'conflict',
        instance: '/x',
        requestId: 'r1',
        errors: [{ path: 'a', code: 'required', message: 'x' }],
      }),
    ).toThrow(/errors\[\] patří výhradně k validation_failed/);
  });
});
