import { pino, type Logger } from 'pino';

export type { Logger };

/**
 * Cesty, které se v logu nikdy neobjeví v otevřené podobě.
 *
 * Část 4b, kapitola 4.4: do logu nikdy nesmí e-mailová adresa příjemce,
 * obsah render_data, obsah zprávy ani dešifrovaná konfigurace provideru.
 * Část 1, kapitola 4.2: v odpovědi ani v logu nesmí obsah env proměnných.
 */
export const REDACTED_PATHS: readonly string[] = [
  'password',
  'authorization',
  'cookie',
  'set-cookie',
  '*.password',
  '*.authorization',
  '*.secret',
  '*.token',
  '*.api_key',
  '*.apiKey',
  '*.email',
  '*.render_data',
  '*.credentials',
  'config.SECRET_KEY',
  'config.SECRET_KEY_PREVIOUS',
  'config.DATABASE_URL',
  'config.DATABASE_URL_MIGRATOR',
  'config.DATABASE_URL_SENDER',
  'config.METRICS_TOKEN',
  'config.S3_SECRET_ACCESS_KEY',
  'config.S3_ACCESS_KEY_ID',
];

export interface LoggerOptions {
  readonly level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  readonly format: 'json' | 'pretty';
  readonly mode: 'web' | 'worker' | 'sender' | 'all' | 'cli';
  readonly version?: string;
}

export interface LoggerSinks {
  /** Injektovaný zápis, aby šlo logger testovat bez souborového deskriptoru. */
  readonly write?: (line: string) => void;
}

export function createLogger(options: LoggerOptions, sinks: LoggerSinks = {}): Logger {
  const base = {
    mode: options.mode,
    ...(options.version === undefined ? {} : { version: options.version }),
  };

  if (sinks.write) {
    return pino(
      {
        level: options.level,
        base,
        redact: { paths: [...REDACTED_PATHS], censor: '[Redacted]' },
      },
      { write: sinks.write },
    );
  }

  if (options.format === 'pretty') {
    return pino({
      level: options.level,
      base,
      redact: { paths: [...REDACTED_PATHS], censor: '[Redacted]' },
      transport: { target: 'pino-pretty', options: { colorize: true } },
    });
  }

  return pino({
    level: options.level,
    base,
    redact: { paths: [...REDACTED_PATHS], censor: '[Redacted]' },
  });
}
