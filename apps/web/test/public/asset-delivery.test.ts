// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXTENSION_BY_MIME,
  MIME_BY_EXTENSION,
  NEVER_STORED_MIME_TYPES,
  STORED_MIME_TYPES,
  parseVariantFile,
} from '@mlain/core/assets';

/**
 * Brána na VÝDEJ obrázku (`GET /a/<public_id>/<variant>.<ext>`).
 *
 * PROČ SE ČTE ZDROJ TRASY A NESPOUŠTÍ SE. Handler potřebuje konfiguraci,
 * databázi a soubor na disku, takže by z toho byl integrační test se třemi
 * závislostmi, který by tvrzení „nedělá konverzi podle hlavičky" stejně
 * neprokázal: konverze by se neprojevila u obrázku, který v testu vyrobíme,
 * ale u toho, u kterého by ji někdo v budoucnu zapnul. Tvrzení je o TVARU
 * KÓDU, ne o jednom průchodu, takže se měří na kódu.
 *
 * Vada, které se předchází, je konkrétní a rozšířená: většina obrázkových
 * vrstev (`next/image`, Cloudflare Images, imgproxy) vydá WebP nebo AVIF, když
 * si o něj klient řekne hlavičkou `Accept`. V e-mailu ale žádný prohlížeč není.
 * Obrázek stahuje schránka příjemce, případně proxy Gmailu, a ta hlavičku
 * `Accept` posílá podle sebe. Zapnutá konverze by tedy poslala WebP do
 * Outlooku, který ho nezobrazí, a nikdo by to nenahlásil, protože odesílatel
 * si e-mail prohlíží ve svém Gmailu, kde je všechno v pořádku.
 */

const ROUTE = join(import.meta.dirname, '../../src/app/a/[[...path]]/route.ts');
const source = readFileSync(ROUTE, 'utf8');

/** Kód bez blokových i řádkových komentářů. Komentáře smějí formáty jmenovat, kód ne. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('veřejný výdej obrázku nikdy nekonvertuje', () => {
  it('nesahá na hlavičku Accept, tedy nemá podle čeho vybírat formát', () => {
    expect(code).not.toMatch(/["'`]accept["'`]/i);
    expect(code).not.toMatch(/headers\.get\(\s*['"`]accept/i);
    // `Vary: Accept` je stopa po vyjednávání obsahu i tehdy, když se zapomene
    // na samotné čtení hlavičky.
    expect(code).not.toMatch(/vary/i);
  });

  it('neobsahuje jediný moderní formát ani volání překódovací knihovny', () => {
    for (const banned of ['webp', 'avif', 'heic', 'jxl']) {
      expect(code.toLowerCase()).not.toContain(banned);
    }
    // `sharp` je jediné místo v produktu, které umí obrázek překódovat, a to
    // místo je `packages/core/src/assets/image.ts`, ne trasa výdeje.
    expect(code).not.toContain('sharp');
    expect(code).not.toMatch(/\btoFormat\b|\.resize\(/);
  });

  it('typ v hlavičce bere z uloženého záznamu, ne z adresy ani z požadavku', () => {
    // Kdyby se `Content-Type` skládal z přípony v adrese, dala by se odpověď
    // řídit z internetu. Přípona se proti uloženému typu jen OVĚŘUJE
    // (`resolvePublicAsset`), hlavička pochází z databáze.
    expect(code).toContain("'Content-Type': found.mimeType");
    expect(code).toContain("'X-Content-Type-Options': 'nosniff'");
  });

  it('vydává soubor tak, jak leží na disku, tedy proudem bez zásahu do bajtů', () => {
    expect(code).toContain('createReadStream');
    expect(code).toContain("'Content-Length': String(found.byteSize)");
  });
});

describe('adresa obrázku zná jen formáty bezpečné pro e-mail', () => {
  it('do přípony se nepřeloží nic mimo JPEG, PNG a GIF', () => {
    expect(Object.keys(EXTENSION_BY_MIME).sort()).toEqual([...STORED_MIME_TYPES].sort());
    expect(Object.values(EXTENSION_BY_MIME).sort()).toEqual(['gif', 'jpg', 'png']);
  });

  it('zakázaný formát se z adresy nedá vyžádat ani příponou', () => {
    for (const banned of NEVER_STORED_MIME_TYPES) {
      expect(Object.values(MIME_BY_EXTENSION)).not.toContain(banned);
    }
    for (const extension of ['webp', 'avif', 'heic', 'heif', 'tiff', 'tif', 'bmp', 'svg', 'jxl']) {
      expect(parseVariantFile(`orig.${extension}`)).toBeNull();
    }
  });

  it('povolené přípony se rozeberou a míří na uložený typ', () => {
    expect(parseVariantFile('orig.jpg')).toEqual({ variant: 'orig', extension: 'jpg' });
    expect(parseVariantFile('thumb.png')).toEqual({ variant: 'thumb', extension: 'png' });
    expect(parseVariantFile('w600.gif')).toEqual({ variant: 'w600', extension: 'gif' });
  });
});
