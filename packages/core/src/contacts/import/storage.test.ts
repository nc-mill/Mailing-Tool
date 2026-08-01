import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { storeUpload } from './storage';
import { importErrorCode } from './errors';

const dataDir = mkdtempSync(join(tmpdir(), 'mlain-import-'));
const ws = '00000000-0000-0000-0000-000000000001';
const id = '00000000-0000-0000-0000-0000000000aa';

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return importErrorCode(error);
  }
}

describe('upload storage', () => {
  it('writes outside the webroot under a name derived from the import id', async () => {
    const out = await storeUpload(Readable.from([Buffer.from('a;b\n1;2\n')]), {
      dataDir,
      workspaceId: ws,
      importId: id,
      maxBytes: 1000,
    });
    expect(out.storageKey).toBe(join('imports', ws, `${id}.csv`));
    expect(readFileSync(join(dataDir, out.storageKey), 'utf8')).toBe('a;b\n1;2\n');
    expect(out.byteSize).toBe(8);
    expect(out.contentSha256).toHaveLength(32);
  });

  it('aborts over the limit without buffering the whole file', async () => {
    const big = Readable.from([Buffer.alloc(600), Buffer.alloc(600)]);
    expect(
      await codeOf(storeUpload(big, { dataDir, workspaceId: ws, importId: id, maxBytes: 1000 })),
    ).toBe('file_too_large');
  });

  it('rejects a binary file', async () => {
    const bin = Readable.from([Buffer.from([0x00, 0x01, 0x02, 0x00])]);
    expect(
      await codeOf(storeUpload(bin, { dataDir, workspaceId: ws, importId: id, maxBytes: 1000 })),
    ).toBe('unsupported_encoding');
  });

  it('never uses the user supplied file name on disk', async () => {
    const out = await storeUpload(Readable.from([Buffer.from('a;b\n')]), {
      dataDir,
      workspaceId: ws,
      importId: id,
      maxBytes: 1000,
      originalName: '../../etc/passwd',
    });
    expect(out.storageKey).not.toContain('..');
    expect(statSync(join(dataDir, out.storageKey)).isFile()).toBe(true);
  });
});
