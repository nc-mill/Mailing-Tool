import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadConfig, type MlainConfig } from '../config/index';
import type { WorkspaceContext } from '../identity/types';
import { withWorkspace, type Tx } from '../tx';
import { writeAssetAudit } from './audit';
import { AssetProcessingError, normalizeUpload, renderVariants } from './image';
import { generatePublicId } from './public-id';
import { ORIGINAL_VARIANT, type StoredMimeType } from './registry';
import {
  assetUsage,
  findAssetById,
  findAssetBySha256,
  hideAsset,
  insertAsset,
  listVariants,
  markPurged,
  referencedBySentCampaign,
  storageKeyStillUsed,
  upsertVariants,
  workspaceUsageBytes,
  type AssetRow,
  type AssetSource,
  type AssetVariantRow,
  type VariantInput,
} from './repository';
import { assetStorageKey, createFileAssetStorage, type AssetStorage } from './storage';

/**
 * Služba domény assetů. Sem patří všechno, co je víc než jeden dotaz nebo víc
 * než jeden zápis na disk, a nic z toho nezná HTTP.
 */

export type AssetServiceContext = {
  ctx: WorkspaceContext;
  config?: MlainConfig;
  storage?: AssetStorage;
  userId?: string;
};

export type UploadInput = {
  content: Buffer;
  /** Jméno z multipartu. Do CESTY NA DISKU se nikdy nedostane, jen do sloupce. */
  filename: string;
  altText?: string | null;
  source?: AssetSource;
};

export type UploadResult = {
  asset: AssetRow;
  variants: AssetVariantRow[];
  /** `true`, když se soubor už v projektu byl a nic se znovu nezapisovalo. */
  deduplicated: boolean;
};

/** Chyby, které umí vrátit služba a API vrstva je překládá na `ApiError`. */
export class AssetQuotaExceeded extends Error {
  constructor(
    readonly usedBytes: number,
    readonly quotaBytes: number,
  ) {
    super(`Kvóta assetů vyčerpaná: ${usedBytes} z ${quotaBytes} bajtů.`);
    this.name = 'AssetQuotaExceeded';
  }
}

export class AssetTooLarge extends Error {
  constructor(
    readonly byteSize: number,
    readonly limitBytes: number,
  ) {
    super(`Soubor má ${byteSize} bajtů, limit je ${limitBytes}.`);
    this.name = 'AssetTooLarge';
  }
}

export class AssetInUseBySentCampaign extends Error {
  constructor() {
    super('Asset používá kampaň, která už odešla.');
    this.name = 'AssetInUseBySentCampaign';
  }
}

function resolve(service: AssetServiceContext): {
  config: MlainConfig;
  storage: AssetStorage;
} {
  const config = service.config ?? loadConfig();
  return { config, storage: service.storage ?? createFileAssetStorage(config.UPLOADS_DIR) };
}

/**
 * Nahrání obrázku.
 *
 * POŘADÍ KROKŮ NENÍ LIBOVOLNÉ a každý má důvod, proč je právě tam:
 *
 *  1. Velikost. Kontroluje se PRVNÍ, ještě před dekódováním. Desetimegový
 *     limit má smysl jen tehdy, když se přes něj větší soubor nedostane ani
 *     do dekodéru; jinak by `sharp` na 200 MB pracoval a limit by chránil
 *     jen databázi, ne paměť procesu.
 *  2. Normalizace (`normalizeUpload`). Ověří typ MAGICKÝM ČÍSLEM, ne příponou,
 *     srovná EXIF orientaci, zahodí metadata včetně GPS, převede WebP a AVIF
 *     a zmenší na 2 000 px.
 *  3. Hash. Počítá se AŽ Z NORMALIZOVANÝCH BAJTŮ. Kdyby se počítal ze vstupu,
 *     dva soubory lišící se jen EXIF komentářem by byly dva assety s naprosto
 *     identickým obsahem, a deduplikace by tím ztratila smysl.
 *  4. Deduplikace. Když projekt tentýž obsah už má, vrátí se STÁVAJÍCÍ řádek
 *     a na disk se NEZAPISUJE. Volající to pozná podle `deduplicated`.
 *  5. Kvóta. Až po deduplikaci: opakované nahrání téhož obrázku místo nezabírá,
 *     takže ho kvóta nesmí odmítnout.
 *  6. Zápis na disk PŘED zápisem do databáze. Opačné pořadí by při pádu mezi
 *     kroky nechalo řádek, který v knihovně je a jehož soubor neexistuje, tedy
 *     rozbitou dlaždici, kterou nikdo neuklidí. Opačná trhlina (soubor bez
 *     řádku) je neškodná: nikdo na něj neodkazuje a `mlain doctor` ji najde.
 */
