import { describe, it, expect } from 'vitest';
import { ApiError } from '@mlain/core/errors/api-error';
import { encodeCursor, decodeCursor, buildPage, parsePaginationQuery } from './pagination';

const VECTOR_KEYS = ['2026-07-31T14:22:03.000Z', '0192f3a0-1c2d-7e43-8d4e-5f60718293a4'];
const VECTOR_B64 =
  'eyJrIjpbIjIwMjYtMDctMzFUMTQ6MjI6MDMuMDAwWiIsIjAxOTJmM2EwLTFjMmQtN2U0My04ZDRlLTVmNjA3MTgyOTNhNCJdLCJkIjoibiIsIm8iOiJjcmVhdGVkX2F0LmRlc2MifQ';

describe('kurzor', () => {
  it('odpovídá závaznému vektoru ze 4.3', () => {
    expect(encodeCursor(VECTOR_KEYS, 'n', 'created_at.desc')).toBe(VECTOR_B64);
  });

  it('dekóduje vlastní výstup', () => {
    expect(decodeCursor(VECTOR_B64, 'created_at.desc')).toEqual({
      k: VECTOR_KEYS,
      d: 'n',
      o: 'created_at.desc',
    });
  });

  it('kurzor s jiným order končí 422', () => {
    try {
      decodeCursor(VECTOR_B64, 'created_at.asc');
      expect.unreachable('mělo hodit');
    } catch (e) {
      expect((e as ApiError).status).toBe(422);
    }
  });

  it('kurzor bez pole o končí 422, protože je povinné', () => {
    const broken = Buffer.from(JSON.stringify({ k: ['a'], d: 'n' }), 'utf8').toString('base64url');
    expect(() => decodeCursor(broken, 'created_at.desc')).toThrow(ApiError);
  });

  it('nesmyslný kurzor končí 422, ne 500', () => {
    expect(() => decodeCursor('!!!nejsem base64!!!', 'created_at.desc')).toThrow(ApiError);
  });
});

describe('parsePaginationQuery', () => {
  it('výchozí hodnoty jsou limit 50 a první povolený order', () => {
    expect(parsePaginationQuery({}, ['created_at.desc', 'created_at.asc'])).toEqual({
      limit: 50,
      order: 'created_at.desc',
      cursor: null,
    });
  });

  it('limit nad 200 končí 422', () => {
    expect(() => parsePaginationQuery({ limit: '201' }, ['created_at.desc'])).toThrow(ApiError);
  });

  it('limit 0 končí 422', () => {
    expect(() => parsePaginationQuery({ limit: '0' }, ['created_at.desc'])).toThrow(ApiError);
  });

  it('nevyjmenovaný order končí 422', () => {
    expect(() => parsePaginationQuery({ order: 'name.asc' }, ['created_at.desc'])).toThrow(
      ApiError,
    );
  });
});

describe('buildPage', () => {
  const row = (i: number) => ({ id: String(i), created_at: '2026-07-31T00:00:00.000Z' });

  it('has_more je odvozené z načtení limit + 1 řádků', () => {
    const page = buildPage(
      Array.from({ length: 51 }, (_, i) => row(i)),
      { limit: 50, order: 'created_at.desc' },
      (r) => [r.created_at, r.id],
    );
    expect(page.data).toHaveLength(50);
    expect(page.pagination.has_more).toBe(true);
    expect(page.pagination.next_cursor).toBeTruthy();
  });

  it('poslední stránka nemá next_cursor', () => {
    const page = buildPage([row(1)], { limit: 50, order: 'created_at.desc' }, (r) => [
      r.created_at,
      r.id,
    ]);
    expect(page.pagination.has_more).toBe(false);
    expect(page.pagination.next_cursor).toBeNull();
  });

  it('celkový počet se v odpovědi seznamu nevrací nikdy', () => {
    const page = buildPage([row(1)], { limit: 50, order: 'created_at.desc' }, (r) => [
      r.created_at,
      r.id,
    ]);
    expect(Object.keys(page.pagination)).toEqual([
      'next_cursor',
      'prev_cursor',
      'has_more',
      'limit',
    ]);
  });
});
