import { createLogger, type Logger } from '../logging/logger';

/**
 * Logger domény AI.
 *
 * Stejný vzor jako `campaigns/logging.ts` a `contacts/import/logging.ts`: P01
 * žádný singleton nevystavuje, jen továrnu `createLogger`, takže se instance
 * vyrábí líně a jednou.
 *
 * V testech je úroveň `fatal`. Noční retence hlásí chybu za každý projekt,
 * který se nepodařilo uklidit, a bez ztišení by je vysypala do výstupu testů.
 */
let instance: Logger | null = null;

export function aiLogger(): Logger {
  instance ??= createLogger({
    level: process.env['NODE_ENV'] === 'test' ? 'fatal' : 'info',
    format: 'json',
    mode: 'worker',
  });
  return instance;
}
