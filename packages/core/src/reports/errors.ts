import { ApiError } from '../errors/api-error';

/**
 * Jediné místo, kde tahle doména vyrábí chyby. Kódy pocházejí z registru P01,
 * tenhle plán žádný nezakládá.
 *
 * ODCHYLKA OD PLÁNU: plán psal `import { ApiError } from '@mlain/core/errors'`.
 * Barrel `src/errors/index.ts` reexportuje `types`, `registry` a `problem`,
 * nikoli `api-error`, takže třída je dostupná jen z `../errors/api-error`.
 * Stejnou cestou ji importuje i `src/campaigns/state-machine.ts`.
 *
 * `ApiError` z P04 **nemá volbu `detail`**: text pro uživatele se skládá až
 * v HTTP vrstvě z katalogu, protože závisí na `Accept-Language`, který doména
 * nezná. Strojová vysvětlení proto patří do `params`, ne do věty.
 *
 * `errors[]` má zmrazený tvar `{ path, code, message }` a smí ho nést
 * **výhradně** kód `validation_failed`. U jiného kódu konstruktor P04 spadne,
 * a to je záměr, ne past.
 */
export function notFound(what: 'campaign' | 'contact'): ApiError {
  return new ApiError('not_found', { params: { resource: what } });
}

export function validationFailed(path: string, code: string, message: string): ApiError {
  return new ApiError('validation_failed', { errors: [{ path, code, message }] });
}

export function timelineWindowTooLarge(): ApiError {
  return new ApiError('tracking_timeline_window_too_large', {
    params: { max_months: 3 },
  });
}

export function dependencyTimeout(): ApiError {
  return new ApiError('dependency_timeout', { params: { source: 'timeline' } });
}

export function trackingDisabled(): ApiError {
  return new ApiError('tracking_disabled', { params: { scope: 'workspace' } });
}