export async function uploadAsset(
  service: AssetServiceContext,
  input: UploadInput,
): Promise<UploadResult> {
  const { ctx } = service;
  const { config, storage } = resolve(service);

  const limitBytes = config.ASSET_MAX_UPLOAD_MB * 1024 * 1024;
  if (input.content.length === 0) {
    throw new AssetProcessingError('asset_corrupt', 'Nahraný soubor je prázdný.');
  }
  if (input.content.length > limitBytes) {
    throw new AssetTooLarge(input.content.length, limitBytes);
  }

  const normalized = await normalizeUpload(input.content);
  const sha256 = createHash('sha256').update(normalized.data).digest();

  const existing = await withWorkspace(ctx, (tx) => findAssetBySha256(tx, ctx, sha256));
  if (existing !== null) {
    const variants = await withWorkspace(ctx, (tx) => listVariants(tx, ctx, [existing.id]));
    return { asset: existing, variants, deduplicated: true };
  }

  const rendered = await renderVariants(normalized);
  const addedBytes =
    normalized.data.length + rendered.reduce((sum, variant) => sum + variant.data.length, 0);

  const quotaBytes = config.ASSET_QUOTA_MB * 1024 * 1024;
  const usedBytes = await withWorkspace(ctx, (tx) => workspaceUsageBytes(tx, ctx));
  if (usedBytes + addedBytes > quotaBytes) {
    throw new AssetQuotaExceeded(usedBytes, quotaBytes);
  }

  const publicId = generatePublicId();
  const sha256Hex = sha256.toString('hex');
  const originalKey = assetStorageKey({
    workspaceId: ctx.workspaceId,
    sha256Hex,
    variant: ORIGINAL_VARIANT,
    mimeType: normalized.mimeType,
  });

  await storage.put(originalKey, normalized.data);
  const variantKeys = rendered.map((variant) => ({
    ...variant,
    storageKey: assetStorageKey({
      workspaceId: ctx.workspaceId,
      sha256Hex,
      variant: variant.variant,
      mimeType: variant.mimeType,
    }),
  }));
  for (const variant of variantKeys) {
    await storage.put(variant.storageKey, variant.data);
  }

  return withWorkspace(ctx, async (tx) => {
    const asset = await insertAsset(tx, ctx, {
      publicId,
      sha256,
      byteSize: normalized.data.length,
      mimeType: normalized.mimeType,
      width: normalized.width,
      height: normalized.height,
      frameCount: normalized.frameCount,
      // Jméno z požadavku se ukládá do SLOUPCE, nikdy do cesty. Cestu skládá
      // `assetStorageKey` výhradně z workspace_id a hexu hashe, takže
      // `../../etc/passwd` v `filename` na disk nedosáhne ani teoreticky.
      originalFilename: sanitizeFilename(input.filename),
      altText: input.altText ?? null,
      source: input.source ?? 'upload',
      storageKey: originalKey,
      ...(service.userId === undefined ? {} : { createdBy: service.userId }),
    });
    await upsertVariants(
      tx,
      ctx,
      asset.id,
      variantKeys.map((variant) => ({
        variant: variant.variant,
        width: variant.width,
        height: variant.height,
        byteSize: variant.data.length,
        mimeType: variant.mimeType,
        storageKey: variant.storageKey,
      })),
    );
    await writeAssetAudit(tx, ctx, {
      action: 'asset.uploaded',
      targetId: asset.id,
      metadata: { mime_type: asset.mimeType, byte_size: asset.byteSize },
    });
    const variants = await listVariants(tx, ctx, [asset.id]);
    return { asset, variants, deduplicated: false };
  });
}

