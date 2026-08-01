import { createLogger, type Logger } from '../logging/logger';

/**
 * ODCHYLKA OD PLÁNU, vynucená repozitářem. Plán psal
 * `import { logger } from '@mlain/core/logging'`. P01 žádný singleton
 * nevystavuje, jen továrnu `createLogger`. Logger se proto vyrábí líně a jednou,
 * stejně jako konfigurace v `tx/index.ts` a jako v doméně trackingu.
 */
let instance: Logger | null = null;

export function segmentsLogger(): Logger {
  instance ??= createLogger({
    level: process.env['NODE_ENV'] === 'test' ? 'fatal' : 'info',
    format: 'json',
    mode: 'worker',
  });
  return instance;
}
