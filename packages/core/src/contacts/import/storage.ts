import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable } from 'node:stream';
import { invalidImport, tooLarge } from './errors';

export type StoredUpload = { storageKey: string; byteSize: number; contentSha256: Buffer };

export type StoreOptions = {
  dataDir: string;
  workspaceId: string;
  importId: string;
  maxBytes: number;
  /** Ukládá se jen jako metadata, na disk se nikdy nepromítne. */
  originalName?: string;
};

/**
 * Soubor se nikdy nenačte do paměti celý. Jméno na disku je odvozené z importId,
 * ne z uživatelského jména souboru, takže `../../etc/passwd` nemá kam zasáhnout.
 * Content type se ignoruje, rozhoduje obsah: binární nuly v prvních 8 kB znamenají,
 * že to není textový soubor.
 */
export async function storeUpload(source: Readable, opts: StoreOptions): Promise<StoredUpload> {
  const storageKey = join('imports', opts.workspaceId, `${opts.importId}.csv`);
  const target = join(opts.dataDir, storageKey);
  await mkdir(dirname(target), { recursive: true });

  const hash = createHash('sha256');
  let byteSize = 0;
  let sniffed = 0;
  let binary = false;

  const guard = new Transform({
    transform(chunk: Buffer, _enc, done) {
      byteSize += chunk.length;
      if (byteSize > opts.maxBytes) {
        try {
          tooLarge(byteSize, opts.maxBytes);
        } catch (error) {
          done(error as Error);
          return;
        }
      }
      if (sniffed < 8192) {
        const window = chunk.subarray(0, 8192 - sniffed);
        if (window.includes(0)) binary = true;
        sniffed += window.length;
      }
      hash.update(chunk);
      done(null, chunk);
    },
  });

  try {
    await pipeline(source, guard, createWriteStream(target));
  } catch (error) {
    await rm(target, { force: true });
    throw error;
  }

  if (binary) {
    await rm(target, { force: true });
    invalidImport('_', 'unsupported_encoding', 'File looks binary, not text.', {
      reason: 'binary',
    });
  }
  if (byteSize === 0) {
    await rm(target, { force: true });
    invalidImport('_', 'empty_file', 'Uploaded file is empty.');
  }
  return { storageKey, byteSize, contentSha256: hash.digest() };
}

export async function deleteUpload(dataDir: string, storageKey: string): Promise<void> {
  await rm(join(dataDir, storageKey), { force: true });
}
