import { describe, expect, it, vi } from 'vitest';
import { uploadInChunks } from './chunked-upload';

function fileOf(bytes: number): File {
  return new File([new Uint8Array(bytes)], 'kontakty.csv', { type: 'text/csv' });
}

describe('uploadInChunks', () => {
  it('rozdělí soubor na části a pošle je po pořádku', async () => {
    const sent: number[] = [];
    await uploadInChunks({
      file: fileOf(25),
      chunkSize: 10,
      sendChunk: async ({ index, blob }) => {
        sent.push(index);
        expect(blob.size).toBeLessThanOrEqual(10);
      },
    });
    expect(sent).toEqual([0, 1, 2]);
  });

  it('hlásí průběh v bajtech, ne jen v procentech', async () => {
    const progress: number[] = [];
    await uploadInChunks({
      file: fileOf(25),
      chunkSize: 10,
      sendChunk: async () => {},
      onProgress: ({ uploadedBytes }) => progress.push(uploadedBytes),
    });
    expect(progress).toEqual([10, 20, 25]);
  });

  it('zrušení zastaví další části', async () => {
    const controller = new AbortController();
    const sendChunk = vi.fn(async ({ index }: { index: number }) => {
      if (index === 0) controller.abort();
    });

    await expect(
      uploadInChunks({
        file: fileOf(50),
        chunkSize: 10,
        sendChunk,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/zrušeno/);

    expect(sendChunk).toHaveBeenCalledTimes(1);
  });

  it('zvládne prázdný soubor bez nekonečné smyčky', async () => {
    const sendChunk = vi.fn();
    await uploadInChunks({ file: fileOf(0), chunkSize: 10, sendChunk });
    expect(sendChunk).not.toHaveBeenCalled();
  });
});
