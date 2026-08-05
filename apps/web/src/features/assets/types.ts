/**
 * Tvar obrázku, se kterým pracuje knihovna médií.
 *
 * Je to camelCase PŘEPIS odpovědi `/api/v1/assets`, ne její snake_case podoba,
 * a překlad dělá `toAssetRow` níž. Důvod je v tom, že tentýž tvar plní jak
 * serverová stránka (první vykreslení), tak klientské dohledání po nahrání
 * a po hledání. Kdyby si každá cesta nesla vlastní tvar, lišily by se
 * v drobnostech (chybějící `usedBy`, jiné jméno `thumbnailUrl`) a projevilo
 * by se to až blikáním dlaždice po nahrání.
 */
export type AssetUsageRef = {
  /** `template`, `template_version`, `campaign` nebo `brand_profile`. */
  type: string;
  id: string;
  name: string;
};

export type AssetRow = {
  id: string;
  publicId: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  animated: boolean;
  altText: string | null;
  originalFilename: string;
  source: string;
  url: string;
  thumbnailUrl: string;
  referenceCount: number;
  hidden: boolean;
  usedBy: AssetUsageRef[];
  createdAt: string;
};

/** Odpověď API tak, jak přichází po drátě. Klíče jsou snake_case podle konvence 4.1. */
export type ApiAsset = {
  id: string;
  public_id: string;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  animated: boolean;
  alt_text: string | null;
  original_filename: string;
  source: string;
  url: string;
  thumbnail_url: string;
  reference_count: number;
  hidden: boolean;
  used_by?: AssetUsageRef[];
  created_at: string;
};

export type ApiAssetList = {
  data: ApiAsset[];
  pagination: { next_cursor: string | null; has_more: boolean; limit: number };
};

export function toAssetRow(item: ApiAsset): AssetRow {
  return {
    id: item.id,
    publicId: item.public_id,
    mimeType: item.mime_type,
    byteSize: item.byte_size,
    width: item.width,
    height: item.height,
    animated: item.animated,
    altText: item.alt_text,
    originalFilename: item.original_filename,
    source: item.source,
    url: item.url,
    // Miniatura se bere z `thumbnail_url`, který API dopočítává a u starého
    // assetu bez varianty `thumb` padá na originál. Skládat adresu tady by
    // znamenalo druhé místo, které zná tvar `/a/<id>/<varianta>.<přípona>`,
    // a to je přesně to, co se rozejde.
    thumbnailUrl: item.thumbnail_url,
    referenceCount: item.reference_count,
    hidden: item.hidden,
    usedBy: item.used_by ?? [],
    createdAt: item.created_at,
  };
}

/**
 * Velikost souboru pro člověka.
 *
 * Dělí se 1024, ne 1000, protože týmž dělitelem počítá limit nahrání
 * (`ASSET_MAX_UPLOAD_MB * 1024 * 1024` v `assets/service.ts`). Kdyby se
 * v knihovně počítalo desítkově, uživatel by u souboru na hraně viděl
 * „9,8 MB" a server by ho odmítl jako větší než 10 MB.
 */
export function formatBytes(bytes: number, locale: string): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString(locale, { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}
