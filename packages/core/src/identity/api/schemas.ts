import { z } from '@hono/zod-openapi';
import { ERROR_CODES } from '../../errors/registry';
import type { Tx } from '../../tx';
import { PERMISSIONS } from '../permissions';
import type { WorkspaceContext } from '../types';

/**
 * Sdílená schémata pro definice cest vlastněné částí 1. Bydlí tady, protože
 * `packages/core` nesmí importovat z `apps/web` (graf závislostí v 3.11)
 * a definice cest podle 4.7 žijí v core vedle domény, kterou obsluhují.
 */

export type AuthContext = {
  ctx: WorkspaceContext;
  /** Text do audit logu: e-mail uživatele nebo název klíče v okamžiku akce. */
  label: string;
};

/**
 * ODCHYLKA OD PLÁNU: runner bere volitelný `successStatus`. Plán ho odvozoval
 * z metody (`POST` znamená 201), jenže rotace klíče je POST, který nový zdroj
 * nevytváří, a jeho vlastní definice cesty v plánu deklaruje 200. Bez tohohle
 * parametru by endpoint vracel 201 proti své vlastní dokumentaci.
 */
export type IdempotentRunner = <T>(
  operation: (tx: Tx) => Promise<T>,
  options?: { successStatus?: number },
) => Promise<{ status: number; body: unknown; replay: boolean }>;

/** Proměnné kontextu requestu. Aplikace v apps/web je jen naplňuje. */
export type ApiVariables = {
  requestId: string;
  clientIp: string;
  startedAt: number;
  workspaceId?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  auth: AuthContext;
  runIdempotent: IdempotentRunner;
};

export type ApiEnv = { Variables: ApiVariables };

export const PermissionSchema = z.enum(PERMISSIONS).openapi('Permission');

export const FindingSchema = z
  .object({
    code: z.string(),
    severity: z.enum(['error', 'warning']),
    message: z.string(),
    path: z.string().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('Finding');

/** Úplný tvar z 4.8, včetně findings a params. Vynechat je znamená, že je klient zahodí. */
export const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string(),
    instance: z.string(),
    code: z.string(),
    request_id: z.string(),
    errors: z
      .array(z.object({ path: z.string(), code: z.string(), message: z.string() }))
      .optional(),
    findings: z.array(FindingSchema).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    retry_after: z.number().int().optional(),
  })
  .openapi('Problem');

/**
 * Chybová odpověď pro definici cesty. Bere jeden nebo víc kódů a popis složí
 * z registru, takže se dokumentace nemůže rozejít s chováním.
 */
export function problemResponse(...codes: string[]) {
  const described = codes
    .map((c) => `${c} (${ERROR_CODES[c]?.title ?? 'neregistrovaný kód'})`)
    .join(', ');
  return {
    description: described,
    content: { 'application/problem+json': { schema: ProblemSchema } },
  };
}

export const PaginationSchema = z
  .object({
    next_cursor: z.string().nullable(),
    prev_cursor: z.string().nullable(),
    has_more: z.boolean(),
    limit: z.number().int(),
  })
  .openapi('Pagination');

export function paginated<T extends z.ZodType>(item: T, name: string) {
  return z.object({ data: z.array(item), pagination: PaginationSchema }).openapi(name);
}

export const CountSchema = z
  .object({
    count: z.number().int(),
    precision: z.enum(['exact', 'estimated']),
    computed_at: z.iso.datetime(),
    stale: z.boolean(),
  })
  .openapi('Count');

export const PaginationQuerySchema = z.object({
  limit: z.string().optional(),
  cursor: z.string().optional(),
  order: z.string().optional(),
});

export const PublicUserSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    name: z.string(),
    locale: z.string(),
    timezone: z.string(),
    email_verified_at: z.iso.datetime().nullable(),
    created_at: z.iso.datetime(),
  })
  .openapi('User');

export const RoleSchema = z.enum(['owner', 'admin', 'editor', 'viewer']).openapi('Role');

export const WorkspaceSummarySchema = z
  .object({ id: z.uuid(), name: z.string(), slug: z.string(), role: RoleSchema })
  .openapi('WorkspaceSummary');

/**
 * ODCHYLKA OD PLÁNU: hlavička je v zod schématu VOLITELNÁ a bez omezení délky,
 * ačkoliv u zápisů povinná je. Vynucuje ji `validateIdempotencyKey`
 * v `apps/web/src/lib/api/idempotency.ts`, a to schválně:
 *
 * Hlavičky přicházejí do validátoru s klíči malými písmeny, takže by povinné
 * zod pravidlo vydalo `errors[0].path === 'idempotency-key'`, tedy jméno, které
 * klient v requestu nikdy nenapsal. `validateIdempotencyKey` vrací kanonické
 * `Idempotency-Key` a stejnou chybu i pro vadný tvar, takže obě odmítnutí
 * vypadají stejně a mají jediný zdroj pravdy. Tady zůstává jen dokumentace
 * do OpenAPI.
 */
export const IdempotencyHeaderSchema = z.object({
  'idempotency-key': z.string().optional(),
});
