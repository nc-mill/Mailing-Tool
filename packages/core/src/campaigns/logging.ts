import { createLogger, type Logger } from '../logging/logger';

/**
 * Logger domény kampaní.
 *
 * Stejný vzor jako `tracking/logging.ts` a `contacts/import/logging.ts`: P01
 * žádný singleton nevystavuje, jen továrnu `createLogger`, takže se instance
 * vyrábí líně a jednou.
 *
 * V testech je úroveň `fatal`. Hlídač zaseknutých dávek schválně píše varování
 * a bez ztišení by je vysypal do výstupu každého testu, který ho spustí.
 */
let instance: Logger | null = null;

export function campaignsLogger(): Logger {
  instance ??= createLogger({
    level: process.env['NODE_ENV'] === 'test' ? 'fatal' : 'info',
    format: 'json',
    mode: 'worker',
  });
  return instance;
}
