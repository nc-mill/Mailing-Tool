/** Výchozí velikost části. Soubor o 200 MB se tak pošle po 40 kusech. */
export const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

export async function uploadInChunks({
  file,
  chunkSize = DEFAULT_CHUNK_SIZE,
  sendChunk,
  onProgress,
  signal,
}: {
  file: File;
  chunkSize?: number;
  sendChunk: (input: { index: number; total: number; blob: Blob }) => Promise<void>;
  onProgress?: (input: { uploadedBytes: number; totalBytes: number }) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const total = Math.ceil(file.size / chunkSize);
  let uploaded = 0;

  for (let index = 0; index < total; index += 1) {
    if (signal?.aborted) throw new Error('Nahrávání bylo zrušeno.');
    const start = index * chunkSize;
    const blob = file.slice(start, Math.min(start + chunkSize, file.size));
    await sendChunk({ index, total, blob });
    if (signal?.aborted) throw new Error('Nahrávání bylo zrušeno.');
    uploaded += blob.size;
    onProgress?.({ uploadedBytes: uploaded, totalBytes: file.size });
  }
}
