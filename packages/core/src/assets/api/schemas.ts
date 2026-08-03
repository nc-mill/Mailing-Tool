import { z } from '@hono/zod-openapi';

/**
 * Schémata veřejného API domény assetů. Tvar odpovědi je z kapitoly 4.3
 * specifikace, klíče jsou `snake_case` podle konvence 4.1.
 */

export const Uuid = z.uuid();

export const AssetSourceSchema = z.enum(['upload', 'brand_extraction', 'seed', 'ai']);

export const AssetVariantSchema = z
  .object({
    variant: z.string(),
    width: z.number().int(),
    height: z.number().int(),
    url: z.url(),
  })
  .openapi('AssetVariant');

export const AssetUsageSchema = z
  .object({
    /** `template`, `template_version`, `brand_profile` nebo `campaign`. */
    type: z.string(),
    id: Uuid,
    name: z.string(),
  })
  .openapi('AssetUsage');

export const AssetResponse = z
  .object({
    id: Uuid,
    public_id: z.string(),
    mime_type: z.string(),
    byte_size: z.number().int(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    animated: z.boolean(),
    alt_text: z.string().nullable(),
    /**
     * Ve výčtu polí v kapitole 4.3 chybí, přesto tu je. Knihovna v editoru
     * potřebuje obrázek pojmenovat a jediné jméno, které existuje, je to,
     * pod kterým ho uživatel nahrál. Bez něj by v mřížce byly jen náhledy
     * a hledání podle `q` by hledalo v poli, které klient nikdy neuvidí.
     */
    original_filename: z.string(),
    source: AssetSourceSchema,
    variants: z.array(AssetVariantSchema),
    /** Adresa varianty `orig`. */
    url: z.url(),
    thumbnail_url: z.url(),
    reference_count: z.number().int(),
    hidden: z.boolean(),
    used_by: z.array(AssetUsageSchema),
    created_at: z.iso.datetime(),
  })
  .openapi('Asset');

export const AssetListResponse = z
  .object({
    data: z.array(AssetResponse),
    pagination: z.object({
      next_cursor: z.string().nullable(),
      has_more: z.boolean(),
      limit: z.number().int(),
    }),
  })
  .openapi('AssetList');

export const PatchAssetRequest = z
  .object({
    alt_text: z.string().max(1000).nullable().optional(),
    hidden: z.boolean().optional(),
  })
  .openapi('PatchAssetRequest');

/**
 * Tělo nahrání je `multipart/form-data`, ne JSON. Schéma slouží OpenAPI
 * dokumentu; skutečné rozebrání dělá handler přes `c.req.parseBody()` a typ
 * souboru ověřuje magickým číslem, ne deklarací.
 *
 * `file` je proto `z.any()` s ručně dopsaným tvarem pro dokument, NE
 * `z.string()`. Ověřeno spuštěním proti běžícímu serveru: se `z.string()`
 * vrátilo nahrání skutečného obrázku
 *
 *   422 validation_failed, path "file": Invalid input: expected string, received File
 *
 * protože `@hono/zod-openapi` multipart validuje a hodnota pole je `File`.
 * Soubor se zodem popsat nedá; kdyby to šlo, stejně by to nic neověřilo,
 * protože o typu rozhoduje obsah, ne deklarace.
 */
export const UploadAssetForm = z
  .object({
    file: z.any().openapi({ type: 'string', format: 'binary' }),
    alt_text: z.string().max(1000).optional(),
  })
  .openapi('UploadAssetForm');
