/**
 * Rozpoznání formátu nahraného souboru z MAGICKÉHO ČÍSLA.
 *
 * NIKDY z přípony a nikdy z `Content-Type` v multipartu. Obojí píše prohlížeč
 * podle toho, co mu řekl operační systém, takže obojí umí odesílatel nastavit
 * na cokoli. Kdyby se typ bral odtud, stačilo by pojmenovat spustitelný soubor
 * `logo.png` a instalace by ho uložila a vydávala z veřejné adresy s hlavičkou
 * `image/png`. `X-Content-Type-Options: nosniff` na výdeji to zmírní, ale
 * neřeší: soubor by na disku pořád byl a šel by stáhnout.
 *
 * ODCHYLKA OD SPECIFIKACE, VĚDOMÁ. Kapitola 3.14.1 jmenuje balíček `file-type`.
 * Tenhle soubor ho nahrazuje tabulkou sedmi podpisů a důvod je věcný: seznam,
 * který produkt PŘIJÍMÁ, má tři položky, seznam, který musí ODMÍTNOUT
 * s konkrétním kódem, čtyři. `file-type` zná přes sto formátů, ze kterých by
 * se stejně všechny ostatní mapovaly na `asset_unsupported_format`, takže by
 * přinesl závislost navíc a ani jednu odpověď navíc. Druhá kontrola je stejně
 * `sharp` při dekódování; tahle vrstva existuje proto, aby se k dekodéru
 * nedostal soubor, který obrázek není.
 */

/** Co s formátem uděláme. Rozhoduje o tom pipeline v `image.ts`. */
export type DetectedFormat =
  | { kind: 'raster'; format: 'jpeg' | 'png' | 'gif' }
  /** Přijímáme na vstupu, ale ukládáme převedené na PNG nebo JPEG. */
  | { kind: 'convert'; format: 'webp' | 'avif' }
  /** Sanitizuje se a rasterizuje na PNG, originál se neukládá. */
  | { kind: 'svg' }
  /** Známý obrázkový formát, který nepodporujeme. Hlásí se jménem. */
  | { kind: 'rejected'; format: string }
  /** Není to obrázek, nebo je soubor tak krátký, že se to nedá poznat. */
  | { kind: 'unknown' };

function startsWith(buffer: Buffer, bytes: readonly number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

function ascii(buffer: Buffer, offset: number, length: number): string {
  return buffer.subarray(offset, offset + length).toString('latin1');
}

/**
 * Značky `ftyp` z rodiny ISO BMFF. AVIF a HEIC mají TENTÝŽ kontejner a liší se
 * jen značkou, takže rozlišit je podle prvních čtyř bajtů NEJDE: obojí začíná
 * čtyřbajtovou délkou, po níž následuje `ftyp`. Proto se čte offset 8.
 */
const BMFF_ACCEPTED = new Set(['avif', 'avis']);
const BMFF_REJECTED = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);

/**
 * SVG je text, ne binárka, takže podpis nemá. Hledá se `<svg` v prvních
 * bajtech, po přeskočení BOM, bílých znaků, XML deklarace, komentářů
 * a DOCTYPE. Zbytek (entity, skripty) řeší `sanitizeSvg`, který se pouští
 * až potom.
 */
function looksLikeSvg(buffer: Buffer): boolean {
  const head = buffer
    .subarray(0, 1024)
    .toString('utf8')
    .replace(/^\uFEFF/, '');
  return /^\s*(?:<\?xml[^>]*\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i.test(head);
}

export function detectFormat(buffer: Buffer): DetectedFormat {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return { kind: 'raster', format: 'jpeg' };
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'raster', format: 'png' };
  }
  if (ascii(buffer, 0, 6) === 'GIF87a' || ascii(buffer, 0, 6) === 'GIF89a') {
    return { kind: 'raster', format: 'gif' };
  }
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 4) === 'WEBP') {
    return { kind: 'convert', format: 'webp' };
  }
  if (ascii(buffer, 4, 4) === 'ftyp') {
    const brand = ascii(buffer, 8, 4).toLowerCase();
    if (BMFF_ACCEPTED.has(brand)) return { kind: 'convert', format: 'avif' };
    if (BMFF_REJECTED.has(brand)) return { kind: 'rejected', format: 'heic' };
    return { kind: 'unknown' };
  }
  // Tiff: little i big endian. Obojí je platný TIFF a obojí odmítáme.
  if (
    startsWith(buffer, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWith(buffer, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return { kind: 'rejected', format: 'tiff' };
  }
  if (startsWith(buffer, [0x42, 0x4d])) return { kind: 'rejected', format: 'bmp' };
  if (looksLikeSvg(buffer)) return { kind: 'svg' };
  return { kind: 'unknown' };
}
