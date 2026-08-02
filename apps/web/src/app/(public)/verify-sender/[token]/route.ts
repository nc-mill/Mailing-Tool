import { anonymousBranding } from '@mlain/core/contacts';
import { confirmTrialAddress } from '@mlain/core/providers/api';
import { publicTranslator } from '@/features/public/i18n';
import { renderPublicPage } from '@/features/public/render';
import { VerifySenderPage } from '@/features/sending/verify-sender-page';

/**
 * Potvrzení adresy ve zkušebním režimu, `/verify-sender/{token}`.
 *
 * Je to VEŘEJNÁ stránka bez přihlášení, a to schválně: odkaz otevírá majitel
 * schránky, který v nástroji účet nemá. Projekt ani adresa se neberou z požadavku,
 * jsou uvnitř podepsaného tokenu (viz `providers/trial-token.ts`), takže bez
 * podpisu se nedá potvrdit ani cizí adresa, ani nic v cizím projektu.
 *
 * POTVRZUJE SE NA GET, což je vědomý rozdíl proti double opt-in v `/s/c/{token}`.
 * Tam GET nepotvrzuje nikdy, protože firemní skenery odkazy proklikávají a souhlas
 * se zasíláním by ztratil důkazní hodnotu. Tady se nepotvrzuje ničí souhlas, jen se
 * dokládá, že schránka existuje a že se k ní její majitel dostane; sken uvnitř téže
 * firmy je pro tenhle účel stejný důkaz jako klik. Odkaz otevřený podruhé nic nemění,
 * první potvrzení si drží svůj čas.
 *
 * Runtime je Node.js: potřebujeme node:crypto a pg.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const branding = anonymousBranding();
  const t = await publicTranslator(branding.locale, 'campaigns.trial');
  const result = await confirmTrialAddress(token);

  return renderPublicPage(
    VerifySenderPage(result.ok ? { t, email: result.email } : { t, email: null }),
    { branding, locale: branding.locale },
  );
}
