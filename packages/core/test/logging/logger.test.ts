import { describe, expect, it } from 'vitest';
import { REDACTED_PATHS, createLogger } from '../../src/logging/logger';

function capture(fn: (write: (line: string) => void) => void): string[] {
  const lines: string[] = [];
  fn((line) => lines.push(line));
  return lines;
}

describe('logger', () => {
  it('píše JSON s úrovní a časem', () => {
    const lines = capture((write) => {
      const logger = createLogger({ level: 'info', format: 'json', mode: 'web' }, { write });
      logger.info({ request_id: 'r1' }, 'hotovo');
    });
    const record = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(record['msg']).toBe('hotovo');
    expect(record['request_id']).toBe('r1');
    expect(record['mode']).toBe('web');
    expect(record['level']).toBe(30);
  });

  it('nezaloguje záznam pod nastavenou úrovní', () => {
    const lines = capture((write) => {
      const logger = createLogger({ level: 'warn', format: 'json', mode: 'worker' }, { write });
      logger.info({}, 'tohle nemá projít');
      logger.warn({}, 'tohle ano');
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('tohle ano');
  });

  it('začerní tajemství, i když je někdo předá do logu', () => {
    const lines = capture((write) => {
      const logger = createLogger({ level: 'info', format: 'json', mode: 'web' }, { write });
      logger.info(
        {
          config: { SECRET_KEY: 'tajne', DATABASE_URL: 'postgres://u:p@h/d' },
          password: 'x',
          authorization: 'Bearer y',
        },
        'start',
      );
    });
    const text = lines[0] ?? '';
    expect(text).not.toContain('tajne');
    expect(text).not.toContain('postgres://u:p@h/d');
    expect(text).not.toContain('Bearer y');
    expect(text).toContain('[Redacted]');
  });

  it('seznam začerněných cest pokrývá e-mail příjemce a render_data', () => {
    expect(REDACTED_PATHS).toContain('*.render_data');
    expect(REDACTED_PATHS).toContain('*.email');
  });
});
