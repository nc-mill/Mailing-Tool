import iconv from 'iconv-lite';
import { invalidImport } from './errors';

export type SupportedEncoding =
  'utf-8' | 'windows-1250' | 'iso-8859-2' | 'windows-1252' | 'iso-8859-1';
export type EncodingSource = 'bom' | 'utf8_validation' | 'score' | 'manual';
export type DetectedEncoding = {
  encoding: SupportedEncoding;
  source: EncodingSource;
  bomLength: number;
};

export const CZECH_SCORE_TABLE = {
  positive: 'áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ',
  negative: '¡¢£¤¥¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿×÷',
} as const;

/** Pořadí je rozstřel při rovnosti skóre: windows-1250 první, protože český Excel. */
const CANDIDATES: SupportedEncoding[] = [
  'windows-1250',
  'iso-8859-2',
  'windows-1252',
  'iso-8859-1',
];

function unsupported(reason: string): never {
  invalidImport('_', 'unsupported_encoding', `Encoding ${reason} is not supported.`, { reason });
}

/** score = 2 × česká písmena − 3 × symbolový šum. */
export function scoreCandidate(text: string): number {
  let score = 0;
  for (const ch of text) {
    if (CZECH_SCORE_TABLE.positive.includes(ch)) score += 2;
    else if (CZECH_SCORE_TABLE.negative.includes(ch)) score -= 3;
  }
  return score;
}

/**
 * Ořízne vzorek na poslední úplný kódový bod, aby striktní validace UTF-8
 * nespadla na useknutém znaku a soubor v UTF-8 se kvůli hranici vzorku
 * neoznačil za jednobajtovou kódovou stránku.
 */
function trimToCodePoint(buf: Buffer): Buffer {
  for (let back = 0; back < 4 && back < buf.length; back += 1) {
    const byte = buf[buf.length - 1 - back];
    if (byte === undefined) return buf;
    if ((byte & 0b1100_0000) !== 0b1000_0000) {
      const needed = byte < 0x80 ? 1 : byte < 0xe0 ? 2 : byte < 0xf0 ? 3 : 4;
      return back + 1 === needed ? buf : buf.subarray(0, buf.length - 1 - back);
    }
  }
  return buf;
}

/**
 * Tři kroky v závazném pořadí: BOM, striktní validace UTF-8, skóre podle českých
 * písmen. Statistický detektor tuhle úlohu neumí: `chardet` vrací pro skutečná
 * data v CP1250 hodnotu `windows-1252`, protože se ty dvě kódové stránky liší
 * jen v horní polovině a mají podobné rozložení bajtů (rozhodnutí R3).
 */
export function detectEncoding(buffer: Buffer, sniffBytes = 262_144): DetectedEncoding {
  // 1. BOM. UTF-32 se testuje první, protože jeho little endian BOM začíná
  //    stejnými dvěma bajty jako UTF-16 LE.
  if (
    buffer.length >= 4 &&
    ((buffer[0] === 0xff && buffer[1] === 0xfe && buffer[2] === 0x00 && buffer[3] === 0x00) ||
      (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0xfe && buffer[3] === 0xff))
  ) {
    unsupported('utf-32');
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { encoding: 'utf-8', source: 'bom', bomLength: 3 };
  }
  if (
    buffer.length >= 2 &&
    ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff))
  ) {
    unsupported('utf-16');
  }

  const sample = trimToCodePoint(buffer.subarray(0, sniffBytes));

  // 2. Striktní validace UTF-8. Čistě ASCII soubor sem spadne také, což je správně.
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
    return { encoding: 'utf-8', source: 'utf8_validation', bomLength: 0 };
  } catch {
    // pokračuje se skórováním
  }

  // 3. Skóre kandidátů. Při rovnosti vyhrává windows-1250, protože je první
  //    v pořadí a porovnání je ostré.
  let best: { encoding: SupportedEncoding; score: number } | null = null;
  for (const candidate of CANDIDATES) {
    const score = scoreCandidate(iconv.decode(sample, candidate));
    if (best === null || score > best.score) best = { encoding: candidate, score };
  }
  if (best === null) unsupported('no candidate');
  return { encoding: best.encoding, source: 'score', bomLength: 0 };
}

export function decodeSample(buffer: Buffer, detected: DetectedEncoding): string {
  const body = buffer.subarray(detected.bomLength);
  return iconv.decode(body, detected.encoding);
}

/** Tři nejpravděpodobnější alternativy pro tlačítko „Ne, je to rozsypané". */
export function alternativeEncodings(current: SupportedEncoding): SupportedEncoding[] {
  return (['utf-8', 'windows-1250', 'iso-8859-2', 'windows-1252'] as SupportedEncoding[])
    .filter((e) => e !== current)
    .slice(0, 3);
}
