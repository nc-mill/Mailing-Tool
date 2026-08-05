import {
  anonymousBranding,
  issueFormNonce,
  loadPublicForm,
  localizedText,
  publicScope,
  formFieldName,
} from '@mlain/core/contacts';
import { sanitizePublicSlug } from '@mlain/core/net/public-link';
import { buildEmbedScript } from '@/features/public/embed-script';
import { publicTranslator } from '@/features/public/i18n';
import { HostedFormPage } from '@/features/public/form-pages';
import { InvalidLinkPage } from '@/features/public/pages';
import { renderPublicPage } from '@/features/public/render';
import { requestIp } from '@/features/public/request';

/**
 * Hostovaná stránka formuláře `/f/{ref}` a vkládací skript `/f/{ref}.js`.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ APP ROUTEREM. Plán zakládal samostatný segment
 * `f/[slug].js/`. Dynamický segment musí být celý název složky (`[slug]`), takže
 * `[slug].js` by App Router bral jako doslovnou cestu a `/f/neco.js` by na ni nikdy
 * netrefil. Obojí proto obsluhuje jeden handler: adresa končící `.js` vydá skript,
 * ostatní stránku. Je to i tvar, se kterým už plán počítá, protože jeho vlastní kód
 * skriptu volá `loadPublicForm(slug.replace(/\\.js$/, ''))`.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Adresa, ze které si cizí web skript stáhl.
 *
 * Odvozuje se z požadavku, ne z konfigurace: je to přesně ta adresa, na kterou
 * prohlížeč právě dosáhl, takže sedí i za reverzní proxy a v instalaci, kde je
 * `APP_URL` psané jinak (jiný port ve vývoji, jiná doména za CDN).
 */
function appOrigin(request: Request): string {
  return new URL(request.url).origin;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const isScript = slug.endsWith('.js');
  // Přípona se odřízne PŘED očistou: tečka do abecedy slugu nepatří, takže by
  // ji `sanitizePublicSlug` uřízla i s ní. Očista tu je ze stejného důvodu jako
  // u ostatních veřejných cest, viz `net/public-link.ts`.
  const ref = sanitizePublicSlug(isScript ? slug.slice(0, -3) : slug);

  const form = await loadPublicForm(ref);
  if (form === null || !form.active) {
    // Skript pro neznámý formulář vrací 404 a prázdné tělo: je to strojové rozhraní,
    // ne stránka pro člověka, takže se generická stránka nehodí.
    if (isScript) return new Response('', { status: 404 });
    const branding = anonymousBranding();
    const t = await publicTranslator(branding.locale, 'contacts.public');
    return renderPublicPage(InvalidLinkPage({ t }), { branding, locale: branding.locale });
  }

  const scope = await publicScope(form.workspaceId, 'contacts.public.form');
  const branding = scope?.branding ?? anonymousBranding();
  const t = await publicTranslator(branding.locale, 'contacts.public');

  if (isScript) {
    const success = localizedText(form.successMessage, branding.locale);
    return new Response(
      buildEmbedScript({
        ref,
        // Obě adresy jsou ABSOLUTNÍ. Skript běží na cizí doméně, takže relativní
        // cesta by mířila na web zákazníka, ne na nás.
        action: `${appOrigin(request)}/f/${ref}/submit`,
        nonceUrl: `${appOrigin(request)}/f/${ref}/nonce`,
        submitLabel: t('form.submit'),
        successMessage: success === '' ? t('form.thanksBody') : success,
        honeypot: form.honeypotField,
        consentText: form.consentText ?? '',
        consentRequired: form.consentRequired,
        // `form.customCss` se do vkládaného formuláře NEPŘEDÁVÁ. Vzhled vlastní web,
        // na kterém formulář stojí, viz hlavička `buildEmbedScript`.
        fields: form.fields.map((field) => ({
          name: formFieldName(field),
          label: localizedText(field.label, branding.locale),
          type: field.type === 'datetime' ? 'datetime-local' : field.type,
          required: field.required,
          ...(field.options === undefined
            ? {}
            : {
                options: field.options.map((option) => ({
                  value: option.value,
                  label: localizedText(option.label, branding.locale),
                })),
              }),
        })),
      }),
      {
        headers: {
          'content-type': 'application/javascript; charset=utf-8',
          // Formulář se vkládá na cizí doménu, takže skript musí být čitelný odkudkoliv.
          'access-control-allow-origin': '*',
          'cache-control': 'public, max-age=300',
        },
      },
    );
  }

  const nonce = issueFormNonce({ formId: form.id, ip: requestIp(request) });

  return renderPublicPage(
    HostedFormPage({
      t,
      name: form.name,
      action: `/f/${ref}/submit`,
      nonce: nonce.value,
      fields: form.fields,
      honeypotField: form.honeypotField,
      consentText: form.consentText,
      consentRequired: form.consentRequired,
      locale: branding.locale,
    }),
    { branding, locale: branding.locale },
  );
}
