import { handleSnsWebhook, snsWebhookDeps, MAX_SNS_BODY_BYTES } from '@mlain/core/providers/api';

/**
 * Příjem událostí od Amazonu. Vlastní Route Handler, ne součást `/api/v1`:
 * konvence veřejného API (autentizace, CSRF, `application/json`) tady neplatí,
 * protože protistranou je SNS. Endpoint proto přijímá `text/plain`, což by
 * kontrola typu v `/api/v1` odmítla s 415.
 *
 * Runtime je Node.js: ověření podpisu potřebuje `node:crypto` a zápis potvrzenky
 * databázi.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ providerId: string }> },
): Promise<Response> {
  const { providerId } = await context.params;

  // Tělo se čte SYROVĚ. Podpis se ověřuje nad ním, ne nad znovu serializovaným
  // JSONem, protože přeuspořádání klíčů by kanonickou podobu změnilo.
  const raw = await request.text();

  // Adresa jde do bezpečnostního záznamu u neplatného podpisu. Bere se z hlavičky
  // rovnou, protože počet důvěryhodných proxy zná až `clientIpFrom` v kontextu
  // aplikace `/api/v1`, kterým tenhle povrch neprochází.
  const result = await handleSnsWebhook(snsWebhookDeps(), {
    providerId,
    rawBody: raw,
    ip: request.headers.get('x-forwarded-for'),
  });

  return new Response(result.body, {
    status: result.status,
    headers: result.body
      ? { 'Content-Type': 'application/problem+json' }
      : { 'Content-Length': '0' },
  });
}

/** Vystavuje se kvůli testům: strop těla je součást chování endpointu. */
export { MAX_SNS_BODY_BYTES };
