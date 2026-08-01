import { validationFailed } from './errors';

export type CursorDirection = 'n' | 'p';

/** Tvar z konvence 4.3 části 1. Kurzor není podepsaný a nenese nic tajného. */
export type Cursor = {
  k: string[];
  d: CursorDirection;
  o: string;
};

export function encodeCursor(cursor: Cursor): string {
  const json = JSON.stringify({ k: cursor.k, d: cursor.d, o: cursor.o });
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string, expectedOrder: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw validationFailed(
      'cursor',
      'invalid_cursor',
      'Kurzor je poškozený. Načtěte seznam znovu od začátku.',
    );
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as Cursor).k) ||
    !(parsed as Cursor).k.every((value) => typeof value === 'string') ||
    ((parsed as Cursor).d !== 'n' && (parsed as Cursor).d !== 'p') ||
    typeof (parsed as Cursor).o !== 'string'
  ) {
    throw validationFailed(
      'cursor',
      'invalid_cursor',
      'Kurzor je poškozený. Načtěte seznam znovu od začátku.',
    );
  }

  const cursor = parsed as Cursor;
  if (cursor.o !== expectedOrder) {
    // Konvence 4.3: kurzor z jiného řazení by dal nesmyslný výsledek.
    throw validationFailed(
      'cursor',
      'cursor_order_mismatch',
      'Kurzor patří k jinému řazení. Načtěte seznam znovu.',
    );
  }
  return { k: cursor.k, d: cursor.d, o: cursor.o };
}
