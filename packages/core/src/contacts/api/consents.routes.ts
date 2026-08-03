import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { ApiError } from '../../errors/api-error';
import { assertPermission } from '../../identity/permissions';
import { withWorkspace } from '../../tx';
import { buildConsentEvidence, consentTextEvidence } from '../consents/evidence';
import { storeIpEnabled } from '../privacy';
import { getContactById } from '../repo/contacts-query';
import { listConsents, recordConsent, type ConsentRow } from '../repo/consents';
import { checkSingleSuppression } from '../repo/suppressions';
import type { ContactsEnv } from './index';
import { ConsentInput, IsoDateTime, Uuid, problemResponse, toIsoRequired } from './schemas';

const TAG = 'Consents';

/**
 * Historie souhlasů je APPEND ONLY. Endpoint na úpravu ani smazání záznamu neexistuje
 * a nesmí vzniknout: doklad o souhlasu, který jde přepsat, není doklad.
 */
const ConsentRecordSchema = z
  .object({
    id: Uuid,
    contact_id: Uuid,
    purpose: z.string(),
    scope_list_id: Uuid.nullable(),
    status: z.enum(['granted', 'withdrawn']),
    legal_basis: z.string(),
    source: z.string(),
    consent_text: z.string().nullable(),
    evidence: z.record(z.string(), z.unknown()),
    occurred_at: IsoDateTime,
    created_at: IsoDateTime,
  })
  .openapi('ConsentRecord');

function present(row: ConsentRow): z.infer<typeof ConsentRecordSchema> {
  return {
    id: row.id,
    contact_id: row.contact_id,
    purpose: row.purpose,
    scope_list_id: row.scope_list_id,
    status: row.status,
    legal_basis: row.legal_basis,
    source: row.source,
    consent_text: row.consent_text,
    evidence: row.evidence,
    occurred_at: toIsoRequired(row.occurred_at),
    created_at: toIsoRequired(row.created_at),
  };
}

const ContactIdParam = z.object({ contact_id: Uuid });

const listRoute = createRoute({
  method: 'get',
  path: '/contacts/{contact_id}/consents',
  tags: [TAG],
  summary: 'Historie souhlasů kontaktu, od nejnovějšího',
  security: [{ bearerAuth: ['contacts:read'] }],
  request: { params: ContactIdParam },
  responses: {
    200: {
      description: 'Historie souhlasů',
      content: {
        'application/json': { schema: z.object({ data: z.array(ConsentRecordSchema) }) },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const recordRoute = createRoute({
  method: 'post',
  path: '/contacts/{contact_id}/consents',
  tags: [TAG],
  summary: 'Zápis souhlasu nebo jeho odvolání',
  security: [{ bearerAuth: ['contacts:write'] }],
  request: {
    params: ContactIdParam,
    body: { content: { 'application/json': { schema: ConsentInput } } },
  },
  responses: {
    201: {
      description: 'Zapsáno',
      content: { 'application/json': { schema: z.object({ id: Uuid }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    // Udělený souhlas pro adresu na suppression listu, detail `contact_suppressed`.
    409: problemResponse('conflict'),
    422: problemResponse('validation_failed'),
  },
});

export function registerConsentRoutes(app: OpenAPIHono<ContactsEnv>): void {
  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:read');
    const contactId = c.req.valid('param').contact_id;
    if ((await getContactById(ctx, contactId)) === null) throw new ApiError('not_found');
    const rows = await listConsents(ctx, contactId);
    return c.json({ data: rows.map(present) }, 200);
  });

  app.openapi(recordRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'contacts:write');
    const contactId = c.req.valid('param').contact_id;
    const contact = await getContactById(ctx, contactId);
    if (contact === null) throw new ApiError('not_found');

    const body = c.req.valid('json');

    // Pravidlo 4 z 4.1.2: adresa na suppression listu nedostane udělený souhlas. Tady se
    // ODMÍTÁ, ne přeskakuje: obsahem požadavku je právě ten souhlas, takže 201 s tichým
    // zahozením by klientovi tvrdilo, že souhlas existuje, a on by se na něj spoléhal.
    // Odvolání souhlasu prochází vždy, míří stejným směrem jako blokace.
    if (body.status === 'granted') {
      const suppression = await checkSingleSuppression(ctx, contact.email);
      if (suppression !== null) {
        throw new ApiError('conflict', {
          params: { detail: 'contact_suppressed', reason: suppression.reason },
        });
      }
    }
    // Evidence prochází `buildConsentEvidence`, protože ta respektuje přepínač
    // workspaces.settings.privacy.store_ip (rozhodnutí R8). Kdyby se zapsala syrově,
    // uložila by se IP i v projektu, který si to vypnul.
    const storeIp = await withWorkspace(ctx, async (tx) => storeIpEnabled(tx, ctx));
    const raw = (body.evidence ?? {}) as Record<string, unknown>;
    const evidence = buildConsentEvidence({
      storeIp,
      ...(typeof raw['ip'] === 'string' ? { ip: raw['ip'] } : {}),
      ...(typeof raw['user_agent'] === 'string' ? { user_agent: raw['user_agent'] } : {}),
      ...(typeof raw['page_url'] === 'string' ? { page_url: raw['page_url'] } : {}),
      ...(typeof raw['form_id'] === 'string' ? { form_id: raw['form_id'] } : {}),
      ...(raw['declaration'] === true ? { declaration: true } : {}),
      ...consentTextEvidence(body.consent_text),
    });

    const { id } = await recordConsent(ctx, {
      contactId,
      purpose: body.purpose,
      status: body.status,
      legalBasis: body.legal_basis,
      scopeListId: null,
      source: 'api',
      ...(body.consent_text === undefined ? {} : { consentText: body.consent_text }),
      ...(body.occurred_at === undefined ? {} : { occurredAt: new Date(body.occurred_at) }),
      evidence,
    });
    return c.json({ id }, 201);
  });
}
