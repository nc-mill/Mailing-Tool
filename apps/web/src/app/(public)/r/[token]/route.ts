import { anonymousBranding, applyReactivation, readVerifiedToken } from '@mlain/core/contacts';
import { publicTranslator } from '@/features/public/i18n';
import {
  InvalidLinkPage,
  ReactivationDonePage,
  ReactivationPromptPage,
} from '@/features/public/pages';
import { renderPublicPage } from '@/features/public/render';

/**
 * Reaktivační kliknutí, tedy tlačítko „Ano, posílejte dál" v reaktivační kampani.
 *
 * Zapisuje souhlas se zdrojem `reactivation`. Ta hodnota MUSÍ být v CHECK omezení
 * `ck_consents__source`; kdyby nebyla, spadlo by první kliknutí na 23514 a reaktivační
 * kampaň by přestala fungovat bez varování. Kryje to kritérium 83 a hlídá databázový test.
 *
 * Zbytek reaktivačního scénáře (zmrazení segmentu, kampaň, úklidový job) vlastní plán
 * P11, protože stojí na segmentech.
 *
 * GET jen vykreslí stránku s tlačítkem, zapisuje výhradně POST: odkaz v e-mailu
 * proklikávají bezpečnostní skenery a reaktivace na GET by je zapsala jako souhlas.
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
  const verified = await readVerifiedToken(token, '/r/**');
  if (!verified.ok) return invalidPage();

  const { branding } = verified.token.scope;
  const t = await publicTranslator(branding.locale, 'contacts.public');
  return renderPublicPage(ReactivationPromptPage({ t, action: `/r/${token}` }), {
    branding,
    locale: branding.locale,
  });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const verified = await readVerifiedToken(token, '/r/**');
  if (!verified.ok) return invalidPage();

  // Opakované kliknutí nic nezkazí: souhlas je append-only log, štítek se vkládá
  // idempotentně a poslední aktivita se jen posune.
  await applyReactivation(verified.token);

  const { branding } = verified.token.scope;
  const t = await publicTranslator(branding.locale, 'contacts.public');
  return renderPublicPage(ReactivationDonePage({ t }), { branding, locale: branding.locale });
}
