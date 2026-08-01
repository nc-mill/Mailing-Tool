import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parseKeyring } from '../src/keyring';
import {
  buildToken,
  TokenError,
  verifyToken,
  type TokenFields,
  type TokenType,
} from '../src/token';
import { writeGoldenReport } from './golden-report';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const vectorsFile = path.join(fixturesDir, 'token', 'vectors.json');
const keyring = parseKeyring({ secretKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8' });

/**
 * `sides` říká, které jazykové strany vektor zpracují, a je to DATA, ne rozhodnutí
 * runneru za běhu. Sender tokeny jen VYRÁBÍ a nikdy je neověřuje, protože ověření
 * dělá aplikace; negativní vektory a identity token proto Go strana nemá čím
 * zpracovat. Kdyby to runner řešil `t.Skip()`, nikdo by nepoznal rozdíl mezi
 * "nepoužitelné z principu" a "někdo si to odpustil". Takhle to leží ve zmrazené
 * fixture pod CODEOWNERS a check-parity to bere jako závaznou očekávanou množinu.
 */
type Side = 'ts' | 'go';

type Vectors = {
  positive: Array<{
    id: string;
    type: TokenType;
    key_id: number;
    fields: TokenFields;
    expected_token: string;
    expected_mac_full: string;
    sides: Side[];
  }>;
  negative: Array<{
    id: string;
    token: string;
    endpoint_type: TokenType;
    expected_error: string;
    now?: number;
    nonce_used?: boolean;
    sides: Side[];
  }>;
};

const vectors = JSON.parse(await readFile(vectorsFile, 'utf8')) as Vectors;
const executed: string[] = [];

afterAll(async () => {
  await writeGoldenReport({
    section: 'token',
    total: vectors.positive.length + vectors.negative.length,
    ids: executed,
    files: [vectorsFile],
  });
});

describe('kontrakt 3: trackovací tokeny', () => {
  it('má pět pozitivních a devět negativních vektorů', () => {
    expect(vectors.positive).toHaveLength(5);
    expect(vectors.negative).toHaveLength(9);
  });

  it('každý vektor má neprázdné sides a TypeScript strana zpracuje všechny', () => {
    for (const vector of [...vectors.positive, ...vectors.negative]) {
      expect(vector.sides.length, `${vector.id} nemá sides`).toBeGreaterThan(0);
      expect(vector.sides, `${vector.id} musí být na TS straně`).toContain('ts');
    }
  });

  it.each(vectors.positive)('$id vyrobí závazný řetězec bajt na bajt', (vector) => {
    const built = buildToken({
      type: vector.type,
      keyId: vector.key_id,
      fields: vector.fields,
      keyring,
    });
    expect(built.token).toBe(vector.expected_token);
    expect(Buffer.from(built.macFull).toString('hex')).toBe(vector.expected_mac_full);
    executed.push(vector.id); // POSLEDNÍ řádek těla, viz rozhodnutí D15
  });

  it.each(vectors.positive)('$id se ověří a vrátí tatáž pole', (vector) => {
    const verified = verifyToken({
      token: vector.expected_token,
      endpointType: vector.type,
      keyring,
      now: 1_784_995_200,
      isNonceUsed: () => false,
    });
    expect(verified.type).toBe(vector.type);
    expect(verified.keyId).toBe(vector.key_id);
    expect(verified.fields).toEqual(vector.fields);
  });

  it.each(vectors.negative)('$id je odmítnutý s $expected_error', (vector) => {
    try {
      verifyToken({
        token: vector.token,
        endpointType: vector.endpoint_type,
        keyring,
        now: vector.now ?? 1_784_995_200,
        isNonceUsed: () => vector.nonce_used === true,
      });
      throw new Error(`${vector.id}: token měl být odmítnutý`);
    } catch (error) {
      expect(error).toBeInstanceOf(TokenError);
      expect((error as TokenError).code).toBe(vector.expected_error);
    }
    executed.push(vector.id);
  });

  it('délky tokenů odpovídají tabulce kontraktu', () => {
    const byType = Object.fromEntries(
      vectors.positive.map((v) => [v.type, v.expected_token.length]),
    );
    expect(byType.o).toBe(74);
    expect(byType.c).toBe(96);
    expect(byType.i).toBe(106);
    expect(byType.u).toBe(117);
  });

  it('message_created_at se proti expiraci nekontroluje nikdy', () => {
    const open = vectors.positive.find((v) => v.type === 'o');
    if (!open) throw new Error('fixture token/vectors.json nemá vektor typu o');
    const verified = verifyToken({
      token: open.expected_token,
      endpointType: 'o',
      keyring,
      now: 4_000_000_000,
      isNonceUsed: () => false,
    });
    expect(verified.fields.message_created_at).toBe(1_784_995_200);
  });
});
