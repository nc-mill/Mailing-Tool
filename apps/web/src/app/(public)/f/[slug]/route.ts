import {
  anonymousBranding,
  issueFormNonce,
  loadPublicForm,
  localizedText,
  publicScope,
  formFieldName,
} from '@mlain/core/contacts';
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const isScript = slug.endsWith('.js');
  const ref = isScript ? slug.slice(0, -3) : slug;

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
        action: `/f/${ref}/submit`,
        submitLabel: t('form.submit'),
        successMessage: success === '' ? t('form.thanksBody') : success,
        honeypot: form.honeypotField,
        css: form.customCss ?? '',
        fields: form.fields.map((field) => ({
          name: formFieldName(field),
          label: localizedText(field.label, branding.locale),
          type: field.type === 'email' ? 'email' : 'text',
          required: field.required,
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
