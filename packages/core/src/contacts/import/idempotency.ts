import { createHash } from 'node:crypto';
import { canonicalJson } from '../../segments/canonical';

export type IdempotencyInput = {
  contentSha256: Buffer;
  workspaceId: string;
  mapping: unknown;
  options: unknown;
  /** Volba „spustit znovu" posílá force: true, což sem vloží náhodný nonce. */
  nonce?: string;
};

/**
 * Klíč je otisk SOUBORU, MAPOVÁNÍ a VOLEB dohromady. Kdyby nesl jen obsah souboru,
 * nešel by tentýž soubor nahrát podruhé s jiným mapováním, což je legitimní
 * a časté: uživatel se u prvního pokusu splete ve sloupci.
 */
export function buildIdempotencyKey(input: IdempotencyInput): string {
  const parts = [
    input.contentSha256.toString('hex'),
    input.workspaceId,
    canonicalJson(input.mapping),
    canonicalJson(input.options),
    input.nonce ?? '',
  ].join(':');
  return createHash('sha256').update(parts, 'utf8').digest('base64url');
}
