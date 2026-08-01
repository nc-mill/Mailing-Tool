import {
  anonymousBranding,
  localizedText,
  loadPublicForm,
  publicScope,
} from '@mlain/core/contacts';
import { FormThanksPage } from '@/features/public/form-pages';
import { publicTranslator } from '@/features/public/i18n';
import { renderPublicPage } from '@/features/public/render';

/**
 * Děkovací stránka po odeslání formuláře bez JavaScriptu.
 *
 * Je to cíl přesměrování 303, takže obnovení stránky nic neodešle znovu. Text si smí
 * projekt přepsat v definici formuláře; když ho nemá, použije se obecný.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const form = await loadPublicForm(slug);

  const branding =
    form === null
      ? anonymousBranding()
      : ((await publicScope(form.workspaceId, 'contacts.public.form'))?.branding ??
        anonymousBranding());
  const t = await publicTranslator(branding.locale, 'contacts.public');
  const message = form === null ? '' : localizedText(form.successMessage, branding.locale);

  return renderPublicPage(FormThanksPage({ t, message: message === '' ? null : message }), {
    branding,
    locale: branding.locale,
  });
}
