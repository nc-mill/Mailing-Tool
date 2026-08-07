import {
  anonymousBranding,
  isOneClickBody,
  loadPublicPageDesign,
  oneClickRateLimit,
  readVerifiedToken,
  recordSystemLinkVisit,
  unsubscribeByToken,
  unsubscribeRedirectFor,
} from '@mlain/core/contacts';
import { sanitizePublicToken } from '@mlain/core/net/public-link';
import { renderDesignedPage } from '@/features/public/designed-page';
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
 *
 * TOKEN SE ČISTÍ HNED NA VSTUPU. Gmail k odkazu připojuje `&source=gmail&ust=…&usg=…`
 * naivním spojením, takže se přílepek stane součástí segmentu cesty a tím i tokenu.
 * `sanitizePublicToken` ho uřízne a všechny adresy, které stránka dál skládá (`action`,
 * odkaz na předvolby, přesměrování po odhlášení), se staví z očištěné podoby. Kdyby se
 * skládaly ze syrového parametru, POST z formuláře by přílepek zopakoval.
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
  const token = sanitizePublicToken((await params).token);
  const verified = await readVerifiedToken(token, '/u/**');
  if (!verified.ok) return invalidPage();

  const { branding } = verified.token.scope;
  const t = await publicTranslator(branding.locale, 'contacts.public');
  const done = new URL(request.url).searchParams.get('done') === '1';

  // Otevření odhlašovací stránky je proklik, samotné odhlášení je jiná událost
  // a zapisuje ho `unsubscribeByToken`. Kdo si stránku otevře a odejde, nechá
  // po sobě jen tenhle proklik, a to je přesně ta informace, která odesílateli
  // dosud chyběla. Přesměrování po odhlášení (`?done=1`) druhý řádek nevyrobí.
  await recordSystemLinkVisit(verified.token, 'unsubscribe_page');

  /*
   * Navržená stránka po odhlášení (povrch `unsubscribed`, plán oddíl 3).
   *
   * JEN VE VĚTVI `?done=1`, tedy až po zápisu odhlášení, který udělal POST.
   * Stránka PŘED odhlášením nese tlačítko, kterým se odhlašuje, a ta ovládací
   * prvky navrhnout nejdou; je to totéž vymezení, kvůli kterému zůstává mimo
   * rozsah centrum předvoleb.
   *
   * Jen u odhlášení z JEDNOHO seznamu, protože stránku vlastní seznam. Kdo se
   * odhlásil ze všeho, nemá podle čeho seznam vybrat, a vzít „nějaký" by
   * znamenalo ukázat stránku, která s jeho rozhodnutím nesouvisí. Táž hranice
   * platí u `unsubscribeRedirectFor`.
   *
   * Vedlejší účinek je v jiném požadavku, takže ho tohle vykreslení nemůže
   * zvrátit ani pádem; `renderDesignedPage` navíc padá na vestavěný text.
   */
  if (done && verified.token.effectiveScope === 'list' && verified.token.data.listId !== null) {
    const designed = await renderDesignedPage(
      await loadPublicPageDesign({
        ctx: verified.token.scope.ctx,
        surface: 'unsubscribed',
        branding,
        listId: verified.token.data.listId,
        contactId: verified.token.data.contactId,
        listName: verified.token.listName,
      }),
    );
    if (designed !== null) return designed;
  }

  // GET jen vykreslí stránku a NIC NEODHLÁSÍ (kritérium 57).
  return renderPublicPage(
    UnsubscribePage({
      t,
      action: `/u/${token}`,
      // Na předvolby se odkazuje jen tehdy, když je projekt nabízí. Odhlášení samo
      // zůstává vždycky: je to zákonná povinnost, ne nastavení.
      preferencesHref: verified.token.scope.preferenceCenter ? `/p/${token}` : null,
      senderName: branding.senderName,
      listName: verified.token.listName,
      // Rozsah se NEODVOZUJE z tokenu, čte se hotový z `effectiveScope`: seznam
      // přepnutý na `unsubscribe_scope = 'global'` odhlašuje ze všeho, i když
      // token seznam nese. Kdyby si to stránka počítala sama, řekla by „odhlásíme
      // vás z Novinek" a odhlásila by ze všeho.
      scoped: verified.token.effectiveScope === 'list',
      done,
    }),
    { branding, locale: branding.locale },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const token = sanitizePublicToken((await params).token);

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
        // Týž zdroj pravdy jako u stránky, viz GET.
        scoped: verified.token.effectiveScope === 'list',
        listName: verified.token.listName,
      }),
      { branding, locale: branding.locale },
    );
  }

  // Běžný formulář ze stránky odhlášení. Na ten se zákaz přesměrování nevztahuje,
  // protože to není one-click podle RFC.
  const forceGlobal = body.get('action') === 'unsubscribe_all';
  await unsubscribeByToken(verified.token, { reason: 'link', forceGlobal });

  /*
   * Vlastní stránka po odhlášení (`lists.unsubscribe_redirect_url`), jen
   * u odhlášení z JEDNOHO seznamu. Kdo zvolil „nechci od vás už nic", nemá
   * podle čeho vybrat seznam, a poslat ho na stránku jednoho z nich by
   * s jeho rozhodnutím nesouviselo. Podrobně v `unsubscribeRedirectFor`.
   */
  const redirectUrl = await unsubscribeRedirectFor(verified.token, { forceGlobal });
  const location = redirectUrl ?? `/u/${token}?done=1`;
  return new Response(null, { status: 303, headers: { location } });
}
