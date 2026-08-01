import {
  anonymousBranding,
  applyPreferenceAction,
  loadPreferencesData,
  maskEmail,
  readVerifiedToken,
  type PreferenceAction,
} from '@mlain/core/contacts';
import { publicTranslator, resolvePublicLocale } from '@/features/public/i18n';
import { InvalidLinkPage, PreferencesDonePage, PreferencesPage } from '@/features/public/pages';
import { renderPublicPage } from '@/features/public/render';
import { readFormBody } from '@/features/public/request';

/**
 * Centrum předvoleb, `/p/{token}`.
 *
 * Token je typu 'u' (rozhodnutí R3): kontrakt 4.10.3 části 1 je zmrazený a typ 'p' v něm
 * není. Je to bezpečné, protože držitel odhlašovacího odkazu a držitel odkazu na předvolby
 * mají tentýž rozsah oprávnění: obojí přišlo v e-mailu na tutéž adresu.
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
  const verified = await readVerifiedToken(token, '/p/**');
  if (!verified.ok) return invalidPage();

  const data = await loadPreferencesData(verified.token);
  if (data === null) return invalidPage();

  const { branding } = verified.token.scope;
  const t = await publicTranslator(branding.locale, 'contacts.public');
  const locale = resolvePublicLocale(branding.locale);
  // Formátování data patří serveru: kdyby ho počítal sdílený kód klienta i serveru,
  // rozešly by se časové zóny a vznikl by nesoulad hydratace.
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' });

  return renderPublicPage(
    PreferencesPage({
      t,
      action: `/p/${token}`,
      data,
      // Adresa je maskovaná: odkaz bez expirace může najít kdokoliv.
      maskedEmail: maskEmail(data.email),
      formatDate: (value) => dateFormat.format(value),
    }),
    { branding, locale: branding.locale },
  );
}

/** Přečte akci z těla. Neznámá akce se chová jako žádná, ne jako chyba. */
function parseAction(body: URLSearchParams): PreferenceAction | null {
  const kind = body.get('action');
  switch (kind) {
    case 'update_lists':
      return { kind, listIds: body.getAll('list') };
    case 'snooze': {
      const days = Number(body.get('days'));
      return days === 30 || days === 60 || days === 90 ? { kind, days } : null;
    }
    case 'update': {
      const attributes: Record<string, string> = {};
      for (const [key, value] of body.entries()) {
        if (key.startsWith('attr_')) attributes[key.slice(5)] = value;
      }
      const locale = body.get('locale');
      const firstName = body.get('first_name');
      const lastName = body.get('last_name');
      return {
        kind,
        attributes,
        ...(locale === null ? {} : { locale }),
        ...(firstName === null ? {} : { firstName }),
        ...(lastName === null ? {} : { lastName }),
      };
    }
    case 'unsubscribe_all':
    case 'export_data':
    case 'erase_data':
      return { kind };
    default:
      return null;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const body = await readFormBody(request);

  const verified = await readVerifiedToken(token, '/p/**');
  if (!verified.ok) return invalidPage();

  const action = parseAction(body);
  if (action === null) {
    return new Response(null, { status: 303, headers: { location: `/p/${token}` } });
  }

  await applyPreferenceAction(verified.token, action);

  // Žádost podle GDPR má vlastní potvrzení: přesměrování zpět na formulář by vypadalo,
  // že se nestalo nic.
  if (action.kind === 'export_data' || action.kind === 'erase_data') {
    const { branding } = verified.token.scope;
    const t = await publicTranslator(branding.locale, 'contacts.public');
    return renderPublicPage(PreferencesDonePage({ t, action: action.kind }), {
      branding,
      locale: branding.locale,
    });
  }

  // Vzor POST, přesměrování, GET. Bez JavaScriptu i s ním se stránka po obnovení
  // neodešle znovu.
  return new Response(null, { status: 303, headers: { location: `/p/${token}` } });
}
