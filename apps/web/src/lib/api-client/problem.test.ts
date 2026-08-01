import { describe, expect, expectTypeOf, it } from 'vitest';
import { isProblem, localProblem, type Problem } from './problem';

const VALID: Problem = {
  type: 'https://docs.mlain.dev/errors/forbidden',
  title: 'Forbidden',
  status: 403,
  detail: 'Nemáte oprávnění.',
  instance: '/api/v1/api-keys',
  code: 'forbidden',
  request_id: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071',
};

describe('isProblem', () => {
  it('přijme obálku se všemi povinnými poli', () => {
    expect(isProblem(VALID)).toBe(true);
  });

  it('odmítne objekt bez code', () => {
    // Rest destructuring je jediný způsob, jak klíč odebrat bez přetypování.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { code: _unused, ...withoutCode } = VALID;
    expect(isProblem(withoutCode)).toBe(false);
  });

  it('odmítne objekt bez request_id', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { request_id: _unused, ...withoutRequestId } = VALID;
    expect(isProblem(withoutRequestId)).toBe(false);
  });

  it('odmítne null, pole i řetězec', () => {
    expect(isProblem(null)).toBe(false);
    expect(isProblem([VALID])).toBe(false);
    expect(isProblem('forbidden')).toBe(false);
  });

  it('nese rozšiřující členy findings a params', () => {
    const rich: Problem = {
      ...VALID,
      params: { requiredPermission: 'api_keys:read', currentRole: 'viewer' },
      findings: [{ code: 'domain_dmarc_missing', severity: 'warning', message: 'Chybí DMARC.' }],
    };
    expect(isProblem(rich)).toBe(true);
    expect(rich.findings?.[0]?.severity).toBe('warning');
  });
});

describe('typ Problem odpovídá tvaru z 4.8 části 1', () => {
  it('má všechna pole včetně findings a params', () => {
    expectTypeOf<Problem>().toHaveProperty('type').toEqualTypeOf<string>();
    expectTypeOf<Problem>().toHaveProperty('title').toEqualTypeOf<string>();
    expectTypeOf<Problem>().toHaveProperty('status').toEqualTypeOf<number>();
    expectTypeOf<Problem>().toHaveProperty('detail').toEqualTypeOf<string>();
    expectTypeOf<Problem>().toHaveProperty('instance').toEqualTypeOf<string>();
    expectTypeOf<Problem>().toHaveProperty('code').toEqualTypeOf<string>();
    expectTypeOf<Problem>().toHaveProperty('request_id').toEqualTypeOf<string>();
    expectTypeOf<Problem>().toHaveProperty('errors');
    expectTypeOf<Problem>().toHaveProperty('findings');
    expectTypeOf<Problem>().toHaveProperty('params');
    expectTypeOf<Problem>().toHaveProperty('retry_after');
  });
});

describe('localProblem', () => {
  it('u nedostupné služby použije registrovaný kód a prázdné request_id', () => {
    const problem = localProblem({ code: 'service_unavailable', instance: '/api/v1/members' });
    expect(problem.code).toBe('service_unavailable');
    expect(problem.status).toBe(503);
    expect(problem.request_id).toBe('');
    expect(problem.instance).toBe('/api/v1/members');
    expect(problem.type).toBe('https://docs.mlain.dev/errors/service_unavailable');
  });

  it('u vypršeného času použije dependency_timeout', () => {
    expect(localProblem({ code: 'dependency_timeout', instance: '/x' }).status).toBe(504);
  });

  it('nikdy nevymyslí request_id', () => {
    for (const code of ['service_unavailable', 'dependency_timeout', 'internal_error'] as const) {
      expect(localProblem({ code, instance: '/x' }).request_id).toBe('');
    }
  });
});
