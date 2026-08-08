import {
  anonymousBranding,
  loadWebview,
  readVerifiedToken,
  recordSystemLinkVisit,
} from '@mlain/core/contacts';
import { sanitizePublicToken } from '@mlain/core/net/public-link';
import { publicTranslator } from '@/features/public/i18n';
import { InvalidLinkPage, WebviewUnavailablePage } from '@/features/public/pages';
import { publicHtmlResponse, renderPublicPage } from '@/features/public/render';

/**
 * Zobrazení odeslané zprávy v prohlížeči, `/v/{token}`.
 *
 * ODKAZ SE VYRÁBĚL, ALE NEOBSLUHOVAL. Odesílač skládá `{{ webview_url }}` jako
 * `/v/<odhlašovací token>` (`apps/sender/internal/token/urls.go:33`) a vkládá ho do
 * patičky každé zprávy, která má „Zobrazit v prohlížeči" zapnuté. Ve webu žádná cesta
 * `/v/` nebyla, takže ten odkaz vedl v každém odeslaném e-mailu na 404. Že se to nikdo
 * nedozvěděl, je vlastnost toho rozdělení: adresu vyrábí Go, obsluhuje ji TypeScript
 * a mezi nimi nebyla žádná brána. Tu brána doplňuje
 * `apps/web/test/public/sender-public-paths.test.ts`.
 *
 * TŘI VLASTNOSTI, KTERÉ JSOU ÚMYSLNÉ:
 *
 * 1. JEN GET. Stránka nic nemění, takže POST nemá co obsluhovat. Bezpečnostní skenery
 *    smí odkaz proklikat kolikrát chtějí a nezmění tím nic, na rozdíl od `/s/c/` a `/r/`.
 *
 * 2. VLASTNÍ TĚLO, NE `renderPublicPage`. Tělo e-mailu je samo o sobě celý HTML
 *    dokument s vlastní hlavičkou a styly; obalit ho ještě jednou do shellu veřejných
 *    stránek by dalo dvě `<html>` v jednom výstupu. Hlavičky odpovědi ale jdou přes
 *    `publicHtmlResponse` jako všude jinde. Dokud se tu opisovaly ručně, chyběla jim
 *    politika obsahu i ochrana proti rámování, přesně jak se opsané sady rozcházejí.
 *
 * 3. NIKDY 404, ani když zpráva chybí. Podle odpovědi se nesmí dát zjišťovat, které
 *    tokeny a které zprávy existují, stejně jako u ostatních veřejných cest.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function invalidPage(): Promise<Response> {
  const branding = anonymousBranding();
  const t = await publicTranslator(branding.locale, 'contacts.public');
  return renderPublicPage(InvalidLinkPage({ t }), { branding, locale: branding.locale });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  // Očištěno o přílepek poštovního klienta úplně stejně jako odhlašovací odkaz:
  // Gmail připojuje `&source=gmail&ust=…` i sem. Viz `net/public-link.ts`.
  const token = sanitizePublicToken((await params).token);
  const verified = await readVerifiedToken(token, '/v/**');
  if (!verified.ok) return invalidPage();

  // „Zobrazit v prohlížeči" je proklik na systémový odkaz. Připisuje se před
  // načtením zprávy: i když už tělo není k dispozici, příjemce na odkaz klikl.
  await recordSystemLinkVisit(verified.token, 'webview');

  const result = await loadWebview(verified.token, token);
  if (result.state === 'unavailable') {
    // Token platí, ale zpráva už není. Stránka to musí ŘÍCT, ne tvrdit, že je
    // odkaz poškozený: příjemce by ho zkoušel znovu a znovu.
    const { branding } = verified.token.scope;
    const t = await publicTranslator(branding.locale, 'contacts.public');
    return renderPublicPage(WebviewUnavailablePage({ t }), { branding, locale: branding.locale });
  }

  return publicHtmlResponse(result.html);
}
