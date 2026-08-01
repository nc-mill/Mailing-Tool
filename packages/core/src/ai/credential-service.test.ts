import { describe, expect, it, vi } from 'vitest';
import { fingerprintApiKey, hintFromApiKey, toPublicCredential } from './credential-service';

describe('credentials AI', () => {
  it('otisk je prvních 16 hex znaků SHA-256 klíče', () => {
    const fingerprint = fingerprintApiKey('sk-ant-abcdef');
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprintApiKey('sk-ant-abcdef')).toBe(fingerprint);
    expect(fingerprintApiKey('sk-ant-abcdeg')).not.toBe(fingerprint);
  });

  it('nápověda jsou poslední čtyři znaky klíče', () => {
    expect(hintFromApiKey('sk-ant-api03-XYZW')).toBe('XYZW');
  });

  it('krátký klíč nápovědou neprozradí celý klíč', () => {
    expect(hintFromApiKey('ab')).toBe('••');
  });

  it('veřejný tvar nikdy nenese klíč ani otisk', () => {
    const publicShape = toPublicCredential({
      id: 'c1',
      provider: 'anthropic',
      label: 'Hlavní klíč',
      keyHint: 'XYZW',
      keyFingerprint: 'deadbeefdeadbeef',
      baseUrl: null,
      defaultModel: 'claude-opus-5',
      defaultCredential: true,
      lastUsedAt: null,
      lastErrorAt: null,
      lastErrorCode: null,
      createdAt: '2026-07-31T10:00:00.000Z',
      updatedAt: '2026-07-31T10:00:00.000Z',
    });
    expect(publicShape).toMatchObject({
      id: 'c1',
      provider: 'anthropic',
      label: 'Hlavní klíč',
      key_hint: 'XYZW',
      default_model: 'claude-opus-5',
      default_credential: true,
    });
    const serialized = JSON.stringify(publicShape);
    expect(serialized).not.toContain('deadbeefdeadbeef');
    expect(serialized).not.toContain('api_key');
    expect(serialized).not.toContain('keyFingerprint');
  });
});

describe('šifrování a dešifrování klíče', () => {
  /**
   * Jména podle rozhodnutí R6: kontrakt 4 má jedno jméno a jednu signaturu,
   * a vlastní ho P02. Dřívější podoba volala `encryptCredential`, což byl
   * jeden ze tří názvů, kterými plány tentýž kontrakt označovaly.
   *
   * `encryptEnvelope` vrací OBJEKT s polem `stored`, ne holý řetězec.
   * Kdo si to splete, uloží do databáze `[object Object]`.
   */
  it('šifruje kontextem ai_provider a workspace_id v AAD', async () => {
    const encryptEnvelope = vi.fn(() => ({ stored: 'enc:v1:AAAA' }) as never);
    const { encryptApiKey } = await import('./credential-service');
    const stored = encryptApiKey(
      { workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071', apiKey: 'sk-ant-xyz' },
      { encryptEnvelope },
    );
    expect(stored).toBe('enc:v1:AAAA');
    expect(typeof stored).toBe('string');
    expect(encryptEnvelope).toHaveBeenCalledWith({
      context: 'ai_provider',
      workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071',
      plaintext: JSON.stringify({ apiKey: 'sk-ant-xyz' }),
    });
  });

  it('dešifruje a vrátí branded klíč', async () => {
    const decryptEnvelope = vi.fn(() => JSON.stringify({ apiKey: 'sk-ant-xyz' }));
    const { decryptApiKey } = await import('./credential-service');
    const key = decryptApiKey(
      { workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071', stored: 'enc:v1:AAAA' },
      { decryptEnvelope },
    );
    expect(key).toBe('sk-ant-xyz');
    expect(decryptEnvelope).toHaveBeenCalledWith({
      context: 'ai_provider',
      workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071',
      stored: 'enc:v1:AAAA',
    });
  });

  it('dešifrovaný prázdný klíč je ai_credential_missing, ne prázdný řetězec', async () => {
    const decryptEnvelope = vi.fn(() => JSON.stringify({ apiKey: '' }));
    const { decryptApiKey } = await import('./credential-service');
    expect(() =>
      decryptApiKey(
        { workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071', stored: 'enc:v1:AAAA' },
        { decryptEnvelope },
      ),
    ).toThrowError(expect.objectContaining({ code: 'ai_credential_missing' }));
  });
});
