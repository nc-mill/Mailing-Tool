import { toAssetRow, type ApiAsset, type AssetRow } from './types';

/**
 * Nahrání obrázků do knihovny z prohlížeče.
 *
 * PROČ NE SERVEROVÁ AKCE. Server action posílá tělo přes RSC a má výchozí strop
 * 1 MB (`serverActions.bodySizeLimit`), kdežto obrázek smí mít 10 MB. Hlavně
 * ale akce nemá jak hlásit průběh: vrátí se až na konci, takže by uživatel
 * u deseti fotek koukal deset sekund na nehybnou obrazovku. Volá se proto
 * přímo `POST /api/v1/assets`, což je tatáž trasa, kterou používá editor.
 *
 * SOUBORY SE POSÍLAJÍ PO JEDNOM, SEKVENČNĚ. Není to opomenutí paralelizace:
 * každý soubor se na serveru dekóduje `sharpem` a vyrobí se z něj čtyři
 * varianty, takže deset souběžných nahrání znamená deset souběžných dekodérů
 * v jednom procesu, který zároveň obsluhuje aplikaci. Sekvenčně to trvá stejně
 * dlouho a nepoloží to server.
 */

/**
 * Co smí projít výběrem souborů.
 *
 * SEZNAM JE TU OPSANÝ Z `packages/core/src/assets/registry.ts` A NEIMPORTUJE SE.
 * Vypadá to jako duplicita, ale import by knihovnu shodil: `@mlain/core/assets`
 * vede přes `src/assets/index.ts`, který táhne `service.ts` (a s ním `pg`,
 * `node:fs`, konfiguraci) a `image.ts` (a s ním nativní `sharp`). V klientském
 * bundlu nemá být ani jedno; `next.config.ts` má `sharp` dokonce výslovně
 * v `serverExternalPackages`. Jemnější cesta (`@mlain/core/assets/registry`)
 * neexistuje a přidat ji nejde: vzor `"./assets/*"` v exportech balíčku je
 * specifičtější než `"./*"`, takže by přebil `@mlain/core/assets/api`
 * a odstřihl celý router assetů.
 *
 * Že se seznam nerozešel s registrem, hlídá `upload-assets.test.ts`, který
 * běží v Node a importovat core smí.
 */
export const ACCEPT_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
];

/** Hodnota atributu `accept`. Přípony kvůli Windows, které u části souborů posílá prázdný typ. */
export const ACCEPT_ATTRIBUTE = [
  ...ACCEPT_MIME_TYPES,
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.avif',
  '.svg',
].join(',');

export type UploadOutcome =
  /** Nahráno jako nová položka knihovny. */
  | { kind: 'created'; file: string; asset: AssetRow }
  /**
   * Server odpověděl 200: tentýž OBSAH už v projektu je a vrací se stávající
   * řádek. Není to chyba a nesmí se tak tvářit, ale uživatel to musí vědět,
   * jinak by hledal, proč mu po nahrání deseti souborů přibylo devět dlaždic.
   */
  | { kind: 'duplicate'; file: string; asset: AssetRow }
  /** Kód je z registru chyb (3.14.7), obrazovka si ho přeloží katalogem. */
  | { kind: 'failed'; file: string; code: string };

/** Odmítnutí ještě před odesláním. Zbytečný požadavek na deset megabajtů nikoho nezajímá. */
export function localRejection(
  file: File,
  maxBytes: number,
): 'tooLargeLocal' | 'wrongTypeLocal' | null {
  if (file.size > maxBytes) return 'tooLargeLocal';
  // Typ hlásí operační systém a u části souborů je prázdný, proto se bere
  // i přípona. Skutečnou kontrolu dělá server magickým číslem; tahle vrstva
  // jen šetří deset megabajtů poslaných zbytečně.
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  const byType = type !== '' && ACCEPT_MIME_TYPES.includes(type);
  const byExtension = /\.(jpe?g|png|gif|webp|avif|svg)$/.test(name);
  return byType || byExtension ? null : 'wrongTypeLocal';
}

async function problemCode(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (body !== null && typeof body === 'object' && 'code' in body) {
    const code = (body as { code: unknown }).code;
    if (typeof code === 'string' && code !== '') return code;
  }
  // 413 bez těla je pořád srozumitelná informace: obálku RFC 9457 nemusí
  // dodat proxy, která požadavek utne dřív, než dojde k aplikaci.
  if (response.status === 413) return 'payload_too_large';
  if (response.status === 403) return 'forbidden';
  return 'unknown';
}

export async function uploadOne(input: {
  file: File;
  workspaceId: string;
  maxBytes: number;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<UploadOutcome> {
  const rejection = localRejection(input.file, input.maxBytes);
  if (rejection !== null) return { kind: 'failed', file: input.file.name, code: rejection };

  const form = new FormData();
  form.append('file', input.file);

  const doFetch = input.fetchImpl ?? globalThis.fetch.bind(globalThis);
  let response: Response;
  try {
    /*
     * `Content-Type` se NENASTAVUJE. Tělo je `FormData` a prohlížeč si k němu
     * musí doplnit `boundary=`; jakmile se do hlavičky sáhne, boundary chybí
     * a server multipart nerozebere.
     *
     * `X-Workspace-Id` naopak být MUSÍ. Bez něj nemá middleware
     * `apps/web/src/lib/api/authenticate.ts` z čeho vzít projekt (cesta
     * `/api/v1/...` segment `/w/{slug}` nenese) a vrátí 404 ještě před
     * handlerem, tedy chybu, která vypadá jako „endpoint neexistuje".
     */
    response = await doFetch('/api/v1/assets', {
      method: 'POST',
      headers: { 'X-Workspace-Id': input.workspaceId },
      body: form,
    });
  } catch {
    // Spadlé spojení. Bez tohohle by se odmítnutý `fetch` propsal jako
    // neodchycená výjimka a z celého nahrávání by nezbylo ani hlášení.
    return { kind: 'failed', file: input.file.name, code: 'unknown' };
  }

  if (response.status >= 400) {
    return { kind: 'failed', file: input.file.name, code: await problemCode(response) };
  }

  const body = (await response.json().catch(() => null)) as ApiAsset | null;
  if (body === null) return { kind: 'failed', file: input.file.name, code: 'unknown' };

  return {
    // 200 znamená deduplikaci, 201 nový řádek. Rozlišení je v API popsané
    // výslovně a knihovna ho potřebuje, aby dlaždici nepřidala dvakrát.
    kind: response.status === 200 ? 'duplicate' : 'created',
    file: input.file.name,
    asset: toAssetRow(body),
  };
}

export async function uploadMany(input: {
  files: readonly File[];
  workspaceId: string;
  maxBytes: number;
  onProgress?: (done: number, total: number, current: string) => void;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<UploadOutcome[]> {
  const outcomes: UploadOutcome[] = [];
  for (const [index, file] of input.files.entries()) {
    input.onProgress?.(index, input.files.length, file.name);
    outcomes.push(
      await uploadOne({
        file,
        workspaceId: input.workspaceId,
        maxBytes: input.maxBytes,
        ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
      }),
    );
  }
  input.onProgress?.(input.files.length, input.files.length, '');
  return outcomes;
}
