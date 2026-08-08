// Typy se dovážejí POJMENOVANĚ, ne přes jmenný prostor. Balíček od verze 0.35
// neexportuje `export = sharp`, ale skutečné pojmenované exporty, takže zápis
// ve tvaru „sharp tečka Metadata" už nic neoznačuje a TypeScript na něm hlásí
// „Cannot find namespace 'sharp'". Výchozí export, tedy samotný konstruktor,
// zůstává beze změny.
import sharp, { type Metadata, type Sharp } from 'sharp';
import { sanitizeSvg } from '../brand/extract/logo';
import { detectFormat } from './detect';
import {
  MAX_INPUT_PIXELS,
  MAX_STORED_DIMENSION,
  SVG_RASTER_DENSITY,
  SVG_RASTER_WIDTH,
  variantsFor,
  type StoredMimeType,
  type VariantSpec,
} from './registry';

/**
 * Zpracování nahraného obrázku. Jediné místo v produktu, které volá `sharp`.
 *
 * DVĚ VĚCI, KTERÉ TENHLE MODUL DĚLÁ MLČKY A JSOU DŮLEŽITÉ:
 *
 *  1. `.rotate()` bez argumentu srovná obrázek podle EXIF orientace. Fotky
 *     z telefonu mají pixely uložené naležato a orientaci jen v metadatech;
 *     poštovní klienti EXIF orientaci NEČTOU, takže by fotka v e-mailu ležela
 *     na boku, přestože v editoru i v prohlížeči stojí správně.
 *  2. `sharp` metadata při zápisu ZAHAZUJE, pokud se nevyžádá `keepMetadata`,
 *     a tady se nevyžaduje. Je to ochrana osobních údajů, ne optimalizace:
 *     fotka z telefonu nese v EXIF GPS souřadnice a sériové číslo přístroje.
 *     Kdyby se metadata zachovala, veřejná adresa bez autentizace by je
 *     vydávala komukoli, kdo dostane e-mail.
 *
 * Chyby chodí jako `AssetProcessingError` s kódem z registru chyb (3.14.7),
 * takže je API vrstva jen přeloží na `ApiError` a nemusí nic uhodnout.
 */

export type AssetErrorCode = 'asset_unsupported_format' | 'asset_too_many_pixels' | 'asset_corrupt';

export class AssetProcessingError extends Error {
  constructor(
    readonly code: AssetErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AssetProcessingError';
  }
}

/**
 * Pojistka na VÝSTUPU: uložit se smí jen to, co přečte každý poštovní klient.
 *
 * Kontroluje se MAGICKÉ ČÍSLO HOTOVÝCH BAJTŮ, ne to, co jsme chtěli zakódovat.
 * Rozdíl není teoretický: `sharp` vybírá kodek podle volané metody, ale kdyby
 * se do `encode()` někdy dostala větev navíc, nebo kdyby budoucí verze libvips
 * u některého vstupu zvolila jiný kontejner, výsledek by se od `mimeType`
 * v databázi rozešel. Poznalo by se to teprve tím, že části příjemců chybí
 * v e-mailu obrázek, a nenahlásí to nikdo: odesílatel vidí svůj Gmail, kde
 * WebP i AVIF fungují.
 *
 * Kontrola tedy stojí mezi kodekem a diskem a je záměrně nedůvěřivá vůči
 * vlastnímu kódu. Cena je jedno porovnání pár bajtů na obrázek.
 *
 * GIF ve výčtu ZŮSTÁVÁ, přestože zadání mluví o JPEG a PNG. Není to změkčení:
 * zadání zakazuje formáty, které starší Outlook a Apple Mail nezobrazí, a GIF
 * je z celé trojice ten nejstarší a nejlépe podporovaný. Vyhodit ho by
 * neznamenalo bezpečnější e-mail, ale ztrátu animací, které jsou v newsletteru
 * běžná a funkční věc. Zakázané jsou WebP, AVIF a spol., ne stáří formátu.
 */
function assertStoredFormat(data: Buffer, declared: StoredMimeType): void {
  const actual = detectFormat(data);
  const matches =
    actual.kind === 'raster' &&
    ((actual.format === 'jpeg' && declared === 'image/jpeg') ||
      (actual.format === 'png' && declared === 'image/png') ||
      (actual.format === 'gif' && declared === 'image/gif'));
  if (matches) return;

  const what =
    actual.kind === 'raster' || actual.kind === 'rejected'
      ? actual.format
      : actual.kind === 'convert'
        ? actual.format
        : actual.kind;
  throw new AssetProcessingError(
    'asset_corrupt',
    `Zpracování vyrobilo ${what} místo ${declared}. Do e-mailu se smí jen JPEG, PNG nebo GIF.`,
  );
}

