import { describe, expect, it, vi } from 'vitest';
import { localProblem, type Problem } from './problem';
import { err, ok, type Result } from './result';
import {
  DEFAULT_LIMIT,
  buildListHref,
  fetchListWithCursorFallback,
  isInvalidCursorProblem,
  readCursor,
  readFilters,
  type Paginated,
} from './cursor';

const validationProblem = (path: string): Problem => ({
  type: 'https://docs.mlain.dev/errors/validation_failed',
  title: 'Validation failed',
  status: 422,
  detail: 'Neplatný kurzor.',
  instance: '/api/v1/audit-log',
  code: 'validation_failed',
  request_id: 'req_9',
  errors: [{ path, code: 'invalid_cursor', message: 'Kurzor nedává smysl.' }],
});

describe('readCursor a readFilters', () => {
  it('přečte kurzor z jednoduché hodnoty', () => {
    expect(readCursor({ cursor: 'abc' })).toBe('abc');
  });

  it('u pole vezme první hodnotu', () => {
    expect(readCursor({ cursor: ['abc', 'def'] })).toBe('abc');
  });

  it('u chybějícího kurzoru vrátí undefined', () => {
    expect(readCursor({})).toBeUndefined();
  });

  it('propustí jen povolené filtry', () => {
    const filters = readFilters({ action: 'api_key.created', evil: 'x', from: '2026-07-01' }, [
      'action',
      'from',
      'to',
    ]);
    expect(filters).toEqual({ action: 'api_key.created', from: '2026-07-01' });
  });

  it('prázdný filtr zahodí, aby v URL nezůstal action=', () => {
    expect(readFilters({ action: '' }, ['action'])).toEqual({});
  });
});

describe('buildListHref', () => {
  it('poskládá cestu s filtry a kurzorem', () => {
    expect(buildListHref('/w/eshop/settings/audit', { action: 'api_key.created' }, 'CUR')).toBe(
      '/w/eshop/settings/audit?action=api_key.created&cursor=CUR',
    );
  });

  it('bez kurzoru parametr nepřidá', () => {
    expect(buildListHref('/w/eshop/settings/audit', { action: 'api_key.created' })).toBe(
      '/w/eshop/settings/audit?action=api_key.created',
    );
  });

  it('nikdy nevyrobí parametr page', () => {
    expect(buildListHref('/x', { page: '3' } as Record<string, string>, 'CUR')).not.toContain(
      'page=',
    );
  });
});

describe('isInvalidCursorProblem', () => {
  it('pozná 422 s path cursor', () => {
    expect(isInvalidCursorProblem(validationProblem('cursor'))).toBe(true);
  });

  it('jiné validační chyby nepozná', () => {
    expect(isInvalidCursorProblem(validationProblem('limit'))).toBe(false);
  });

  it('jiné kódy nepozná', () => {
    expect(isInvalidCursorProblem(localProblem({ code: 'internal_error', instance: '/x' }))).toBe(
      false,
    );
  });
});

describe('fetchListWithCursorFallback', () => {
  const page: Paginated<{ id: string }> = {
    data: [{ id: 'a' }],
    pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: DEFAULT_LIMIT },
  };

  it('u platného kurzoru zavolá načtení jednou', async () => {
    const load = vi.fn(async (): Promise<Result<Paginated<{ id: string }>>> => ok(page));
    const result = await fetchListWithCursorFallback(load, 'CUR');
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('CUR');
    expect(result.cursorDropped).toBe(false);
  });

  it('u neplatného kurzoru načte první stránku téhož filtru a oznámí to', async () => {
    const load = vi
      .fn<(cursor?: string) => Promise<Result<Paginated<{ id: string }>>>>()
      .mockResolvedValueOnce(err(validationProblem('cursor')))
      .mockResolvedValueOnce(ok(page));

    const result = await fetchListWithCursorFallback(load, 'ROZBITY');

    expect(load).toHaveBeenNthCalledWith(1, 'ROZBITY');
    expect(load).toHaveBeenNthCalledWith(2, undefined);
    expect(result.cursorDropped).toBe(true);
    expect(result.result.ok).toBe(true);
  });

  it('jinou chybu nepřepisuje a druhý pokus nedělá', async () => {
    const load = vi.fn(async (): Promise<Result<Paginated<{ id: string }>>> =>
      err(localProblem({ code: 'service_unavailable', instance: '/x' })),
    );
    const result = await fetchListWithCursorFallback(load, 'CUR');
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.cursorDropped).toBe(false);
    expect(result.result.ok).toBe(false);
  });
});
