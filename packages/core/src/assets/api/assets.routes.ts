import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { loadConfig, type MlainConfig } from '../../config';
import { ApiError } from '../../errors/api-error';
import { problemResponse } from '../../identity/api/schemas';
import { assertPermission } from '../../identity/permissions';
import type { WorkspaceContext } from '../../identity/types';
import { withWorkspace } from '../../tx';
import { AssetProcessingError } from '../image';
import { ORIGINAL_VARIANT, isStoredMimeType, type StoredMimeType } from '../registry';
import {
  assetUsage,
  listAssets,
  listVariants,
  updateAsset,
  type AssetRow,
  type AssetVariantRow,
  type AssetUsage,
} from '../repository';
import {
  AssetInUseBySentCampaign,
  AssetQuotaExceeded,
  AssetTooLarge,
  deleteAsset,
  loadAssetDetail,
  uploadAsset,
  type AssetServiceContext,
} from '../service';
import { publicAssetUrl } from '../urls';
import {
  AssetListResponse,
  AssetResponse,
  AssetSourceSchema,
  PatchAssetRequest,
  UploadAssetForm,
  Uuid,
} from './schemas';
import type { AssetsEnv } from './index';

const TAG = 'Assets';

const IdParam = z.object({ id: Uuid });

/**
 * Konfigurace se čte líně a memoizovaně, stejně jako v `templates.routes.ts`.
 * `loadConfig()` hází `ConfigError` při chybějící proměnné, takže volání při
 * importu modulu by shodilo i cesty, které konfiguraci nepotřebují.
 */
let cachedConfig: MlainConfig | null = null;
function config(): MlainConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

function urlFor(asset: AssetRow, variant: string): string {
  const mimeType: StoredMimeType = isStoredMimeType(asset.mimeType) ? asset.mimeType : 'image/png';
  return publicAssetUrl(asset.publicId, variant, mimeType, {
    baseUrl: config().ASSET_BASE_URL,
    signed: config().ASSET_REQUIRE_SIGNED_URL,
  });
}

function present(
  asset: AssetRow,
  variants: readonly AssetVariantRow[],
  usedBy: readonly AssetUsage[] = [],
): z.infer<typeof AssetResponse> {
  const own = variants.filter((variant) => variant.assetId === asset.id);
  return {
    id: asset.id,
    public_id: asset.publicId,
    mime_type: asset.mimeType,
    byte_size: asset.byteSize,
    width: asset.width,
    height: asset.height,
    animated: asset.frameCount > 1,
    alt_text: asset.altText,
    original_filename: asset.originalFilename,
    source: AssetSourceSchema.parse(asset.source),
    variants: own.map((variant) => ({
      variant: variant.variant,
      width: variant.width,
      height: variant.height,
      url: urlFor(asset, variant.variant),
    })),
    url: urlFor(asset, ORIGINAL_VARIANT),
    // Miniatura vzniká VŽDY (registr ji má `always: true`), ale u assetu
    // nahraného před přidáním varianty do registru chybět může. Padá se proto
    // na originál, ne na prázdný řetězec: rozbitý obrázek v knihovně vypadá
    // jako vada produktu, velký obrázek v malé dlaždici jen jako pomalejší
    // načtení.
    thumbnail_url: urlFor(
      asset,
      own.some((v) => v.variant === 'thumb') ? 'thumb' : ORIGINAL_VARIANT,
    ),
    reference_count: asset.referenceCount,
    hidden: asset.hiddenAt !== null,
    used_by: usedBy.map((usage) => ({ type: usage.type, id: usage.id, name: usage.name })),
    created_at: asset.createdAt.toISOString(),
  };
}

function serviceContext(ctx: WorkspaceContext): AssetServiceContext {
  return { ctx, ...(ctx.actor.type === 'user' ? { userId: ctx.actor.userId } : {}) };
}

