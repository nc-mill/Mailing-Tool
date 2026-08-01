/**
 * Průhledný GIF 1x1, 42 bajtů. Konstanta, ne generovaná hodnota:
 * pixel se vrací u každého otevření a nemá smysl ho skládat za běhu.
 */
export const PIXEL_GIF: Buffer = Buffer.from(
  '47494638396101000100800000000000ffffff21f90401000000002c000000000100010000020144003b',
  'hex',
);

/**
 * Hlavičky z 3.2.2. Cache-Control je jediné, čím můžeme proxy požádat,
 * aby si pixel neuložila. Uloží si ho stejně, ale zkusit se to musí.
 */
export const PIXEL_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Type': 'image/gif',
  'Content-Length': String(PIXEL_GIF.length),
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0, private',
  Pragma: 'no-cache',
  Expires: '0',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
});
