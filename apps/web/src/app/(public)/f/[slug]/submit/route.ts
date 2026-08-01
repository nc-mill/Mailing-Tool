import { elapsedSinceNonce, loadPublicForm, submitForm } from '@mlain/core/contacts';
import { requestIp, requestUserAgent } from '@/features/public/request';

/**
 * Odeslání formuláře. Přijímá JSON, urlencoded i multipart.
 *
 * U urlencoded odpovídá 303 na vlastní adresu nebo na děkovací stránku, takže
 * čistě HTML formulář funguje i s vypnutým JavaScriptem. Skriptová varianta posílá
 * JSON a odpověď zpracuje sama.
 *
 * Odpověď je VŽDY STEJNÁ, ať kontakt existuje nebo ne a ať je adresa blokovaná nebo ne.
 * Kdyby se u známé adresy lišila, stal by se z formuláře nástroj na zjišťování,
 * kdo je v databázi, a u citlivého oboru je to reálný problém.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const contentType = request.headers.get('content-type') ?? '';
  const json = contentType.includes('application/json');

  const fields = json
    ? ((await request.json()) as Record<string, unknown>)
    : Object.fromEntries((await request.formData()).entries());

  const form = await loadPublicForm(slug);
  if (form === null || !form.active) {
    // Neznámý formulář se navenek chová jako neexistující adresa. Nic o projektu
    // se z odpovědi dozvědět nedá.
    return new Response(null, { status: 404 });
  }

  const nonce = String(fields['ml_nonce'] ?? '');
  const result = await submitForm(form, {
    fields,
    origin: request.headers.get('origin'),
    nonce: nonce === '' ? undefined : nonce,
    ip: requestIp(request),
    userAgent: requestUserAgent(request),
    pageUrl: request.headers.get('referer') ?? '',
    // Doba vyplnění se počítá z NONCE, ne z hodnoty poslané klientem: tu si bot
    // nastaví na cokoliv a časová past by přestala platit.
    elapsedSeconds: elapsedSinceNonce(nonce),
    contentType: json ? 'application/json' : 'application/x-www-form-urlencoded',
  });

  if (result.status === 303) {
    return new Response(null, {
      status: 303,
      headers: { location: result.location ?? `/f/${slug}/thanks` },
    });
  }

  return Response.json(result.response, {
    status: result.status,
    headers: {
      // Formulář z definice běží na cizí doméně, takže skriptová varianta potřebuje
      // povolení pro odeslání odjinud.
      'access-control-allow-origin': '*',
      ...(result.retryAfterSeconds === undefined
        ? {}
        : { 'retry-after': String(result.retryAfterSeconds) }),
    },
  });
}

/** Předletový dotaz skriptové varianty. Bez něj prohlížeč JSON odeslání zablokuje. */
export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '600',
    },
  });
}
