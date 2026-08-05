import { OpenAPIHono, type Hook } from '@hono/zod-openapi';
import { writeAuditLog } from '../../audit/write';
import { loadConfig } from '../../config/index';
import { ApiError, type ErrorCode } from '../../errors/api-error';
import type { ApiEnv } from '../../identity/api/schemas';
import { assertPermission } from '../../identity/permissions';
import { actorInfo, type WorkspaceContext } from '../../identity/types';
import { withWorkspace } from '../../tx';
import { BrandAuditActions } from '../audit';
import { requestExtraction } from '../brand-service';
import { enqueueBrandJob } from '../jobs/enqueue';
import {
  countExtractionsInLastHour,
  countRunningExtractions,
  findExtraction,
  insertExtraction,
  toPublicExtraction,
} from '../repo/extractions.repo';
import { createExtractionRoute, getExtractionRoute } from './extractions.routes';

/**
 * Prostředí route souborů domény značky. Týž důvod jako u AI a assetů:
 * autentizační middleware P04 plní proměnnou `auth` tvaru `{ ctx, label }`,
 * takže vlastní typ prostředí by znamenal `undefined` za běhu.
 */
export type BrandEnv = ApiEnv;

export const validationHook: Hook<unknown, BrandEnv, string, unknown> = (result) => {
  if (result.success) return;
  throw new ApiError('validation_failed', {
    errors: result.error.issues.map((issue) => ({
      path: (issue.path ?? []).map((part) => String(part)).join('.'),
      code: issue.code ?? 'invalid_value',
      message: issue.message,
    })),
  });
};

export const brandApi = new OpenAPIHono<BrandEnv>({ defaultHook: validationHook });

/**
 * Identifikátor aktéra pro `requested_by`. Klíč k API nemá uživatele, sloupec
 * cizí klíč na `users` má, takže se u něj zapisuje `null`, ne vymyšlené UUID.
 */
function userIdOf(ctx: WorkspaceContext): string | null {
  return ctx.actor.type === 'user' ? ctx.actor.userId : null;
}

/**
 * Kód domény značky pro `ApiError`. Status si `ApiError` bere z katalogu
 * `errors/problem-codes.ts`, ne z výsledku služby: katalog je zdroj pravdy
 * o tom, jestli je `brand_dns_failed` 400 nebo 422, a dvě čísla pro tentýž
 * kód by se rozešla. Týž vzor jako `translateUploadError` u assetů.
 */
function failureCode(result: { code: string }): ErrorCode {
  // Služba vrací obecné `conflict`; katalog má pro tenhle případ vlastní kód
  // a obrazovka zná jen kódy začínající `brand_`.
  const code = result.code === 'conflict' ? 'brand_extract_running' : result.code;
  /*
   * Přetypování je vědomé a bezpečné: `ApiError` neregistrovaný kód sám
   * odmítne výjimkou, takže se překlep pozná na prvním průchodu, ne tichým
   * vydáním nesmyslné odpovědi. Kódy vydává `normalizeBrandUrl` jako obyčejné
   * řetězce a užší typ by musel vzniknout v doméně URL, kde katalog chyb není.
   */
  return code as ErrorCode;
}

export function registerBrandRoutes(app: OpenAPIHono<BrandEnv>): void {
  app.openapi(createExtractionRoute, async (c) => {
    const { ctx, label } = c.get('auth');
    /*
     * `templates:write`, ne `templates:read`. Extrakce není čtení: zakládá
     * profil značky a nahraje do knihovny médií logo staženo z cizího webu.
     * Doména `brand` vlastní oprávnění nemá (`identity/permissions.ts`)
     * a šablony jsou to, čeho se značka týká.
     */
    assertPermission(ctx, 'templates:write');

    const body = c.req.valid('json');
    const config = loadConfig();

    /*
     * VŠECHNO V JEDNÉ TRANSAKCI: řádek běhu, zařazení úlohy do fronty
     * i záznam v audit logu. `enqueueBrandJob` zapisuje do tabulky pg-bossu
     * přímo, takže se veze s ní; kdyby se transakce rollbackla, nezůstane ani
     * úloha bez řádku, ani řádek bez úlohy.
     */
    const result = await withWorkspace(ctx, (tx) =>
      requestExtraction(
        {
          workspaceId: ctx.workspaceId,
          actorId: userIdOf(ctx) ?? '',
          url: body.url,
          inferTone: body.infer_tone ?? config.BRAND_EXTRACTION_INFER_TONE,
        },
        {
          ratePerHour: config.BRAND_FETCH_RATE_PER_HOUR,
          concurrencyPerWorkspace: config.BRAND_FETCH_CONCURRENCY,
        },
        {
          // Projekt vybírá RLS, proto se `workspaceId` do repozitáře nepředává.
          countExtractionsInLastHour: () => countExtractionsInLastHour(tx),
          countRunningExtractions: () => countRunningExtractions(tx),
          insertExtraction: (row) =>
            insertExtraction(tx, {
              workspaceId: row.workspaceId,
              requestedBy: userIdOf(ctx),
              inputUrl: row.inputUrl,
              normalizedUrl: row.normalizedUrl,
              status: row.status,
            }),
          enqueue: (queue, payload) =>
            enqueueBrandJob(tx, queue, payload, {
              // Fronta má `singletonKeyTemplate: '<extraction_id>'`, takže
              // opakované doručení téhož běhu se v pg-bossu srazí na jeden.
              singletonKey: String(payload['extractionId'] ?? ''),
            }),
          writeAuditLog: (entry) =>
            writeAuditLog(tx, {
              action: BrandAuditActions['brand_extraction.requested'],
              workspaceId: ctx.workspaceId,
              actor: actorInfo(ctx.actor, label),
              targetType: 'brand_extraction',
              targetId: String(entry['targetId'] ?? ''),
              metadata: (entry['metadata'] ?? {}) as Record<string, unknown>,
            }),
        },
      ),
    );

    if (result.ok) return c.json({ id: result.id }, 202);
    /*
     * Rozlišuje se podle `status`, ne podle `code`. Ve výsledné unii má poslední
     * větev `code: string`, takže `code === 'rate_limited'` typ nezúží: řetězec
     * tu hodnotu obsahuje taky a překlad by na `retryAfterSeconds` spadl.
     */
    if (result.status === 429) {
      throw new ApiError('rate_limited', {
        retryAfter: result.retryAfterSeconds,
        params: { limit: result.limit },
      });
    }
    throw new ApiError(failureCode(result));
  });

  app.openapi(getExtractionRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'templates:read');
    const { extraction_id: extractionId } = c.req.valid('param');

    const row = await withWorkspace(ctx, (tx) => findExtraction(tx, extractionId));
    // Běh z cizího projektu RLS vůbec nevrátí, takže je to `not_found`
    // i tehdy, když existuje. To je záměr: existence běhu je informace.
    if (row === null) throw new ApiError('not_found');
    return c.json(toPublicExtraction(row), 200);
  });
}

/*
 * Naplnění routeru běží PŘI NAČTENÍ MODULU, ne až v `registerBrandApiRoutes`.
 * Druhé volání `buildApp()` (generátor OpenAPI, testy) by jinak přidalo každou
 * cestu podruhé a dokument by měl všechno dvakrát. Týž vzor jako u assetů.
 */
registerBrandRoutes(brandApi);

/** Mount do hlavní aplikace. Prefix `/api/v1` se přidává tady, jako u ostatních domén. */
export function registerBrandApiRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.route('/api/v1', brandApi);
}
