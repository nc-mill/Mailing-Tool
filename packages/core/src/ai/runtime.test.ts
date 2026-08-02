import { describe, expect, it, vi } from 'vitest';
import { createAiRuntime } from './runtime';

const logger = () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() });

describe('createAiRuntime', () => {
  it('při startu zkontroluje prostředí a únik zaloguje', () => {
    const log = logger();
    createAiRuntime({
      env: { ANTHROPIC_API_KEY: 'sk-zbyle' },
      logger: log,
      config: { requestTimeoutMs: 30_000, allowCustomBaseUrl: false },
    });
    expect(log.warn).toHaveBeenCalledTimes(1);
    const [payload] = log.warn.mock.calls[0] as unknown as [Record<string, unknown>, string];
    expect(payload.code).toBe('ai_key_leaked_from_env');
  });

  it('na čistém prostředí nevaruje', () => {
    const log = logger();
    createAiRuntime({
      env: { NODE_ENV: 'production' },
      logger: log,
      config: { requestTimeoutMs: 30_000, allowCustomBaseUrl: false },
    });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('sestaví továrny SDK a měřený fetch, ne jen prázdný objekt', () => {
    const runtime = createAiRuntime({
      env: {},
      logger: logger(),
      config: { requestTimeoutMs: 30_000, allowCustomBaseUrl: false },
    });
    expect(typeof runtime.buildModelFor).toBe('function');
    expect(typeof runtime.fetchImpl).toBe('function');
    expect(runtime.factories.createAnthropic).toBeTypeOf('function');
  });

  it('buildModelFor prázdný klíč odmítne dřív, než sáhne na SDK', () => {
    const runtime = createAiRuntime({
      env: {},
      logger: logger(),
      config: { requestTimeoutMs: 30_000, allowCustomBaseUrl: false },
    });
    expect(() =>
      runtime.buildModelFor(
        { provider: 'anthropic', apiKey: '' as never, baseUrl: null },
        'claude-opus-5',
      ),
    ).toThrowError(expect.objectContaining({ code: 'ai_credential_missing' }));
  });

  it('předává allowCustomBaseUrl z konfigurace, ne natvrdo true', () => {
    const runtime = createAiRuntime({
      env: {},
      logger: logger(),
      config: { requestTimeoutMs: 30_000, allowCustomBaseUrl: false },
    });
    expect(() =>
      runtime.buildModelFor(
        { provider: 'openai_compatible', apiKey: 'sk-x' as never, baseUrl: 'https://ok.example' },
        'model-x',
      ),
    ).toThrowError(expect.objectContaining({ code: 'validation_failed' }));
  });
});