export type NormalizedImage = {
  data: Buffer;
  mimeType: StoredMimeType;
  width: number;
  height: number;
  /** Větší než 1 znamená animovaný GIF. Sloupec `assets.frame_count`. */
  frameCount: number;
};

export type RenderedVariant = {
  variant: string;
  data: Buffer;
  mimeType: StoredMimeType;
  width: number;
  height: number;
};

/**
 * `sharp` hlásí překročení limitu pixelů obyčejným `Error` s textem, ne kódem.
 * Rozlišit ho od poškozeného souboru je nutné, protože uživatel má dostat
 * `asset_too_many_pixels` (413, „zmenši obrázek"), ne `asset_corrupt` (422,
 * „soubor je rozbitý"). Text je anglický a pochází z knihovny, takže se
 * porovnává podřetězcem; kdyby ho `sharp` změnil, spadne to na `asset_corrupt`,
 * což je horší hláška, ale ne nepravdivá.
 */
function toAssetError(error: unknown): AssetProcessingError {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('pixel limit') || message.includes('exceeds pixel limit')) {
    return new AssetProcessingError('asset_too_many_pixels', message);
  }
  return new AssetProcessingError('asset_corrupt', message);
}

/** Konstruktor `sharp` se stropem na vstupní pixely (3.14.1) na jednom místě. */
function open(data: Buffer, options?: { animated?: boolean; density?: number }): Sharp {
  return sharp(data, {
    limitInputPixels: MAX_INPUT_PIXELS,
    failOn: 'error',
    ...(options?.animated === true ? { animated: true } : {}),
    ...(options?.density === undefined ? {} : { density: options.density }),
  });
}

/**
 * Vstup od uživatele na uložitelný originál.
 *
 * VRACÍ NOVÉ BAJTY I TEHDY, KDYŽ SE FORMÁT NEMĚNÍ, a je to záměr. Deduplikační
 * hash se počítá až z TĚCHTO bajtů, ne ze vstupu. Kdyby se počítal ze vstupu,
 * dva soubory, které se liší jen EXIF komentářem nebo pořadím chunků, by byly
 * dva různé assety s identickým obsahem, a naopak jeden vstup by po změně verze
 * `sharp` dal jinou uloženou podobu při stejném hashi.
 */
