import {
  anonymousBranding,
  isOneClickBody,
  oneClickRateLimit,
  readVerifiedToken,
  unsubscribeByToken,
} from '@mlain/core/contacts';
import { publicTranslator } from '@/features/public/i18n';
import { InvalidLinkPage, OneClickDonePage, UnsubscribePage } from '@/features/public/pages';
import { renderPublicPage } from '@/features/public/render';
import { readFormBody } from '@/features/public/request';
import { consumeTokenRateLimit } from '@/features/public/rate-limit';

/**
 * Odhlášení, `/u/{token}`.
 *
 * TŘI VLASTNOSTI, KTERÉ VYPADAJÍ JAKO CHYBA A JSOU ÚMYSLNÉ. Nesmí se „opravit"
 * při příští bezpečnostní revizi:
 *
 * 1. BEZ ochrany proti padělání požadavku. Autorizaci nese podepsaný token, cookie
 *    se nečte. Je to přímý požadavek RFC 8058 bodu 5: POST nesmí obsahovat cookies,
 *    HTTP autorizaci ani jiný kontext.
 *
 * 2. NIKDY nevrací přesměrování u one-click těla. RFC 8058 bod 6: přesměrovaný POST
 *    se v prohlížečích chová nespolehlivě a často se mění na GET.
 *
 * 3. BEZ per-IP rate limitu, jen limit na token. Tenhle POST neposílá prohlížeč
 *    příjemce, ale infrastruktura poštovního providera z úzké sady serverových adres.
 *    Per-IP limit by u kampaně na sto tisíc adres začal odmítat s 429, poštovní klient
 *    by ukázal, že odhlášení selhalo, a uživatel by místo toho označil zprávu jako spam.
 *    Neúspěšné one-click odhlášení je přesně to, za co Gmail penalizuje doručitelnost,
 *    takže by ochrana způsobila právě tu škodu, které má bránit.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function invalidPage(): Promise<Response> {
  const branding = anonymousBranding();
  const t = await publicTranslator(branding.locale, 'contacts.public');
  return renderPublicPage(InvalidLinkPage({ t }), { branding, locale: branding.locale });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const verified = await readVerifiedToken(token, '/u/**');
  if (!verified.ok) return invalidPage();

  const { branding } = verified.token.scope;
  const t = await publicTranslator(branding.locale, 'contacts.public');
  const done = new URL(request.url).searchParams.get('done') === '1';

  // GET jen vykreslí stránku a NIC NEODHLÁSÍ (kritérium 57).
  return renderPublicPage(
    UnsubscribePage({
      t,
      action: `/u/${token}`,
      preferencesHref: `/p/${token}`,
      senderName: branding.senderName,
      listName: verified.token.listName,
      scoped: verified.token.data.listId !== null,
      done,
    }),
    { branding, locale: branding.locale },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;

  const verified = await readVerifiedToken(token, '/u/**');
  if (!verified.ok) {
    // I neplatný token dostane 200: podle odpovědi se nesmí dát zjišťovat,
    // které tokeny platí.
    return invalidPage();
  }

  if (!consumeTokenRateLimit(token)) {
    return new Response(null, {
      status: 429,
      headers: { 'retry-after': String(oneClickRateLimit.perToken.durationSeconds) },
    });
  }

  const body = await readFormBody(request);
  const { branding } = verified.token.scope;
  const t = await publicTranslator(branding.locale, 'contacts.public');

  if (isOneClickBody(body)) {
    await unsubscribeByToken(verified.token, { reason: 'one_click' });
    // Krátké HTML, bez přesměrování.
    return renderPublicPage(
      OneClickDonePage({
        t,
        scoped: verified.token.data.listId !== null,
        listName: verified.token.listName,
      }),
      { branding, locale: branding.locale },
    );
  }

  // Běžný formulář ze stránky odhlášení. Na ten se zákaz přesměrování nevztahuje,
  // protože to není one-click podle RFC.
  await unsubscribeByToken(verified.token, {
    reason: 'link',
    forceGlobal: body.get('action') === 'unsubscribe_all',
  });
  return new Response(null, { status: 303, headers: { location: `/u/${token}?done=1` } });
}
