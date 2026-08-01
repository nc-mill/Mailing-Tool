import { describe, expect, it, vi } from 'vitest';
import { MAX_TOOL_STEPS, prepareConversation, type PrepareDeps } from './chat';

const deps = (over: Partial<PrepareDeps> = {}) =>
  ({
    loadCredential: vi.fn(async () => ({
      id: 'c1',
      provider: 'anthropic' as const,
      stored: 'enc:v1:AAAA',
      defaultModel: 'claude-opus-5',
      baseUrl: null,
    })),
    decryptApiKey: vi.fn(() => 'sk-ant-xyz' as never),
    buildModel: vi.fn(() => ({
      model: {},
      providerId: 'anthropic' as const,
      modelId: 'claude-opus-5',
    })),
    countRequestsInLastHour: vi.fn(async () => 0),
    ...over,
  }) as unknown as PrepareDeps & {
    loadCredential: ReturnType<typeof vi.fn>;
    decryptApiKey: ReturnType<typeof vi.fn>;
    buildModel: ReturnType<typeof vi.fn>;
    countRequestsInLastHour: ReturnType<typeof vi.fn>;
  };

describe('příprava konverzace', () => {
  it('bez klíče projektu nevznikne žádný odchozí požadavek, kritérium 7b', async () => {
    const d = deps({ loadCredential: vi.fn(async () => null) });
    const result = await prepareConversation(
      { workspaceId: 'w1', templateId: 't1', credentialId: null, model: null, ratePerHour: 60 },
      d,
    );
    expect(result).toMatchObject({ ok: false, code: 'ai_credential_missing' });
    expect(d.buildModel).not.toHaveBeenCalled();
    expect(d.decryptApiKey).not.toHaveBeenCalled();
  });

  it('s klíčem projektu se model sestaví a klíč se předá explicitně', async () => {
    const d = deps();
    const result = await prepareConversation(
      { workspaceId: 'w1', templateId: 't1', credentialId: 'c1', model: null, ratePerHour: 60 },
      d,
    );
    expect(result.ok).toBe(true);
    expect(d.buildModel).toHaveBeenCalledTimes(1);
    const [credential] = d.buildModel.mock.calls[0] as [{ apiKey: string }];
    expect(credential.apiKey).toBe('sk-ant-xyz');
  });

  it('model z požadavku má přednost před výchozím modelem klíče', async () => {
    const d = deps();
    await prepareConversation(
      {
        workspaceId: 'w1',
        templateId: 't1',
        credentialId: 'c1',
        model: 'claude-sonnet-5',
        ratePerHour: 60,
      },
      d,
    );
    expect(d.buildModel.mock.calls[0]![1]).toBe('claude-sonnet-5');
  });

  it('vyčerpaný hodinový limit vrátí obecný rate_limited s retry_after', async () => {
    const d = deps({ countRequestsInLastHour: vi.fn(async () => 60) });
    const result = await prepareConversation(
      { workspaceId: 'w1', templateId: 't1', credentialId: 'c1', model: null, ratePerHour: 60 },
      d,
    );
    expect(result).toMatchObject({ ok: false, code: 'rate_limited' });
    if (result.ok === false && result.code === 'rate_limited') {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
      expect(result.limit).toBe(60);
    }
    expect(d.buildModel).not.toHaveBeenCalled();
  });

  it('strop kroků smyčky je osm', () => {
    expect(MAX_TOOL_STEPS).toBe(8);
  });
});
