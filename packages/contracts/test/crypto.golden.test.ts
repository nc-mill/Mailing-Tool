import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parseKeyring } from '../src/keyring';
import {
  CREDENTIAL_CONTEXTS,
  CryptoError,
  decryptEnvelope,
  encryptEnvelope,
  envelopeKeyId,
  type CredentialContext,
} from '../src/crypto';
import { writeGoldenReport } from './golden-report';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const vectorsFile = path.join(fixturesDir, 'crypto', 'vectors.json');
const keyring = parseKeyring({ secretKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8' });

type Side = 'ts' | 'go';

type Vectors = {
  positive: Array<{
    id: string;
    key_id: number;
    context: CredentialContext;
    workspace_id: string;
    nonce_hex: string;
    plaintext: string;
    expected_header_hex: string;
    expected_aad_hex: string;
    expected_ciphertext_hex: string;
    expected_tag_hex: string;
    expected_stored: string;
    expected_envelope_bytes: number;
    sides: Side[];
  }>;
  negative: Array<{
    id: string;
    stored: string;
    context: CredentialContext;
    workspace_id: string;
    expected_error: string;
    sides: Side[];
  }>;
};

const vectors = JSON.parse(await readFile(vectorsFile, 'utf8')) as Vectors;
const [firstPositive] = vectors.positive;
if (!firstPositive)
  throw new Error('fixture crypto/vectors.json neobsahuje ani jeden pozitivní vektor');
const executed: string[] = [];

afterAll(async () => {
  await writeGoldenReport({
    section: 'crypto',
    total: vectors.positive.length + vectors.negative.length,
    ids: executed,
    files: [vectorsFile],
  });
});

describe('kontrakt 4: šifrování credentials', () => {
  it('má jeden pozitivní a osm negativních vektorů', () => {
    expect(vectors.positive).toHaveLength(1);
    expect(vectors.negative).toHaveLength(8);
  });

  it('každý vektor nese platný kontext z uzavřeného výčtu', () => {
    // Schéma dřív `context` jako výčet nevynucovalo, takže se do negativního
    // vektoru dostal řetězec, který v CREDENTIAL_CONTEXTS vůbec není. Fixture
    // pak testovala tvar, který v produktu nemůže nastat.
    for (const vector of [...vectors.positive, ...vectors.negative]) {
      expect(CREDENTIAL_CONTEXTS, `${vector.id} má kontext mimo výčet`).toContain(vector.context);
      expect(vector.sides).toContain('ts');
    }
  });

  it('envelopeKeyId přečte key_id z obálky bez klíče a bez dešifrování', () => {
    expect(envelopeKeyId(firstPositive.expected_stored)).toBe(firstPositive.key_id);
  });

  it.each(vectors.positive)('$id vyrobí obálku bajt na bajt', (vector) => {
    const result = encryptEnvelope({
      plaintext: vector.plaintext,
      context: vector.context,
      workspaceId: vector.workspace_id,
      keyring,
      keyId: vector.key_id,
      nonce: new Uint8Array(Buffer.from(vector.nonce_hex, 'hex')),
    });
    expect(result.stored).toBe(vector.expected_stored);
    expect(Buffer.from(result.header).toString('hex')).toBe(vector.expected_header_hex);
    expect(Buffer.from(result.aad).toString('hex')).toBe(vector.expected_aad_hex);
    expect(Buffer.from(result.ciphertext).toString('hex')).toBe(vector.expected_ciphertext_hex);
    expect(Buffer.from(result.tag).toString('hex')).toBe(vector.expected_tag_hex);
    expect(result.envelopeBytes).toBe(vector.expected_envelope_bytes);
    expect(result.envelopeKeyId).toBe(vector.key_id);
    executed.push(vector.id);
  });

  it.each(vectors.positive)('$id se dešifruje zpět na původní text', (vector) => {
    expect(
      decryptEnvelope({
        stored: vector.expected_stored,
        context: vector.context,
        workspaceId: vector.workspace_id,
        keyring,
      }),
    ).toBe(vector.plaintext);
  });

  it.each(vectors.negative)('$id skončí s $expected_error', (vector) => {
    try {
      decryptEnvelope({
        stored: vector.stored,
        context: vector.context,
        workspaceId: vector.workspace_id,
        keyring,
      });
      throw new Error(`${vector.id}: dešifrování mělo selhat`);
    } catch (error) {
      expect(error).toBeInstanceOf(CryptoError);
      expect((error as CryptoError).code).toBe(vector.expected_error);
    }
    executed.push(vector.id);
  });

  it('náhodný nonce se pro tentýž klíč neopakuje', () => {
    const a = encryptEnvelope({
      plaintext: '{"a":1}',
      context: 'sending_provider',
      workspaceId: firstPositive.workspace_id,
      keyring,
    });
    const b = encryptEnvelope({
      plaintext: '{"a":1}',
      context: 'sending_provider',
      workspaceId: firstPositive.workspace_id,
      keyring,
    });
    expect(a.stored).not.toBe(b.stored);
  });

  it('podpis odpovídá tomu, co volá P04', () => {
    const stored = encryptEnvelope({
      plaintext: '{"secret":"x"}',
      context: 'webhook_secret',
      workspaceId: firstPositive.workspace_id,
      keyring,
    }).stored;
    expect(
      decryptEnvelope({
        stored,
        context: 'webhook_secret',
        workspaceId: firstPositive.workspace_id,
        keyring,
      }),
    ).toBe('{"secret":"x"}');
  });
});
