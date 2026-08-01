import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { base32Lower, buildMessageId } from '../src/message-id';
import { writeGoldenReport } from './golden-report';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const vectorsFile = path.join(fixturesDir, 'message-id', 'vectors.json');

type Vectors = {
  cases: Array<{
    id: string;
    message_id: string;
    sending_domain: string;
    expected_base32: string;
    expected_header: string;
    sides: Array<'ts' | 'go'>;
  }>;
};

const vectors = JSON.parse(await readFile(vectorsFile, 'utf8')) as Vectors;
const [first] = vectors.cases;
if (!first) throw new Error('fixture message-id/vectors.json neobsahuje ani jeden vektor');
const executed: string[] = [];

afterAll(async () => {
  await writeGoldenReport({
    section: 'message-id',
    total: vectors.cases.length,
    ids: executed,
    files: [vectorsFile],
  });
});

describe('Message-ID', () => {
  it('má čtyři vektory a všechny zpracují obě strany', () => {
    expect(vectors.cases).toHaveLength(4);
    for (const testCase of vectors.cases) {
      expect(testCase.sides).toEqual(['ts', 'go']);
    }
  });

  it.each(vectors.cases)('$id kóduje 16 bajtů UUID na 26 znaků a skládá hlavičku', (testCase) => {
    const encoded = base32Lower(Buffer.from(testCase.message_id.replace(/-/g, ''), 'hex'));
    expect(encoded).toHaveLength(26);
    expect(encoded).toMatch(/^[a-z2-7]+$/);
    expect(encoded).toBe(testCase.expected_base32);
    expect(
      buildMessageId({ messageId: testCase.message_id, sendingDomain: testCase.sending_domain }),
    ).toBe(testCase.expected_header);
    executed.push(testCase.id);
  });

  it('OB-11: dva pokusy téže zprávy dají identický řetězec', () => {
    const a = buildMessageId({ messageId: first.message_id, sendingDomain: first.sending_domain });
    const b = buildMessageId({ messageId: first.message_id, sendingDomain: first.sending_domain });
    expect(a).toBe(b);
  });

  it('nikdy nezahrnuje číslo pokusu ani čas', () => {
    const value = buildMessageId({
      messageId: first.message_id,
      sendingDomain: first.sending_domain,
    });
    expect(value).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(value.split('@')[0]).toBe(`<ml.${first.expected_base32}`);
  });
});
