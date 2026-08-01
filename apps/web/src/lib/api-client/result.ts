import type { Problem } from './problem';

export type Ok<T> = { readonly ok: true; readonly data: T };
export type Err = { readonly ok: false; readonly problem: Problem };
export type Result<T> = Ok<T> | Err;

export function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}

export function err(problem: Problem): Err {
  return { ok: false, problem };
}

export function isOk<T>(result: Result<T>): result is Ok<T> {
  return result.ok;
}

export function unwrapOr<T>(result: Result<T>, fallback: T): T {
  return result.ok ? result.data : fallback;
}
