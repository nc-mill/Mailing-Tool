import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseKeyring } from '@mlain/contracts/keyring';
import { assetUrl } from '@mlain/emails/emitter/assets';
import { detectFormat } from './detect';
import { AssetProcessingError, normalizeUpload, renderVariants } from './image';
import { generatePublicId, PUBLIC_ID_PATTERN } from './public-id';
import { parseVariantFile, safeDownloadFilename } from './public';
import { MAX_STORED_DIMENSION, variantsFor } from './registry';
import { assetStorageKey, createFileAssetStorage } from './storage';
import { publicAssetUrl, signAssetPath, verifyAssetSignature } from './urls';

/** 32 bajtů base64url, tedy platný `SECRET_KEY`. Testovací, nikde jinde se nepoužívá. */
const KEYRING = parseKeyring({ secretKey: 'A'.repeat(43) });

async function png(width: number, height: number, alpha = false): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: alpha ? 4 : 3,
      background: alpha ? { r: 200, g: 30, b: 40, alpha: 0.5 } : { r: 200, g: 30, b: 40 },
    },
  })
    .png()
    .toBuffer();
}

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 9, g: 200, b: 30 } } })
    .jpeg()
    .toBuffer();
}

describe('rozpoznání formátu magickým číslem', () => {
  it('pozná JPEG, PNG a GIF', async () => {
    expect(detectFormat(await jpeg(4, 4))).toEqual({ kind: 'raster', format: 'jpeg' });
    expect(detectFormat(await png(4, 4))).toEqual({ kind: 'raster', format: 'png' });
    expect(detectFormat(Buffer.from('GIF89a...........', 'latin1'))).toEqual({
      kind: 'raster',
      format: 'gif',
    });
  });

  it('WebP a AVIF přijímá jako formáty k převodu', async () => {
    const webp = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .webp()
      .toBuffer();
    expect(detectFormat(webp)).toEqual({ kind: 'convert', format: 'webp' });
  });

  it('TIFF, BMP a HEIC odmítá jmenovitě', () => {
    expect(detectFormat(Buffer.from([0x49, 0x49, 0x2a, 0x00, 0, 0, 0, 0]))).toEqual({
      kind: 'rejected',
      format: 'tiff',
    });
    expect(detectFormat(Buffer.from('BM......', 'latin1'))).toEqual({
      kind: 'rejected',
      format: 'bmp',
    });
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypheic', 'latin1'),
      Buffer.alloc(8),
    ]);
    expect(detectFormat(heic)).toEqual({ kind: 'rejected', format: 'heic' });
  });

  it('pozná SVG i s XML deklarací a komentářem před kořenem', () => {
    const svg = '<?xml version="1.0"?>\n<!-- pozn -->\n<svg xmlns="http://www.w3.org/2000/svg"/>';
    expect(detectFormat(Buffer.from(svg, 'utf8'))).toEqual({ kind: 'svg' });
  });

  it('PŘÍPONA ANI DEKLAROVANÝ TYP NEROZHODUJÍ: text pojmenovaný .png je neznámý', () => {
    expect(detectFormat(Buffer.from('#!/bin/sh\nrm -rf /\n', 'utf8'))).toEqual({ kind: 'unknown' });
  });
});

