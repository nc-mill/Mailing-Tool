import { RENDER_DATA_MAX_BYTES } from '../constants';

/**
 * Merge tagy, ktere se do render_data NIKDY nedostanou:
 *  - contact.email: sender ho bere z messages.email. Kdyby byl na dvou mistech, mohl by
 *    se rozejit a obalkova adresa je jedina, ktera musi byt jednoznacna.
 *  - unsubscribe_url a webview_url: stavi je sender z podepsaneho tokenu (kontrakt 3).
 *    Kdyby je stavela aplikace, byla by to druha implementace tehoz podpisu a zhruba
 *    117 znaku URL navic u kazde zpravy, tedy pres 100 MB u milionove kampane.
 */
export const RENDER_DATA_EXCLUDED_FIELDS = [
  'contact.email',
  'unsubscribe_url',
  'webview_url',
] as const;

export type ContactSnapshotSource = {
  id: string;
  email: string;
  attributes?: Record<string, unknown> | null;
} & Record<string, unknown>;

export type RenderDataResult = {
  data: { contact: Record<string, unknown> & { attr?: Record<string, unknown> } };
  bytes: number;
  tooLarge: boolean;
  errorCode?: 'render_data_too_large';
};

/** Ktere sloupce contacts musi umet dodat kandidatsky dotaz pro dane merge tagy. */
export function renderDataColumns(usedFields: readonly string[]): string[] {
  const cols = new Set<string>();
  for (const f of usedFields) {
    if ((RENDER_DATA_EXCLUDED_FIELDS as readonly string[]).includes(f)) continue;
    const parts = f.split('.');
    if (parts[0] !== 'contact') continue;
    if (parts[1] === 'attr') cols.add('attributes');
    else if (parts.length === 2) cols.add(parts[1]!);
  }
  return [...cols];
}

export function buildRenderData(
  contact: ContactSnapshotSource,
  usedFields: readonly string[],
): RenderDataResult {
  const out: Record<string, unknown> & { attr?: Record<string, unknown> } = {};

  for (const field of usedFields) {
    if ((RENDER_DATA_EXCLUDED_FIELDS as readonly string[]).includes(field)) continue;
    const parts = field.split('.');
    if (parts[0] !== 'contact') continue;

    if (parts.length === 2) {
      out[parts[1]!] = normalize(contact[parts[1]!]);
      continue;
    }
    if (parts.length === 3 && parts[1] === 'attr') {
      out.attr ??= {};
      out.attr[parts[2]!] = normalize((contact.attributes ?? {})[parts[2]!]);
      continue;
    }
    throw new Error(
      `Merge tag ${field} má víc než dvě úrovně. Liquid subset neumí vnořené cykly, hlubší struktury se nesnapshotují.`,
    );
  }

  const data = { contact: out };
  const bytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
  if (bytes > RENDER_DATA_MAX_BYTES) {
    return { data, bytes, tooLarge: true, errorCode: 'render_data_too_large' };
  }
  return { data, bytes, tooLarge: false };
}

/**
 * Hodnota, ktera je NULL, se zapisuje jako null, ne vynechava. Sender pak rozlisi
 * "pole neexistuje" (chyba sablony) od "pole je prazdne" (normalni stav, resi | default:).
 */
function normalize(v: unknown): string | number | boolean | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