export async function normalizeUpload(input: Buffer): Promise<NormalizedImage> {
  const detected = detectFormat(input);

  if (detected.kind === 'rejected' || detected.kind === 'unknown') {
    const what = detected.kind === 'rejected' ? detected.format : 'neznámý formát';
    // Hláška jmenuje i WebP a AVIF, protože ty se PŘIJÍMAJÍ a převedou.
    // Dřív tu stálo „Použijte JPEG, PNG, GIF nebo SVG", což byla nepravda
    // v neprospěch uživatele: poslala ho převádět soubor, který server bere.
    throw new AssetProcessingError(
      'asset_unsupported_format',
      `Formát ${what} se nahrát nedá. Použijte JPEG, PNG, GIF, WebP, AVIF nebo SVG.`,
    );
  }

  if (detected.kind === 'svg') {
    return rasterizeSvg(input);
  }

  let pipeline: Sharp;
  let metadata: Metadata;
  try {
    // GIF se otevírá s `animated: true`, aby se s animací počítalo jako
    // s celkem, ne jako s prvním snímkem.
    //
    // Dřív tu stálo, že bez toho příznaku hlásí `sharp` u animace jediný
    // snímek. TO NENÍ PRAVDA, aspoň ne na sharpu 0.35.3 s libvipsem 8.18.3.
    // Naměřeno nad třísnímkovým GIFem 40 na 40:
    //
    //   s `animated`:  pages 3, height 120, pageHeight 40
    //   bez `animated`: pages 3, height  40, pageHeight undefined
    //
    // `pages` tedy sedí tak i tak a uložená výška vyjde 40 v obou případech,
    // protože se níž bere `pageHeight ?? height`. Příznak dnes nedrží ani
    // jedno z toho, co se od něj čekalo, a zůstává tu proto, že animaci
    // otevírá jako animaci: až se jednou bude překódovávat nebo zmenšovat,
    // je rozdíl mezi „pás všech snímků" a „první snímek" zásadní.
    //
    // Nespoléhej na něj jako na pojistku, dokud si nenaměříš, že jí je.
    const animatedInput = detected.kind === 'raster' && detected.format === 'gif';
    pipeline = open(input, { animated: animatedInput });
    metadata = await pipeline.metadata();
  } catch (error) {
    throw toAssetError(error);
  }

  const frameCount = metadata.pages ?? 1;
  const animated = detected.kind === 'raster' && detected.format === 'gif' && frameCount > 1;

  // Animovaný GIF se NEPŘEKÓDOVÁVÁ. `sharp` sice animaci přes `animated: true`
  // udrží, jenže překódování GIF ztrácí snímky a mění časování, a rozdíl je
  // vidět. Uloží se tedy vstup tak, jak přišel; kontrolou, že to je opravdu
  // GIF, prošel výš. Rozměr se nezmenšuje, protože zmenšení animace je právě
  // ta operace, která ji rozbíjí.
  if (animated) {
    assertStoredFormat(input, 'image/gif');
    return {
      data: input,
      mimeType: 'image/gif',
      width: metadata.width ?? 0,
      // U animace je `height` výška CELÉHO pásu snímků, ne jednoho. Bez dělení
      // by asset měl v databázi výšku n-násobnou a emitter by podle ní počítal
      // rozměr v HTML.
      height: Math.round((metadata.pageHeight ?? metadata.height ?? 0) || 0),
      frameCount,
    };
  }

  const target = pickOutputMime(detected, metadata);
  try {
    const resized = pipeline.rotate().resize({
      width: MAX_STORED_DIMENSION,
      height: MAX_STORED_DIMENSION,
      fit: 'inside',
      // Bez tohohle by se malý obrázek roztáhl na 2 000 px, přibral bajty
      // a nepřibral pixely.
      withoutEnlargement: true,
    });
    const { data, info } = await encode(resized, target, metadata).toBuffer({
      resolveWithObject: true,
    });
    assertStoredFormat(data, target);
    return { data, mimeType: target, width: info.width, height: info.height, frameCount: 1 };
  } catch (error) {
    throw toAssetError(error);
  }
}

/**
 * Jaký formát se uloží.
 *
 * WebP a AVIF se převádějí (3.14.1) a rozhoduje o tom ALFA KANÁL: s průhledností
 * na PNG, bez ní na JPEG. Obráceně by průhledné logo dostalo černé pozadí
 * a fotka převedená na PNG by proti JPEG několikanásobně narostla.
 */
function pickOutputMime(
  detected: { kind: 'raster'; format: 'jpeg' | 'png' | 'gif' } | { kind: 'convert' },
  metadata: Metadata,
): StoredMimeType {
  if (detected.kind === 'raster') {
    if (detected.format === 'jpeg') return 'image/jpeg';
    if (detected.format === 'png') return 'image/png';
    return 'image/gif';
  }
  return metadata.hasAlpha === true ? 'image/png' : 'image/jpeg';
}

function encode(pipeline: Sharp, mimeType: StoredMimeType, source?: Metadata): Sharp {
  if (mimeType === 'image/jpeg') {
    // Kvalita 82 a progresivní kódování jsou ze specifikace 3.14.1.
    // `mozjpeg` zapíná trellis kvantizaci: při stejné kvalitě menší soubor,
    // což u limitu 200 kB na obrázek v e-mailu není kosmetika.
    return pipeline.jpeg({ quality: 82, progressive: true, mozjpeg: true });
  }
  if (mimeType === 'image/png') {
    /*
     * `palette: true` se zapíná JEN u obrázku, který paletový už byl.
     *
     * Specifikace to podmiňuje tím, že se obsah „vejde do 256 barev". Spočítat
     * unikátní barvy znamená dekódovat celý obrázek do paměti a projít ho,
     * a hlavně: `sharp` s `palette: true` na fotku barvy NESPOČÍTÁ, on je
     * KVANTIZUJE. Fotka by tedy podmínku „vejde se do 256" splnila vždycky,
     * jen za cenu viditelných pruhů na přechodech. Logo exportované jako
     * paletové PNG paletové zůstane, fotka zůstane truecolor.
     */
    return pipeline.png({ compressionLevel: 9, palette: source?.isPalette === true });
  }
  return pipeline.gif();
}

