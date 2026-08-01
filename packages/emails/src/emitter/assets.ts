import type { AssetRef } from '../compile/types';

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
};

/** Veřejná adresa assetu podle 3.14.4: <ASSET_BASE_URL>/a/{public_id}/{variant}.{ext} */
export function assetUrl(baseUrl: string, asset: AssetRef, variant: string): string {
  const extension = EXTENSION_BY_MIME[asset.mimeType] ?? 'png';
  return `${baseUrl.replace(/\/$/, '')}/a/${asset.publicId}/${variant}.${extension}`;
}

/**
 * Nejmenší varianta aspoň dvojnásobku zobrazované šířky, kvůli displejům s vysokým DPI.
 * Animovaný GIF varianty nemá, protože zpracování by animaci zahodilo.
 */
export function pickVariant(asset: AssetRef, displayWidth: number): string {
  if (asset.animated) return 'orig';
  const wanted = displayWidth * 2;
  const usable = asset.variants
    .filter((variant) => variant.variant !== 'thumb')
    .slice()
    .sort((a, b) => a.width - b.width);
  const found = usable.find((variant) => variant.width >= wanted);
  return found?.variant ?? usable[usable.length - 1]?.variant ?? 'orig';
}

/** Ikony sítí dodává produkt, nejsou to assety projektu. Viz požadavek R6. */
export function socialIconUrl(baseUrl: string, network: string, style: string): string {
  return `${baseUrl.replace(/\/$/, '')}/a/social/${network}-${style}@2x.png`;
}
