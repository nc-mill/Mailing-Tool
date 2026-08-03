import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { loadConfig } from '@mlain/core/config';
import {
  createFileAssetStorage,
  publicAssetPath,
  resolvePublicAsset,
  safeDownloadFilename,
  verifyAssetSignature,
} from '@mlain/core/assets';

/**
 * Veřejný výdej obrázku: `GET /a/<public_id>/<variant>.<ext>` (specifikace 3.14.4).
 *
 * BEZ AUTENTIZACE, BEZ SESSION, BEZ CSRF, a je to jediná možná varianta.
 * Požadavek nepřichází z prohlížeče přihlášeného uživatele, ale z poštovního
 * klienta PŘÍJEMCE, případně z proxy Gmailu. Cokoli s přihlášením nebo expirací
 * by rozbilo obrázky přesně u klientů, na kterých nejvíc záleží. Vysvětlení,
 * proč to není díra do izolace projektů, je v `packages/core/src/assets/public.ts`
 * a v migraci `0011_asset_public_lookup.sql`.
 *
 * Runtime je Node.js, ne edge: potřebujeme `pg`, `node:fs` a `node:crypto`.
 * Týž tvar má veřejná trasa trackingu `/t/**`.
 *
 * PROXY SE TÉHLE CESTY NETÝKÁ. Matcher v `src/proxy.ts` vynechává všechno
 * s tečkou v cestě (`/((?!_next|favicon.ico|.*\\..*).*)`) a adresa obrázku
 * tečku vždycky má, protože končí příponou. Není to náhoda, na kterou se
 * spoléhá potichu: kdyby se matcher změnil, tahle trasa začne chodit přes
 * autentizaci a všechny obrázky ve všech odeslaných e-mailech vrátí
 * přesměrování na přihlášení.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  return serve(request, await params, true);
}

/**
 * HEAD musí existovat vedle GET. Poštovní klienti i cache proxy si jím ověřují
 * platnost odkazu; bez něj by dostali 405 a část z nich obrázek vůbec nestáhne.
 * Tělo se u HEAD neposílá, hlavičky jsou stejné.
 */
export async function HEAD(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  return serve(request, await params, false);
}

function notFound(): Response {
  // Prázdné tělo a `nosniff`. Chybějící obrázek je strojová odpověď pro
  // poštovního klienta, ne stránka pro člověka, a stránka s vysvětlením by
  // navíc prozradila, že instalace na téhle adrese vůbec je.
  return new Response(null, {
    status: 404,
    headers: { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' },
  });
}

async function serve(
  request: Request,
  params: { path?: string[] },
  withBody: boolean,
): Promise<Response> {
  const segments = params.path ?? [];
  // Přesně dva segmenty: identifikátor a jméno souboru. Delší cesta není
  // „skoro dobrá adresa", je to pokus o něco jiného.
  if (segments.length !== 2) return notFound();
  const [publicId, file] = segments as [string, string];

  const config = loadConfig();

  const found = await resolvePublicAsset(publicId, file);
  if (found === null) return notFound();

  if (config.ASSET_REQUIRE_SIGNED_URL) {
    const signature = new URL(request.url).searchParams.get('s') ?? '';
    // Ověřuje se TÁŽ cesta, jakou skládá `publicAssetUrl`, ne surový
    // `request.url`. Ten nese schéma, host a případné další parametry, takže
    // by se podpis rozešel při každém nasazení za jinou doménu.
    // Keyring si dotáhne `verifyAssetSignature` sám z prostředí. Klíče vlastní
    // doména, ne stránka: `apps/web` nemá `@mlain/contracts` mezi závislostmi
    // a mít ho nemá, stejně jako u nonce hostovaného formuláře.
    const path = publicAssetPath(publicId, ...splitVariant(file), found.mimeType);
    if (!verifyAssetSignature(path, signature)) return notFound();
  }

  const storage = createFileAssetStorage(config.UPLOADS_DIR);
  const absolute = storage.resolve(found.storageKey);
  const extension = file.slice(file.lastIndexOf('.') + 1);

  /*
   * Hlavičky jsou doslova z 3.14.4 a každá má důvod:
   *
   *  - `immutable` je bezpečné, protože adresa nese `public_id` navázaný na
   *    obsah. Změna obrázku znamená NOVÝ asset a NOVOU adresu, nikdy přepsání
   *    pod stejnou.
   *  - `Access-Control-Allow-Origin: *` a `Cross-Origin-Resource-Policy` musí
   *    být, protože obrázek načítá cizí původ (webmail příjemce).
   *  - `nosniff` brání tomu, aby prohlížeč hádal typ podle obsahu. Typ jsme
   *    určili z magického čísla při nahrání a je uložený v databázi, takže
   *    hádání může vést jen k horšímu výsledku.
   *  - `Content-Disposition: inline` se sanitizovaným jménem. Jméno pochází
   *    z multipartu, tedy z internetu; nesanitizované by uvozovkou nebo
   *    novým řádkem rozdělilo odpověď.
   */
  const headers = new Headers({
    'Content-Type': found.mimeType,
    'Content-Length': String(found.byteSize),
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: `"${found.sha256Hex.slice(0, 16)}"`,
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `inline; filename="${safeDownloadFilename(found.originalFilename, extension)}"`,
  });

  // Podmíněný požadavek. Gmail i Outlook obrázky cachují a ptají se přes
  // `If-None-Match`; bez 304 by se každý otevřený e-mail počítal jako plné
  // stažení souboru.
  if (request.headers.get('if-none-match') === headers.get('ETag')) {
    return new Response(null, { status: 304, headers });
  }

  if (!withBody) return new Response(null, { status: 200, headers });

  try {
    // Streamuje se, nečte se do paměti. Obrázek má do 10 MiB, ale kampaň na
    // 50 000 lidí znamená tisíce souběžných požadavků a plné načtení každého
    // z nich do bufferu je přesně ten způsob, jak procesu dojde paměť.
    const stream = createReadStream(absolute);
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers });
  } catch {
    // Řádek v databázi je a soubor ne. Je to nesoulad, který má najít
    // `mlain doctor`, ale klientovi se z něj nesmí stát pětistovka.
    return notFound();
  }
}

/** `w600.png` na dvojici pro `publicAssetPath`, který skládá příponu z typu. */
function splitVariant(file: string): [string] {
  return [file.slice(0, file.lastIndexOf('.'))];
}
