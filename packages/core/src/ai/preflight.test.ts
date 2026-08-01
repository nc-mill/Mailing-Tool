import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const manifestPath = fileURLToPath(new URL('../../package.json', import.meta.url));

type Manifest = {
  exports: Record<string, string>;
  dependencies: Record<string, string>;
};

function manifest(): Manifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
}

describe('balíček @mlain/core', () => {
  it('má zástupné pravidlo, takže doménové plány do exports mapy nepíšou', () => {
    const { exports: map } = manifest();
    expect(map['./*']).toBe('./src/*/index.ts');
    expect(map['./*/jobs']).toBe('./src/*/jobs/queue-handlers.ts');
  });

  it('nemá kořenový export, aby nešlo importovat @mlain/core bez podcesty', () => {
    expect(manifest().exports['.']).toBeUndefined();
  });

  it('deklaruje @mlain/db, protože repozitářová vrstva ho importuje', () => {
    expect(manifest().dependencies['@mlain/db']).toBe('workspace:*');
  });
});

/**
 * Preflight dodavatelů. Každý řádek je podpis, na kterém stojí některý pozdější
 * úkol. Když se sem dostane chyba typu, znamená to, že se dodavatel pohnul,
 * a řeší se to s jeho vlastníkem, ne obcházením tady.
 */
describe('preflight rozhraní, ze kterých plán čte', () => {
  it('P02 dodává encryptEnvelope a decryptEnvelope s pojmenovanými argumenty', async () => {
    const crypto = await import('@mlain/contracts/crypto');
    expect(typeof crypto.encryptEnvelope).toBe('function');
    expect(typeof crypto.decryptEnvelope).toBe('function');
    expect(crypto.CREDENTIAL_CONTEXTS).toContain('ai_provider');

    // Tvar návratové hodnoty: encryptEnvelope vrací OBJEKT s polem stored,
    // ne holý řetězec. Kdo si splete jedno s druhým, uloží "[object Object]".
    const out = crypto.encryptEnvelope({
      plaintext: JSON.stringify({ apiKey: 'sk-test' }),
      context: 'ai_provider',
      workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071',
      keyring: new Map([[1, new Uint8Array(32).fill(7)]]),
      keyId: 1,
    });
    expect(typeof out).toBe('object');
    expect(typeof out.stored).toBe('string');
    expect(out.stored.startsWith('enc:v1:')).toBe(true);
  });

  it('P04 dodává sdílený blocklist SSRF, ze kterého staví klasifikace adres', async () => {
    const ssrf = await import('@mlain/core/net/ssrf');
    expect(Array.isArray(ssrf.BLOCKED_RANGES)).toBe(true);
    expect(ssrf.BLOCKED_RANGES).toContain('169.254.0.0/16');
    expect(typeof ssrf.isBlockedAddress).toBe('function');
  });

  it('P04 dodává transakční obálky v podobě, jakou plán volá', async () => {
    const tx = await import('@mlain/core/tx');
    expect(typeof tx.withWorkspace).toBe('function');
    expect(typeof tx.withoutContext).toBe('function');
    expect(typeof tx.withReadOnly).toBe('function');
    // withWorkspace(ctx, fn) má dva parametry, ne tři. Kdyby přibyl pool,
    // spadne tenhle řádek, ne až dvacátý dotaz.
    expect(tx.withWorkspace.length).toBe(2);
  });

  it('P03 dodává pgErrorCode, protože kód chyby NENÍ na error.code', async () => {
    const db = await import('@mlain/db');
    expect(typeof db.pgErrorCode).toBe('function');
  });

  it('P01 dodává registr front s oběma frontami tohohle plánu', async () => {
    const queues = await import('@mlain/core/queues');
    expect(queues.queue('ai.cleanup_conversations')).toBeDefined();
    expect(queues.queue('content.brand_extract')).toMatchObject({ retryLimit: 0 });
  });
});
