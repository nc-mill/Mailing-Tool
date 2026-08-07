import {
  ALREADY_SUBSCRIBED_QUERY,
  anonymousBranding,
  loadPublicPageDesign,
  localizedText,
  loadPublicForm,
  publicScope,
} from '@mlain/core/contacts';
import { renderDesignedPage } from '@/features/public/designed-page';
import { FormThanksPage } from '@/features/public/form-pages';
import { publicTranslator } from '@/features/public/i18n';
import { renderPublicPage } from '@/features/public/render';

/**
 * Děkovací stránka po odeslání formuláře bez JavaScriptu.
 *
 * Je to cíl přesměrování 303, takže obnovení stránky nic neodešle znovu. Text si smí
 * projekt přepsat v definici formuláře; když ho nemá, použije se obecný.
 *
 * DVA POVRCHY NA JEDNÉ TRASE (plán 2026-08-07, oddíl 3). Bez parametru je to
 * `form_thanks`, s parametrem `already` větev „už jste přihlášeni"
 * (`already_subscribed`). Rozlišit je musí odeslání formuláře, protože jen ono
 * ví, že adresa ve všech seznamech formuláře už potvrzená je; sama trasa to
 * zjistit nemůže a ani nesmí, viz `ALREADY_SUBSCRIBED_QUERY`.
 *
 * KONTAKT TU NENÍ ANI U JEDNOHO POVRCHU. Adresa se sem předává přesměrováním
 * 303 bez tokenu, takže o návštěvníkovi nevíme nic a předstírat to by znamenalo
 * udělat z děkovací stránky nástroj na zjišťování, kdo je v databázi.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const form = await loadPublicForm(slug);

  const scope = form === null ? null : await publicScope(form.workspaceId, 'contacts.public.form');
  const branding = scope?.branding ?? anonymousBranding();
  const t = await publicTranslator(branding.locale, 'contacts.public');
  const message = form === null ? '' : localizedText(form.successMessage, branding.locale);

  if (form !== null && scope !== null) {
    const alreadySubscribed =
      new URL(request.url).searchParams.get(ALREADY_SUBSCRIBED_QUERY) === '1';
    const designed = await renderDesignedPage(
      await loadPublicPageDesign({
        ctx: scope.ctx,
        surface: alreadySubscribed ? 'already_subscribed' : 'form_thanks',
        branding,
        formId: form.id,
        // Jen kvůli `{{ data.list_name }}`: překlad povrchu na šablonu seznam
        // u děkovací stránky nepoužívá, tu vlastní výhradně formulář. Bere se
        // první seznam formuláře, tedy tentýž, jehož pořadí rozhoduje i u
        // přesměrování „už jste přihlášeni".
        listId: form.listIds[0] ?? null,
        formName: form.name,
      }),
    );
    if (designed !== null) return designed;
  }

  return renderPublicPage(FormThanksPage({ t, message: message === '' ? null : message }), {
    branding,
    locale: branding.locale,
  });
}
