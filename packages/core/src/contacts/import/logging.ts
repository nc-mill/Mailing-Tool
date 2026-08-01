import { createLogger, type Logger } from '../../logging/logger';

/**
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. Plán psal
 * `import { logger } from '@mlain/core/logging'`. P01 žádný singleton
 * nevystavuje, jen továrnu `createLogger`. Logger se proto vyrábí líně a jednou,
 * stejně jako konfigurace v `tx/index.ts` a jako v segmentech.
 */
let instance: Logger | null = null;

export function importLogger(): Logger {
  instance ??= createLogger({
    level: process.env['NODE_ENV'] === 'test' ? 'fatal' : 'info',
    format: 'json',
    mode: 'worker',
  });
  return instance;
}
