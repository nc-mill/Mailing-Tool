import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { problemResponse } from '../../identity/api/schemas';
import { assertPermission } from '../../identity/permissions';
import { readSentContent } from '../sent-content/read';
import { inWorkspace, workspaceOf, type ReportsEnv } from './context';
import { uuidParam } from './schemas';

export const sentContentRoutes = new OpenAPIHono<ReportsEnv>();

export const sentContentSchema = z.object({
  /** Vyrenderované tělo. `null` znamená, že se kampaň nikdy nezkompilovala. */
  html: z.string().nullable(),
  text: z.string().nullable(),
  subject: z.string(),
  compiled_at: z.string().nullable(),
  revision: z.number(),
  // Otevřený výčet, registr vlastní část 4a. Union by klienta rozbil u nové hodnoty.
  status: z.string(),
  /**
   * `missing` = kampaň nemá dokument, `empty` = má ho, ale není v něm jediný
   * obsahový blok (samotná patička se za obsah nepočítá), `ok` = obsah je.
   * Obrazovka podle toho rozliší „nemáme co ukázat" od „ukazujeme prázdný e-mail,
   * a takhle doopravdy odešel".
   */
  content_state: z.enum(['missing', 'empty', 'ok']),
  /** Adresa, podle jejíchž dat se dosadila personalizace. */
  personalized_for: z.string().nullable(),
});

/**
 * Odeslaná podoba kampaně pro report, VYRENDEROVANÁ.
 *
 * Nezaměňovat s `GET /campaigns/{id}/preview` z domény kampaní, která vrací
 * uložené sloupce tak, jak jsou, tedy se syrovými Liquid výrazy. Report se ptá
 * na jinou věc: co dostal příjemce do schránky. Proto tahle cesta patří sem,
 * k reportům, a proto interpoluje `compiled_html` daty skutečné zprávy.
 */
const sentContentRoute = createRoute({
  method: 'get',
  path: '/campaigns/{id}/sent-content',
  tags: ['reports'],
  summary: 'Co se doopravdy rozeslalo',
  request: { params: uuidParam },
  responses: {
    200: {
      description:
        'Vyrenderovaná podoba. Nezkompilovaná kampaň vrací 200 s html null, ne 404: kampaň existuje.',
      content: { 'application/json': { schema: sentContentSchema } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

sentContentRoutes.openapi(sentContentRoute, async (c) => {
  const { id } = c.req.valid('param');
  assertPermission(workspaceOf(c), 'reports:read');
  const read = await inWorkspace(c, (tx, ctx) => readSentContent(tx, ctx, id));

  c.header('Cache-Control', 'no-store');
  return c.json(
    {
      html: read.html,
      text: read.text,
      subject: read.subject,
      compiled_at: read.compiledAt === null ? null : read.compiledAt.toISOString(),
      revision: read.revision,
      status: read.status,
      content_state: read.contentState,
      personalized_for: read.personalizedFor,
    },
    200,
  );
});