/**
 * Jméno souboru do sloupce `original_filename`.
 *
 * Ořezává se na 200 znaků a zahazují se řídicí znaky a oba oddělovače cest.
 * Sloupec sice do cesty nevstupuje, ale vstupuje do hlavičky
 * `Content-Disposition` a do výpisu v UI; `../` v něm nemá co dělat ani jako
 * zobrazený text, protože svádí k tomu ho někdy někde použít.
 */
function sanitizeFilename(name: string): string {
  const cleaned = [...name]
    // Řídicí znaky se zahazují podle KÓDU, ne rozsahem v regulárním výrazu.
    // Doslovný rozsah je v literálu neviditelný, takže ho nejde zkontrolovat
    // okem ani při revizi; pravidlo `no-control-regex` ho proto zakazuje.
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .replace(/[/\\]/g, '-')
    .trim()
    .slice(0, 200);
  return cleaned === '' ? 'image' : cleaned;
}

/**
 * Přegenerování variant jednoho assetu. Obsluha fronty `content.process_asset`.
 *
 * IDEMPOTENTNÍ: čte originál z disku, spočítá varianty podle AKTUÁLNÍHO
 * registru a zapíše je přes `ON CONFLICT DO UPDATE`. Opakované spuštění tedy
 * nic nerozbije, což fronta s `retryLimit: 3` potřebuje.
 *
 * Nahrávání volá `renderVariants` přímo a NEČEKÁ na frontu. Specifikace 3.14.2
 * to vyžaduje: obrázek si vyžádá schránka příjemce a generovat variantu při
 * prvním otevření kampaně na 50 000 lidí znamená 50 000 souběžných požadavků
 * na soubor, který ještě neexistuje. Tahle funkce je pro DRUHÝ případ, totiž
 * pro variantu přidanou do registru později.
 */
export async function processAsset(
  service: AssetServiceContext,
  assetId: string,
): Promise<{ variants: number }> {
  const { ctx } = service;
  const { storage } = resolve(service);

  const asset = await withWorkspace(ctx, (tx) => findAssetById(tx, ctx, assetId));
  if (asset === null) return { variants: 0 };

  const original = await readOriginal(storage, asset);
  const rendered = await renderVariants(original);

  const sha256Hex = asset.sha256.toString('hex');
  const values: VariantInput[] = [];
  for (const variant of rendered) {
    const key = assetStorageKey({
      workspaceId: ctx.workspaceId,
      sha256Hex,
      variant: variant.variant,
      mimeType: variant.mimeType,
    });
    await storage.put(key, variant.data);
    values.push({
      variant: variant.variant,
      width: variant.width,
      height: variant.height,
      byteSize: variant.data.length,
      mimeType: variant.mimeType,
      storageKey: key,
    });
  }
  await withWorkspace(ctx, (tx) => upsertVariants(tx, ctx, asset.id, values));
  return { variants: values.length };
}

async function readOriginal(
  storage: AssetStorage,
  asset: AssetRow,
): Promise<{
  data: Buffer;
  mimeType: StoredMimeType;
  width: number;
  height: number;
  frameCount: number;
}> {
  const data = await readFile(storage.resolve(asset.storageKey));
  return {
    data,
    mimeType: asset.mimeType as StoredMimeType,
    width: asset.width ?? 0,
    height: asset.height ?? 0,
    frameCount: asset.frameCount,
  };
}

