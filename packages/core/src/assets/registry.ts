/**
 * Registr variant a přijímaných formátů (specifikace 3.14.1 a 3.14.2).
 *
 * PROČ REGISTR A NE `CHECK` V DATABÁZI. Sloupec `asset_variants.variant` má
 * v migraci jen tvarové omezení `^[a-z][a-z0-9_]{0,15}$`; schéma to říká
 * výslovně a s odůvodněním. Uzavřený výčet v databázi by z přidání varianty
 * udělal `ALTER TABLE ... DROP CONSTRAINT` u každé self-hosted instalace,
 * což je nejrizikovější operace, jakou tenhle produkt umí. Přidání varianty
 * je proto řádek v tomhle souboru plus doběhnutí `content.process_asset` nad
 * existujícími assety, ne migrace.
 */

/** Delší strana originálu po zpracování. Specifikace 3.14.1. */
export const MAX_STORED_DIMENSION = 2000;

/** Tvrdý strop na vstupu, `sharp` `limitInputPixels`. Specifikace 3.14.1. */
export const MAX_INPUT_PIXELS = 50_000_000;

/** Rasterizace SVG: cílová šířka a hustota. Specifikace 3.13.10, krok 2. */
export const SVG_RASTER_WIDTH = 1200;
export const SVG_RASTER_DENSITY = 144;

export type VariantSpec = {
  readonly name: string;
  /** Cílová šířka v pixelech. */
  readonly width: number;
  /**
   * `cover` ořízne na čtverec, `inside` zmenší se zachováním poměru stran.
   * Miniatura je čtvercová schválně: knihovna v editoru je mřížka a obrázky
   * s různým poměrem stran by v ní skákaly.
   */
  readonly fit: 'cover' | 'inside';
  /**
   * Vzniká i tehdy, když je originál užší. Platí jen pro `thumb`: zvětšovat
   * fotku do `w1200` nemá smysl, přidá to bajty a nepřidá pixely.
   */
  readonly always: boolean;
};

/**
 * Odvozené velikosti. `orig` v seznamu ZÁMĚRNĚ NENÍ: není odvozená, je to
 * uložený originál a vzniká jinou cestou (normalizace při nahrání).
 *
 * Pořadí je od nejširší, aby výběr varianty v emitteru dostal seřazený vstup
 * bez dalšího řazení.
 */
export const DERIVED_VARIANTS: readonly VariantSpec[] = [
  { name: 'w1200', width: 1200, fit: 'inside', always: false },
  { name: 'w600', width: 600, fit: 'inside', always: false },
  { name: 'w300', width: 300, fit: 'inside', always: false },
  { name: 'thumb', width: 160, fit: 'cover', always: true },
];

/** Jméno varianty originálu. Emitter na něj padá, když nic lepšího nenajde. */
export const ORIGINAL_VARIANT = 'orig';

/**
 * Formáty, které se ULOŽÍ tak, jak přišly (po případném zmenšení).
 * WebP a AVIF v seznamu nejsou schválně: Outlook a starší Apple Mail je
 * nezobrazí, takže se převádějí. Kdo je nechá projít, vyrobí e-mail, ve kterém
 * části příjemců chybí obrázek, a nikdo to nenahlásí, protože odesílatel vidí
 * svůj Gmail, kde to funguje.
 */
export const STORED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif'] as const;
export type StoredMimeType = (typeof STORED_MIME_TYPES)[number];

/** Přípona v adrese `<base>/a/<public_id>/<variant>.<ext>`. */
export const EXTENSION_BY_MIME: Record<StoredMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
};

/**
 * Opačný směr, pro veřejnou trasu. Ta dostane příponu z adresy a musí ověřit,
 * že sedí na uložený typ; jinak by `.png` v odkazu vydalo JPEG a klient by
 * podle přípony hádal typ, který mu server v hlavičce říká jinak.
 */
export const MIME_BY_EXTENSION: Record<string, StoredMimeType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
};

export function isStoredMimeType(value: string): value is StoredMimeType {
  return (STORED_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * Varianty, které se pro daný asset mají vyrobit.
 *
 * ANIMOVANÝ GIF DOSTANE JEN `thumb`, a to z prvního snímku. Zmenšení animace
 * přes `sharp` bez `{ animated: true }` zahodí všechny snímky kromě prvního,
 * takže by z animace v e-mailu zbyl statický obrázek, aniž by cokoli selhalo.
 * Specifikace 3.14.2 to řeší tím, že animovaný GIF varianty prostě nemá.
 */
export function variantsFor(input: {
  width: number;
  height: number;
  animated: boolean;
}): readonly VariantSpec[] {
  if (input.animated) {
    return DERIVED_VARIANTS.filter((variant) => variant.name === 'thumb');
  }
  return DERIVED_VARIANTS.filter((variant) => variant.always || input.width > variant.width);
}
