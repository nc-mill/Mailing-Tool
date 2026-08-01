import { anonymousBranding, confirmByRef, lookupConfirmation } from '@mlain/core/contacts';
import {
  ConfirmExpiredPage,
  ConfirmPage,
  ConfirmResultPage,
  InvalidLinkPage,
} from '@/features/public/pages';
import { publicTranslator } from '@/features/public/i18n';
import { renderPublicPage } from '@/features/public/render';
import { requestIp, requestUserAgent, readFormBody } from '@/features/public/request';

/**
 * Potvrzení přihlášení, `/s/c/{ref}`.
 *
 * GET NIKDY nepotvrzuje, v žádném režimu (rozhodnutí R2). Firemní bezpečnostní skenery
 * a náhledové služby odkazy v e-mailech samy proklikávají metodou GET; kdyby GET
 * potvrzoval, přihlásily by lidi, kteří o tom nevědí, a dvojí potvrzení by ztratilo
 * důkazní hodnotu, což je jediné, kvůli čemu existuje.
 *
 * Runtime je Node.js: potřebujeme node:crypto a pg.
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
  const { token } = await params;
  const lookup = await lookupConfirmation(token);

  // Neplatný, neexistující i poškozený token dávají BAJTOVĚ STEJNOU stránku.
  if (lookup.state === 'invalid') return invalidPage();

  const t = await publicTranslator(lookup.branding.locale, 'contacts.public');
  const action = `/s/c/${token}`;

  if (lookup.state === 'consumed') {
    return renderPublicPage(
      ConfirmResultPage({ t, view: 'already_used', listName: lookup.listName }),
      { branding: lookup.branding, locale: lookup.branding.locale },
    );
  }

  if (lookup.state === 'expired') {
    return renderPublicPage(ConfirmExpiredPage({ t, action }), {
      branding: lookup.branding,
      locale: lookup.branding.locale,
    });
  }

  return renderPublicPage(
    ConfirmPage({
      t,
      action,
      listName: lookup.listName,
      senderName: lookup.branding.senderName,
      // Jediný rozdíl mezi režimy: skript odešle formulář za uživatele. Bez JavaScriptu
      // zůstane na stránce tlačítko a stránka funguje dál.
      autoSubmit: lookup.confirmationMode === 'one_step',
    }),
    { branding: lookup.branding, locale: lookup.branding.locale },
  );
}

/**
 * POST potvrzuje. Nikdy nevrací chybový stav navenek: každý výsledek je stránka
 * s vysvětlením a stavovým kódem 200. Opakované kliknutí na už použitý odkaz zobrazí
 * „už jste přihlášeni", protože lidé klikají dvakrát a chybová stránka by je zmátla.
 *
 * Prošlý token nabídne a odešle nový; rozhoduje o tom `confirmSubscription`, které
 * hlídá i strop tří odeslání za 24 hodin.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  // Tělo se čte, i když se z něj nic nepoužívá: `action=resend` obsluhuje tatáž
  // doménová cesta a nepřečtené tělo drží spojení otevřené.
  await readFormBody(request);

  const result = await confirmByRef(token, {
    requestIp: requestIp(request),
    userAgent: requestUserAgent(request),
  });

  // 'confirm_prompt' se z POSTu vrátit nemůže: tuhle větev vrací jen GET.
  if (result.view === 'invalid' || result.view === 'confirm_prompt') return invalidPage();

  const t = await publicTranslator(result.branding.locale, 'contacts.public');
  return renderPublicPage(ConfirmResultPage({ t, view: result.view, listName: result.listName }), {
    branding: result.branding,
    locale: result.branding.locale,
  });
}