/**
 * „Smazání" z pohledu uživatele (specifikace 3.14.5).
 *
 * NIKDY NEMAŽE SOUBOR. Nastaví `hidden_at` a tím obrázek zmizí z knihovny;
 * soubor leží dál a veřejná adresa funguje, takže lidem, kteří mají e-mail ve
 * schránce, obrázek nezmizí. Fyzicky ho po lhůtě smaže noční úklid, a jen
 * tehdy, když na něj mezitím nikdo neodkázal.
 *
 * JEDINÝ PŘÍPAD, KDY SE OPERACE ODMÍTNE, je odkaz z kampaně, která odesílá,
 * odešla nebo je pozastavená. Skrytí by tam sice taky nic nesmazalo, jenže by
 * uživatel odešel s pocitem, že obrázek zmizel, a za 30 dní by ho úklid
 * skutečně smazal, kdyby mezitím klesl počet referencí. Odmítnutí je tedy
 * pravdivější než tiché skrytí.
 */
export async function deleteAsset(
  service: AssetServiceContext,
  assetId: string,
): Promise<AssetRow | null> {
  const { ctx } = service;
  return withWorkspace(ctx, async (tx) => {
    const asset = await findAssetById(tx, ctx, assetId);
    if (asset === null) return null;
    if (await referencedBySentCampaign(tx, ctx, assetId)) throw new AssetInUseBySentCampaign();

    const hidden = await hideAsset(tx, ctx, assetId);
    if (hidden !== null) {
      await writeAssetAudit(tx, ctx, {
        action: 'asset.hidden',
        targetId: assetId,
        metadata: { reference_count: asset.referenceCount },
      });
    }
    return hidden ?? asset;
  });
}

/**
 * Fyzické smazání jednoho uklizeného assetu. Volá to `content.cleanup_assets`.
 *
 * KONTROLA `storageKeyStillUsed` PŘED KAŽDÝM `remove` JE POVINNÁ a je to přímý
 * důsledek deduplikace. Klíč v úložišti je obsahově adresovaný, takže na tutéž
 * cestu smí mířit víc řádků: unikátní index `uq_assets__workspace_sha256` platí
 * jen `WHERE purged_at IS NULL`, takže po uklizení řádku smí vzniknout nový se
 * stejným obsahem, a ten dostane stejnou cestu. Bez téhle kontroly by úklid
 * smazal soubor živému assetu a poznalo by se to tím, že v odeslaných
 * kampaních zmizely obrázky.
 */
export async function purgeAsset(service: AssetServiceContext, asset: AssetRow): Promise<void> {
  const { ctx } = service;
  const { storage } = resolve(service);

  const variants = await withWorkspace(ctx, (tx) => listVariants(tx, ctx, [asset.id]));
  const stillUsed = await withWorkspace(ctx, (tx) =>
    storageKeyStillUsed(tx, ctx, asset.storageKey, asset.id),
  );

  if (!stillUsed) {
    for (const variant of variants) await storage.remove(variant.storageKey);
    await storage.remove(asset.storageKey);
  }

  await withWorkspace(ctx, async (tx) => {
    // `purged_at` se zapisuje AŽ PO smazání souborů. Opačné pořadí by při pádu
    // mezi kroky nechalo řádek označený jako uklizený a soubory na disku, které
    // už nikdo nikdy nenajde: druhý běh úklidu ten řádek přeskočí, protože
    // vybírá jen `purged_at IS NULL`.
    await markPurged(tx, ctx, asset.id);
    await writeAssetAudit(tx, ctx, {
      action: 'asset.purged',
      targetId: asset.id,
      metadata: { storage_key_reused: stillUsed },
    });
  });
}

/** Detail assetu i s variantami a místy použití. Vstup pro `GET /assets/{id}`. */
export async function loadAssetDetail(
  ctx: WorkspaceContext,
  assetId: string,
): Promise<{
  asset: AssetRow;
  variants: AssetVariantRow[];
  usedBy: Awaited<ReturnType<typeof assetUsage>>;
} | null> {
  return withWorkspace(ctx, async (tx: Tx) => {
    const asset = await findAssetById(tx, ctx, assetId);
    if (asset === null) return null;
    const [variants, usedBy] = await Promise.all([
      listVariants(tx, ctx, [asset.id]),
      assetUsage(tx, ctx, asset.id),
    ]);
    return { asset, variants, usedBy };
  });
}