/**
 * SVG: sanitizace a rasterizace na PNG (3.13.10, kroky 1 až 3).
 *
 * Původní SVG se NEUKLÁDÁ. Není to jen kvůli poštovním klientům, které SVG
 * neumí: uložený originál by znamenal, že na veřejné adrese bez autentizace
 * leží XML dokument, který prohlížeč otevře a vykreslí. Sanitizace se dělá
 * jednou při nahrání a od té chvíle je na disku rastr, se kterým se nedá nic
 * provést.
 */
async function rasterizeSvg(input: Buffer): Promise<NormalizedImage> {
  const sanitized = sanitizeSvg(input.toString('utf8'));
  if (!sanitized.ok) {
    // `sanitizeSvg` odmítá dokument s entitami v prologu (XXE) a dokument,
    // který žádné `<svg>` neobsahuje. Obojí je z pohledu uživatele „soubor
    // se nepodařilo přečíst jako obrázek", tedy 422, ne 415: přípona i podpis
    // říkaly SVG, obsah ne.
    throw new AssetProcessingError('asset_corrupt', `SVG neprošlo sanitizací: ${sanitized.reason}`);
  }
  try {
    const { data, info } = await open(Buffer.from(sanitized.svg, 'utf8'), {
      density: SVG_RASTER_DENSITY,
    })
      .resize({ width: SVG_RASTER_WIDTH, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
    assertStoredFormat(data, 'image/png');
    return {
      data,
      mimeType: 'image/png',
      width: info.width,
      height: info.height,
      frameCount: 1,
    };
  } catch (error) {
    throw toAssetError(error);
  }
}

/**
 * Odvozené velikosti z uloženého originálu.
 *
 * Běží PŘI NAHRÁNÍ, ne při prvním otevření e-mailu, a specifikace 3.14.2 na to
 * dává tvrdý důvod: obrázek si vyžádá schránka příjemce, ne náš server, takže
 * generovat variantu líně by u kampaně na 50 000 lidí znamenalo 50 000
 * souběžných požadavků na soubor, který ještě neexistuje.
 *
 * Funkce je ČISTÁ a idempotentní: nic neukládá a ze stejného vstupu vyrobí
 * stejný výstup. Díky tomu ji smí volat jak nahrávání, tak úloha
 * `content.process_asset`, která doplňuje varianty přidané do registru
 * později, aniž by se musely lišit.
 */
export async function renderVariants(original: NormalizedImage): Promise<RenderedVariant[]> {
  const specs = variantsFor({
    width: original.width,
    height: original.height,
    animated: original.frameCount > 1,
  });
  const out: RenderedVariant[] = [];
  for (const spec of specs) {
    out.push(await renderVariant(original, spec));
  }
  return out;
}

async function renderVariant(
  original: NormalizedImage,
  spec: VariantSpec,
): Promise<RenderedVariant> {
  /*
   * Miniatura animovaného GIF se dělá z PRVNÍHO SNÍMKU, tedy bez
   * `animated: true`. Je to přesně to chování, které je jinde v modulu vada;
   * tady je to záměr a specifikace 3.14.2 ho vyžaduje.
   *
   * VARIANTA SI VŽDY DRŽÍ TYP ORIGINÁLU, i když by se pro miniaturu z GIF
   * hodilo PNG. Není to lenost: veřejnou adresu skládá `assetUrl`
   * v `packages/emails/src/emitter/assets.ts` z `asset.mimeType`, tedy z typu
   * ASSETU, ne varianty. Miniatura uložená jako PNG by tím dostala adresu
   * končící `.gif` a trasa výdeje by ji odmítla vydat, protože přípona
   * v adrese neodpovídá uloženému typu. Zjistilo by se to až tím, že knihovna
   * v editoru má u animovaných GIFů rozbité náhledy.
   */
  const mimeType: StoredMimeType = original.mimeType;
  try {
    const pipeline = open(original.data).resize(
      spec.fit === 'cover'
        ? { width: spec.width, height: spec.width, fit: 'cover', position: 'centre' }
        : { width: spec.width, fit: 'inside', withoutEnlargement: true },
    );
    const { data, info } = await encode(pipeline, mimeType).toBuffer({ resolveWithObject: true });
    assertStoredFormat(data, mimeType);
    return { variant: spec.name, data, mimeType, width: info.width, height: info.height };
  } catch (error) {
    throw toAssetError(error);
  }
}