/**
 * Doménové chyby na `ApiError`. Kódy i stavy jsou z tabulky 3.14.7 a jsou
 * v registru `errors/problem-codes.ts` už od P01, takže se tu nic neregistruje,
 * jen překládá.
 */
function translateUploadError(error: unknown): never {
  if (error instanceof AssetTooLarge) {
    // Obecný `payload_too_large`, ne vlastní kód. Tabulka 3.14.7 to má takhle
    // výslovně: „obrázek je větší než 10 MB" není chyba specifická pro assety.
    throw new ApiError('payload_too_large');
  }
  if (error instanceof AssetQuotaExceeded) {
    throw new ApiError('asset_quota_exceeded');
  }
  if (error instanceof AssetProcessingError) {
    throw new ApiError(error.code);
  }
  throw error;
}

/* ------------------------------------------------------------------------ *
 * Definice cest
 * ------------------------------------------------------------------------ */

const listRoute = createRoute({
  method: 'get',
  path: '/assets',
  tags: [TAG],
  summary: 'Knihovna obrázků projektu',
  security: [{ bearerAuth: ['assets:read'] }],
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      cursor: z.string().min(1).optional(),
      q: z.string().max(200).optional(),
      source: AssetSourceSchema.optional(),
      hidden: z.coerce.boolean().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Stránka obrázků',
      content: { 'application/json': { schema: AssetListResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    422: problemResponse('validation_failed'),
  },
});

const uploadRoute = createRoute({
  method: 'post',
  path: '/assets',
  tags: [TAG],
  summary: 'Nahrání obrázku',
  security: [{ bearerAuth: ['assets:write'] }],
  request: {
    body: {
      content: { 'multipart/form-data': { schema: UploadAssetForm } },
      description: 'Pole `file` s obrázkem, volitelně `alt_text`. Limit 10 MiB.',
    },
  },
  responses: {
    201: { description: 'Nahráno', content: { 'application/json': { schema: AssetResponse } } },
    // 200 znamená, že projekt tentýž obsah UŽ MĚL a vrací se stávající asset.
    // Rozlišení proti 201 není kosmetika: klient podle něj pozná, že mu
    // v knihovně nepřibyla položka, a nemá ji tam přidávat podruhé.
    200: {
      description: 'Tentýž obsah už v projektu je, vrací se stávající obrázek',
      content: { 'application/json': { schema: AssetResponse } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    413: problemResponse('payload_too_large', 'asset_quota_exceeded', 'asset_too_many_pixels'),
    415: problemResponse('asset_unsupported_format'),
    422: problemResponse('validation_failed', 'asset_corrupt'),
  },
});

const getRoute = createRoute({
  method: 'get',
  path: '/assets/{id}',
  tags: [TAG],
  summary: 'Detail obrázku včetně míst, kde se používá',
  security: [{ bearerAuth: ['assets:read'] }],
  request: { params: IdParam },
  responses: {
    200: { description: 'Obrázek', content: { 'application/json': { schema: AssetResponse } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const patchRoute = createRoute({
  method: 'patch',
  path: '/assets/{id}',
  tags: [TAG],
  summary: 'Změna alternativního textu nebo skrytí z knihovny',
  security: [{ bearerAuth: ['assets:write'] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: PatchAssetRequest } } },
  },
  responses: {
    200: { description: 'Uloženo', content: { 'application/json': { schema: AssetResponse } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/assets/{id}',
  tags: [TAG],
  summary: 'Skrytí obrázku z knihovny podle pravidel 3.14.5',
  security: [{ bearerAuth: ['assets:write'] }],
  request: { params: IdParam },
  responses: {
    204: { description: 'Skryto, soubor zůstává 30 dní' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('asset_referenced_by_sent_campaign'),
  },
});

/* ------------------------------------------------------------------------ *
 * Handlery
 * ------------------------------------------------------------------------ */

export function registerAssetRoutes(app: OpenAPIHono<AssetsEnv>): void {
  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'assets:read');
    const q = c.req.valid('query');
    const page = await withWorkspace(ctx, async (tx) => {
      const found = await listAssets(tx, ctx, {
        limit: q.limit,
        ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
        ...(q.q === undefined ? {} : { q: q.q }),
        ...(q.source === undefined ? {} : { source: q.source }),
        ...(q.hidden === undefined ? {} : { hidden: q.hidden }),
      });
      const variants = await listVariants(
        tx,
        ctx,
        found.items.map((item) => item.id),
      );
      return { ...found, variants };
    }).catch((error: unknown) => {
      // Rozbitý kurzor je chyba volajícího, ne serveru.
      if (error instanceof Error && error.message === 'invalid_cursor') {
        throw new ApiError('validation_failed', {
          errors: [{ path: 'cursor', code: 'invalid_value', message: 'Kurzor není platný.' }],
        });
      }
      throw error;
    });

    return c.json(
      {
        data: page.items.map((asset) => present(asset, page.variants)),
        pagination: {
          next_cursor: page.nextCursor,
          has_more: page.nextCursor !== null,
          limit: q.limit,
        },
      },
      200,
    );
  });

  app.openapi(uploadRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'assets:write');

    /*
     * Tělo se rozebírá RUČNĚ, ne přes `c.req.valid('form')`.
     *
     * `@hono/zod-openapi` umí multipart validovat, jenže `File` se zodem
     * popsat nedá jinak než jako `any`, takže by validace nic neověřila
     * a jen by přidala vrstvu, ve které se dá udělat chyba. Skutečnou
     * kontrolu dělá `normalizeUpload` magickým číslem, což je jediná
     * kontrola, která u nahrávaného souboru něco znamená.
     */
    const body = await c.req.parseBody();
    const file = body['file'];
    if (!(file instanceof File)) {
      throw new ApiError('validation_failed', {
        errors: [{ path: 'file', code: 'required_field_missing', message: 'Chybí pole `file`.' }],
      });
    }
    const altTextRaw = body['alt_text'];
    const altText = typeof altTextRaw === 'string' && altTextRaw !== '' ? altTextRaw : null;

    const content = Buffer.from(await file.arrayBuffer());
    try {
      const result = await uploadAsset(serviceContext(ctx), {
        content,
        filename: file.name,
        altText,
      });
      const payload = present(result.asset, result.variants);
      return result.deduplicated ? c.json(payload, 200) : c.json(payload, 201);
    } catch (error) {
      translateUploadError(error);
    }
  });

  app.openapi(getRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'assets:read');
    const detail = await loadAssetDetail(ctx, c.req.valid('param').id);
    if (detail === null) throw new ApiError('not_found');
    return c.json(present(detail.asset, detail.variants, detail.usedBy), 200);
  });

  app.openapi(patchRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'assets:write');
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');
    const updated = await withWorkspace(ctx, async (tx) => {
      const row = await updateAsset(tx, ctx, id, {
        ...(body.alt_text === undefined ? {} : { altText: body.alt_text }),
        ...(body.hidden === undefined ? {} : { hidden: body.hidden }),
      });
      if (row === null) return null;
      const [variants, usedBy] = await Promise.all([
        listVariants(tx, ctx, [row.id]),
        assetUsage(tx, ctx, row.id),
      ]);
      return { row, variants, usedBy };
    });
    if (updated === null) throw new ApiError('not_found');
    return c.json(present(updated.row, updated.variants, updated.usedBy), 200);
  });

  app.openapi(deleteRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'assets:write');
    try {
      const row = await deleteAsset(serviceContext(ctx), c.req.valid('param').id);
      if (row === null) throw new ApiError('not_found');
    } catch (error) {
      if (error instanceof AssetInUseBySentCampaign) {
        throw new ApiError('asset_referenced_by_sent_campaign');
      }
      throw error;
    }
    return c.body(null, 204);
  });
}
