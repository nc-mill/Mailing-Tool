import { createHash } from 'node:crypto';

/**
 * Kontrakt 5: předání zkompilované šablony senderu.
 * Vlastní ho část 3 (kapitola 4.1), tenhle balíček drží jeho jazykově neutrální
 * půlku: přesné tvary značek, jednoprůchodovou náhradu a kontroly počtů.
 *
 * Značka odkazu je absolutní URL na doméně .invalid schválně: doména je
 * rezervovaná RFC 2606 a nikdy se nerozpustí, takže NEPROBĚHLÁ ZÁMĚNA DÁ
 * INERTNÍ ODKAZ, ne funkční odkaz na cizí server.
 */
export const CLICK_MARKER_PREFIX = 'https://track.mlain.invalid/c/';
export const OPEN_PIXEL_MARKER = '<!--ML_OPEN_PIXEL-->';
export const LINK_ID_LENGTH = 36;

/**
 * Vyhrazené řetězce, které validátor odmítne v jakémkoliv uživatelském textu
 * a které po náhradě nesmí zůstat ve výstupu.
 *
 * `ML_RAW_` je slot syrového bloku a žádá si ho P08. Kontrakt ho píše velkými
 * písmeny, ale P08 ho generuje malými, takže se porovnává BEZ OHLEDU NA VELIKOST
 * (rozhodnutí D16). Rozšíření je bezpečné: jsou to vyhrazené řetězce, takže
 * i `MLAIN.INVALID` v uživatelském textu má být odmítnuté.
 */
export const RESERVED_MARKERS = ['mlain.invalid', 'ML_OPEN_PIXEL', 'ML_ARG_', 'ML_RAW_'] as const;

/** Slot argumentu filtru: `ML_ARG_` plus čtyři číslice, viz část 3, 3.3.5a. */
export const FILTER_SLOT_PREFIX = 'ML_ARG_';
export const FILTER_SLOT_PATTERN = /ML_ARG_(\d{4})/gi;

/**
 * Slot syrového bloku: `ML_RAW_<nonce>_nnnn`.
 *
 * Mezi předponou a číslem je NONCE, ne rovnou číslice. P08 ho generuje na každý
 * render znovu (`randomBytes(8).toString('hex').slice(0, 10)`), aby uživatelský
 * text nemohl cizí slot odklonit ani při chybě validátoru, a v golden fixtures
 * ho přebíjí pevnou hodnotou, aby byl výstup deterministický.
 *
 * Délka nonce se proto NEVYNUCUJE. V produkci má deset znaků, ale fixtures P08
 * používají `goldennonce` (11) a `contractnonce` (13); vzor s `{10}` by na nich
 * spadl. Dřívější znění mělo `/ML_RAW_(\d{4})/gi`, což nenajde **ani jeden**
 * skutečný žeton, a byl to mrtvý kód, na který by někdo spoléhal.
 */
export const RAW_SLOT_PREFIX = 'ML_RAW_';
export const RAW_SLOT_PATTERN = /ML_RAW_([a-z0-9]+)_(\d{4})/gi;

/** Jmenný prostor pro UUIDv5, ze kterého se odvozuje link_id. */
export const LINK_ID_NAMESPACE = '6f9619ff-8b86-d011-b42d-00c04fc964ff';
export const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function openPixelHtml(url: string): string {
  return `<img src="${url}" width="1" height="1" alt="" style="display:none;max-height:0;overflow:hidden" />`;
}

/**
 * Deterministické odvození link_id. Kompilace může proběhnout víckrát
 * (předodesílací kontrola, odeslání, oprava pozastavené kampaně) a náhodné UUID
 * by změnilo compiled_html mezi běhy, rozpadlo golden fixtures a klik zaznamenaný
 * proti staré verzi by ukazoval na řádek, který už neexistuje.
 */
export function deriveLinkId(campaignId: string, position: number): string {
  const namespace = Buffer.from(LINK_ID_NAMESPACE.replace(/-/g, ''), 'hex');
  const name = Buffer.from(`${campaignId}:${position}`, 'utf8');
  const hash = createHash('sha1').update(namespace).update(name).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  // noUncheckedIndexedAccess dělá z čtení přes index `number | undefined`,
  // proto readUInt8 na pravé straně místo bytes[n].
  bytes[6] = (bytes.readUInt8(6) & 0x0f) | 0x50;
  bytes[8] = (bytes.readUInt8(8) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Jeden průchod přes pevný prefix, ne ReplaceAll v cyklu přes odkazy.
 * Při dvaceti odkazech a stokilobajtovém dokumentu by cyklus znamenal dvacet
 * průchodů, tedy 2 MB skenování na zprávu. Počet náhrad padá jako vedlejší produkt.
 */
export function replaceClickMarkers(
  source: string,
  resolve: (linkId: string) => string,
): { output: string; count: number } {
  let out = '';
  let cursor = 0;
  let count = 0;
  for (;;) {
    const index = source.indexOf(CLICK_MARKER_PREFIX, cursor);
    if (index === -1) break;
    const linkId = source.slice(
      index + CLICK_MARKER_PREFIX.length,
      index + CLICK_MARKER_PREFIX.length + LINK_ID_LENGTH,
    );
    if (!UUID_PATTERN.test(linkId)) {
      throw new Error(`neplatné link_id za značkou na pozici ${index}: ${JSON.stringify(linkId)}`);
    }
    out += source.slice(cursor, index) + resolve(linkId);
    cursor = index + CLICK_MARKER_PREFIX.length + LINK_ID_LENGTH;
    count += 1;
  }
  return { output: out + source.slice(cursor), count };
}

/** Pixel se nahrazuje jednou, ne všude. Kontrakt garantuje právě jeden výskyt. */
export function replaceOpenPixel(
  source: string,
  replacement: string,
): { output: string; count: number } {
  const index = source.indexOf(OPEN_PIXEL_MARKER);
  if (index === -1) return { output: source, count: 0 };
  return {
    output: source.slice(0, index) + replacement + source.slice(index + OPEN_PIXEL_MARKER.length),
    count: 1,
  };
}

export function countClickMarkers(source: string): number {
  let count = 0;
  let cursor = 0;
  for (;;) {
    const index = source.indexOf(CLICK_MARKER_PREFIX, cursor);
    if (index === -1) return count;
    count += 1;
    cursor = index + CLICK_MARKER_PREFIX.length;
  }
}

/**
 * Po náhradě nesmí ve výstupu zůstat žádný vyhrazený řetězec. Porovnává se po
 * převodu obou stran na malá písmena, viz rozhodnutí D16. Vrací se řetězec
 * v kontraktním tvaru, ne ten nalezený, aby hláška byla vždy stejná.
 */
export function findLeftoverMarker(output: string): string | undefined {
  const haystack = output.toLowerCase();
  return RESERVED_MARKERS.find((marker) => haystack.includes(marker.toLowerCase()));
}

/**
 * Tři kontroly počtu, které se NESMÍ slít do jedné. Liší se místem, četností
 * i porovnáním; kdyby se slily, buď se kampaň s podmíněným odkazem zastaví hned
 * na startu, nebo injektáž projde.
 */
export const MARKER_COUNT_CHECKS = Object.freeze({
  /** zdroj šablony, jednou při načtení kampaně do cache, rovnost */
  source: 'equals',
  /** výstup po náhradě, per zpráva, hledá zbytek */
  afterReplace: 'no-leftover',
  /** vyrenderovaný výstup, jen u náhradní cesty A, POUZE shora */
  rendered: 'not-greater',
});