describe('normalizace nahraného obrázku', () => {
  it('nepodporovaný formát hlásí asset_unsupported_format', async () => {
    await expect(normalizeUpload(Buffer.from('BMxxxxxxxx', 'latin1'))).rejects.toMatchObject({
      code: 'asset_unsupported_format',
    });
  });

  it('WebP bez alfy převede na JPEG, s alfou na PNG', async () => {
    const opaque = await sharp({
      create: { width: 20, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .webp()
      .toBuffer();
    expect((await normalizeUpload(opaque)).mimeType).toBe('image/jpeg');

    const transparent = await sharp({
      create: { width: 20, height: 20, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.2 } },
    })
      .webp()
      .toBuffer();
    expect((await normalizeUpload(transparent)).mimeType).toBe('image/png');
  });

  it('zmenší delší stranu na 2000 px a menší obrázek nezvětšuje', async () => {
    const big = await normalizeUpload(await jpeg(3000, 1500));
    expect(big.width).toBe(MAX_STORED_DIMENSION);
    expect(big.height).toBe(1000);

    const small = await normalizeUpload(await jpeg(120, 60));
    expect([small.width, small.height]).toEqual([120, 60]);
  });

  it('SVG sanitizuje a rasterizuje na PNG, skript nepřežije', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">
      <rect width="100" height="50" fill="#c00"/>
      <script>alert(1)</script>
    </svg>`;
    const out = await normalizeUpload(Buffer.from(svg, 'utf8'));
    expect(out.mimeType).toBe('image/png');
    expect(out.width).toBeGreaterThan(0);
    // Výstup jsou bajty PNG, tedy v nich žádné XML ani skript být nemůže.
    expect(out.data.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(out.data.includes(Buffer.from('alert', 'utf8'))).toBe(false);
  });

  it('prázdný a nečitelný soubor hlásí asset_corrupt, ne pětistovku', async () => {
    // Podpis PNG bez zbytku souboru: detekce ho propustí, dekodér ne.
    const broken = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    await expect(normalizeUpload(broken)).rejects.toBeInstanceOf(AssetProcessingError);
    await expect(normalizeUpload(broken)).rejects.toMatchObject({ code: 'asset_corrupt' });
  });

  it('zahodí EXIF metadata, tedy i GPS souřadnice', async () => {
    const withExif = await sharp({
      create: { width: 30, height: 30, channels: 3, background: { r: 5, g: 5, b: 5 } },
    })
      .withExif({ IFD0: { Copyright: 'tajne', Software: 'GPS 50.08N 14.43E' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const normalized = await normalizeUpload(withExif);
    expect((await sharp(normalized.data).metadata()).exif).toBeUndefined();
  });
});

describe('registr variant', () => {
  it('širokému obrázku dá všechny odvozené velikosti', () => {
    expect(variantsFor({ width: 1600, height: 900, animated: false }).map((v) => v.name)).toEqual([
      'w1200',
      'w600',
      'w300',
      'thumb',
    ]);
  });

  it('úzkému obrázku dá jen ty menší a vždycky miniaturu', () => {
    expect(variantsFor({ width: 400, height: 400, animated: false }).map((v) => v.name)).toEqual([
      'w300',
      'thumb',
    ]);
    expect(variantsFor({ width: 100, height: 100, animated: false }).map((v) => v.name)).toEqual([
      'thumb',
    ]);
  });

  it('animovaný GIF má JEN miniaturu, protože zmenšení by zahodilo snímky', () => {
    expect(variantsFor({ width: 1600, height: 900, animated: true }).map((v) => v.name)).toEqual([
      'thumb',
    ]);
  });
});

describe('generování variant', () => {
  it('miniatura je čtvercová a odvozené velikosti drží poměr stran', async () => {
    const original = await normalizeUpload(await jpeg(1600, 800));
    const variants = await renderVariants(original);
    const thumb = variants.find((v) => v.variant === 'thumb');
    expect([thumb?.width, thumb?.height]).toEqual([160, 160]);
    const w600 = variants.find((v) => v.variant === 'w600');
    expect([w600?.width, w600?.height]).toEqual([600, 300]);
  });

  it('varianta si drží typ originálu, jinak by adresa v e-mailu lhala příponou', async () => {
    const original = await normalizeUpload(await png(800, 400, true));
    for (const variant of await renderVariants(original)) {
      expect(variant.mimeType).toBe('image/png');
    }
  });
});

describe('veřejný identifikátor', () => {
  it('má 22 znaků base62 a nesmí se opakovat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const id = generatePublicId();
      expect(id).toMatch(PUBLIC_ID_PATTERN);
      seen.add(id);
    }
    expect(seen.size).toBe(2000);
  });

  it('rozdělení znaků je rovnoměrné, tedy bez modulo biasu', () => {
    // Kdyby se použilo `byte % 62`, prvních osm znaků abecedy by padalo
    // zhruba o 25 % častěji. Na 200 000 znacích je takový rozdíl neminutelný.
    const counts = new Map<string, number>();
    for (let i = 0; i < 10_000; i += 1) {
      for (const ch of generatePublicId()) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    const values = [...counts.values()];
    const expected = (10_000 * 22) / 62;
    expect(Math.max(...values)).toBeLessThan(expected * 1.15);
    expect(Math.min(...values)).toBeGreaterThan(expected * 0.85);
  });
});

describe('veřejná adresa', () => {
  it('má tvar ze specifikace a shoduje se s tím, co skládá emitter', () => {
    const url = publicAssetUrl('a'.repeat(22), 'w600', 'image/jpeg', {
      baseUrl: 'https://mail.example.cz/',
    });
    expect(url).toBe(`https://mail.example.cz/a/${'a'.repeat(22)}/w600.jpg`);
    // Renderer skládá adresu vlastní funkcí, protože nesmí sáhnout na
    // konfiguraci ani na keyring. Tenhle test je jediné, co drží obě
    // implementace u sebe; kdyby se rozešly, obrázky v e-mailu ukážou na 404.
    expect(url).toBe(
      assetUrl(
        'https://mail.example.cz/',
        {
          id: 'x',
          publicId: 'a'.repeat(22),
          mimeType: 'image/jpeg',
          width: 1,
          height: 1,
          altText: null,
          animated: false,
          variants: [],
        },
        'w600',
      ),
    );
  });

  it('podepsaná adresa projde ověřením a změna varianty ji zneplatní', () => {
    const path = `/a/${'b'.repeat(22)}/orig.png`;
    const signature = signAssetPath(path, KEYRING);
    expect(verifyAssetSignature(path, signature, KEYRING)).toBe(true);
    expect(verifyAssetSignature(`/a/${'b'.repeat(22)}/w600.png`, signature, KEYRING)).toBe(false);
    expect(verifyAssetSignature(path, 'x'.repeat(32), KEYRING)).toBe(false);
  });

  it('podpis platí i po rotaci klíče, jinak by rotace umazala obrázky', () => {
    const old = parseKeyring({ secretKey: '1:' + 'A'.repeat(43) });
    const path = `/a/${'c'.repeat(22)}/orig.png`;
    const signature = signAssetPath(path, old);
    const rotated = parseKeyring({
      secretKey: '2:' + 'B'.repeat(43),
      secretKeyPrevious: '1:' + 'A'.repeat(43),
    });
    expect(verifyAssetSignature(path, signature, rotated)).toBe(true);
  });
});

describe('rozebrání cesty veřejné adresy', () => {
  it('bere jen známé přípony a tvar varianty z databázového CHECKu', () => {
    expect(parseVariantFile('w600.png')).toEqual({ variant: 'w600', extension: 'png' });
    expect(parseVariantFile('orig.JPG')).toEqual({ variant: 'orig', extension: 'jpg' });
    expect(parseVariantFile('w600.svg')).toBeNull();
    expect(parseVariantFile('W600.png')).toBeNull();
    expect(parseVariantFile('.png')).toBeNull();
    expect(parseVariantFile('orig')).toBeNull();
    expect(parseVariantFile('../../etc/passwd.png')).toBeNull();
  });
});

describe('jméno souboru v hlavičce', () => {
  it('propouští jen bezpečné znaky, takže odpověď nejde rozdělit', () => {
    expect(safeDownloadFilename('logo firmy.png', 'png')).toBe('logo-firmy.png');
    // Uvozovka, CR i LF se každý zvlášť mění na pomlčku. Podstatné je, že se
    // v názvu neobjeví ani jeden z nich: uvozovka ukončí hodnotu hlavičky,
    // CRLF ji rozdělí a přidá útočníkovu vlastní hlavičku.
    expect(safeDownloadFilename('a"\r\nX-Injected: 1', 'jpg')).toBe('a---X-Injected--1.jpg');
    expect(safeDownloadFilename('../../secret', 'png')).toBe('secret.png');
    expect(safeDownloadFilename('', 'gif')).toBe('image.gif');
  });
});

describe('úložiště na disku', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mlain-assets-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('klíč je obsahově adresovaný a rozdělený podle prefixu hashe', () => {
    const key = assetStorageKey({
      workspaceId: '11111111-1111-1111-1111-111111111111',
      sha256Hex: 'abcdef' + '0'.repeat(58),
      variant: 'orig',
      mimeType: 'image/png',
    });
    expect(key).toBe(
      `assets/11111111-1111-1111-1111-111111111111/ab/cd/abcdef${'0'.repeat(58)}.png`,
    );
    const variantKey = assetStorageKey({
      workspaceId: '11111111-1111-1111-1111-111111111111',
      sha256Hex: 'abcdef' + '0'.repeat(58),
      variant: 'w600',
      mimeType: 'image/png',
    });
    expect(variantKey).toContain('.w600.png');
  });

  it('zapíše a přečte soubor, mazání je idempotentní', async () => {
    const storage = createFileAssetStorage(dir);
    const key = 'assets/ws/aa/bb/x.png';
    await storage.put(key, Buffer.from('data'));
    expect(await readFile(storage.resolve(key), 'utf8')).toBe('data');
    expect(await storage.size(key)).toBe(4);
    await storage.remove(key);
    await storage.remove(key);
    expect(await storage.size(key)).toBeNull();
  });

  it('NEVYDÁ ANI NEZAPÍŠE soubor mimo UPLOADS_DIR', async () => {
    const storage = createFileAssetStorage(dir);
    expect(() => storage.resolve('../../../etc/passwd')).toThrow(/mimo UPLOADS_DIR/);
    await expect(storage.put('../../evil.png', Buffer.from('x'))).rejects.toThrow(
      /mimo UPLOADS_DIR/,
    );
  });

  it('po zápisu nezůstane dočasný .part soubor', async () => {
    const storage = createFileAssetStorage(dir);
    await storage.put('assets/ws/cc/dd/y.png', Buffer.from('abc'));
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(join(dir, 'assets/ws/cc/dd'));
    expect(files).toEqual(['y.png']);
  });
});
