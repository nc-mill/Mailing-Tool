import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  handleCreateCredential,
  handleDeleteCredential,
  handleListCredentials,
  handleSetDefaultCredential,
  handleTestCredential,
} from './credentials.routes';

const ctx = { workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071', actorId: 'u1' };

// Šifruje se SKUTEČNOU obálkou z kontraktu P02, ne náhradou: kritérium 65 se
// jinak nedá ověřit. Obálka si klíč bere z prostředí, takže mu tady dáme
// testovací keyring. Hodnota je zjevně vymyšlená, 32 bajtů v base64url.
beforeAll(() => {
  process.env['SECRET_KEY'] = Buffer.from(new Uint8Array(32).fill(7)).toString('base64url');
});

describe('POST /api/v1/ai/credentials', () => {
  it('kritérium 65: do databáze jde ciphertext, nikdy čitelný klíč', async () => {
    const insert = vi.fn(async (row: Record<string, unknown>) => ({ ...row, id: 'c1' }));
    await handleCreateCredential(
      ctx,
      {
        provider: 'anthropic',
        label: 'Hlavní klíč',
        api_key: 'sk-ant-tajne-XYZW',
        default_model: 'claude-opus-5',
      },
      {
        insertCredential: insert,
        findByFingerprint: vi.fn(async () => null),
        writeAuditLog: vi.fn(),
      },
    );
    const row = insert.mock.calls[0]![0];
    // Bez obalení do String(): sloupec je v P03 `text`, takže ovladač vrátí
    // řetězec. Obalení by test nechalo projít i tehdy, kdyby byl sloupec
    // `bytea` a přišel Buffer, a právě tenhle rozpor by se pak projevil až
    // při prvním skutečném zápisu.
    expect(typeof row.apiKeyEncrypted).toBe('string');
    expect(row.apiKeyEncrypted).toMatch(/^enc:v1:/);
    expect(JSON.stringify(row)).not.toContain('sk-ant-tajne-XYZW');
    expect(row.keyHint).toBe('XYZW');
  });

  it('duplicitní klíč pod jiným jménem se pozná podle otisku', async () => {
    const result = await handleCreateCredential(
      ctx,
      {
        provider: 'anthropic',
        label: 'Druhý',
        api_key: 'sk-ant-x',
        default_model: 'claude-opus-5',
      },
      {
        insertCredential: vi.fn(),
        findByFingerprint: vi.fn(async () => ({ id: 'c1', label: 'Hlavní klíč' })),
        writeAuditLog: vi.fn(),
      },
    );
    expect(result).toMatchObject({ status: 409, code: 'already_exists' });
  });

  it('base_url u anthropicu je chyba validace', async () => {
    const result = await handleCreateCredential(
      ctx,
      {
        provider: 'anthropic',
        label: 'X',
        api_key: 'sk',
        default_model: 'claude-opus-5',
        base_url: 'https://zlo.example',
      },
      {
        insertCredential: vi.fn(),
        findByFingerprint: vi.fn(async () => null),
        writeAuditLog: vi.fn(),
      },
    );
    expect(result).toMatchObject({ status: 422, code: 'validation_failed' });
  });

  it('vytvoření klíče se zapíše do audit logu bez hodnoty klíče', async () => {
    const writeAuditLog = vi.fn();
    await handleCreateCredential(
      ctx,
      {
        provider: 'anthropic',
        label: 'Hlavní',
        api_key: 'sk-tajne',
        default_model: 'claude-opus-5',
      },
      {
        insertCredential: vi.fn(async (r: Record<string, unknown>) => ({ ...r, id: 'c1' })),
        findByFingerprint: vi.fn(async () => null),
        writeAuditLog,
      },
    );
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(writeAuditLog.mock.calls)).not.toContain('sk-tajne');
  });
});

describe('GET /api/v1/ai/credentials', () => {
  it('kritérium 66: nikdy nevrátí klíč, jen nápovědu o čtyřech znacích', async () => {
    const response = await handleListCredentials(ctx, {
      listCredentials: vi.fn(async () => [
        {
          id: 'c1',
          provider: 'anthropic' as const,
          label: 'Hlavní',
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
        },
      ]),
    });
    const serialized = JSON.stringify(response);
    expect(serialized).toContain('"key_hint":"XYZW"');
    expect(serialized).not.toContain('api_key');
    expect(serialized).not.toContain('deadbeefdeadbeef');
  });
});

describe('DELETE /api/v1/ai/credentials/{id}', () => {
  it('smaže klíč a zapíše audit bez hodnoty klíče', async () => {
    const writeAuditLog = vi.fn();
    const result = await handleDeleteCredential(
      ctx,
      { credentialId: 'c1' },
      { deleteCredential: vi.fn(async () => true), writeAuditLog },
    );
    expect(result).toMatchObject({ status: 204 });
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    expect(writeAuditLog.mock.calls[0]![0]).toMatchObject({ targetId: 'c1' });
  });

  it('neexistující klíč vrátí 404 a nezapisuje audit', async () => {
    const writeAuditLog = vi.fn();
    const result = await handleDeleteCredential(
      ctx,
      { credentialId: 'chybi' },
      { deleteCredential: vi.fn(async () => false), writeAuditLog },
    );
    expect(result).toMatchObject({ status: 404, code: 'not_found' });
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/ai/credentials/{id}/default', () => {
  it('nastaví výchozí klíč a zapíše audit', async () => {
    const writeAuditLog = vi.fn();
    const result = await handleSetDefaultCredential(
      ctx,
      { credentialId: 'c1' },
      { setDefaultCredential: vi.fn(async () => true), writeAuditLog },
    );
    expect(result).toMatchObject({ status: 200, body: { ok: true } });
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
  });

  it('neexistující klíč vrátí 404', async () => {
    const result = await handleSetDefaultCredential(
      ctx,
      { credentialId: 'chybi' },
      { setDefaultCredential: vi.fn(async () => false), writeAuditLog: vi.fn() },
    );
    expect(result).toMatchObject({ status: 404, code: 'not_found' });
  });
});

describe('POST /api/v1/ai/credentials/{id}/test', () => {
  it('při chybě zapíše last_error_code a vrátí přeložitelný kód, ne odpověď providera', async () => {
    const markError = vi.fn(async () => undefined);
    const result = await handleTestCredential(
      ctx,
      { credentialId: 'c1' },
      {
        probe: vi.fn(async () => {
          throw Object.assign(new Error('x'), {
            name: 'AI_APICallError',
            statusCode: 401,
            responseBody: '{"account":"acct_tajne"}',
          });
        }),
        markCredentialError: markError,
        markCredentialOk: vi.fn(),
      },
    );
    expect(result).toMatchObject({ ok: false, error: 'ai_invalid_credentials' });
    expect(markError).toHaveBeenCalledWith({ credentialId: 'c1', code: 'ai_invalid_credentials' });
    expect(JSON.stringify(result)).not.toContain('acct_tajne');
  });

  it('při úspěchu vrátí ok a případný seznam modelů', async () => {
    const result = await handleTestCredential(
      ctx,
      { credentialId: 'c1' },
      {
        probe: vi.fn(async () => ({ models: ['claude-opus-5'] })),
        markCredentialError: vi.fn(),
        markCredentialOk: vi.fn(async () => undefined),
      },
    );
    expect(result).toMatchObject({ ok: true, models: ['claude-opus-5'] });
  });
});
