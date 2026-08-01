import { Link } from '@mlain/i18n/navigation';
import { ForbiddenState, NotFoundState } from '@mlain/ui/patterns/states';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { loadEditorData } from '@/features/editor/ports/server-ports';
import { requireUser } from '@/lib/identity/require-user';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';
import { EditorClient } from './editor-client';

/**
 * Identitu ani přístup si tenhle plán neřeší sám: `requireUser` a `getWorkspaceAccess`
 * dodává P06 a používá je každá obrazovka pod `/w/{slug}`. Vlastní varianta by se
 * s nimi rozešla v tom, co dělá nečlen, a to je bezpečnostní rozhodnutí, ne detail.
 */
export default async function TemplateEditorPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string; templateId: string }>;
}) {
  const { workspaceSlug, templateId } = await params;
  const t = await getTranslations('editor');

  // `NotFoundState` a `ForbiddenState` mají povinné `body` i `backLink`, respektive
  // `code` a `requestId`. Není to buzerace: stav bez vysvětlení a bez cesty pryč
  // je slepá ulička, a to je přesně ta obrazovka, na které uživatel odchází.
  const backLink = (
    <Link href={`/w/${workspaceSlug}/templates`} className="underline">
      {t('state.backToList')}
    </Link>
  );
  const notFoundState = (
    <NotFoundState title={t('state.notFound')} body={t('state.notFoundBody')} backLink={backLink} />
  );

  const me = await requireUser(`/w/${workspaceSlug}/templates/${templateId}`);
  if (!me.ok) return notFoundState;

  const access = await getWorkspaceAccess(workspaceSlug);
  // Nečlen dostane 404, ne 403: z 403 by šlo zjistit, které projekty existují.
  if (!access.ok) notFound();
  if (!hasPermission(access.data, 'templates:read')) {
    return (
      <ForbiddenState
        title={t('state.forbidden')}
        body={t('state.forbiddenBody')}
        whoCanHelp={t('state.forbiddenWhoCanHelp')}
        code="forbidden"
        // Prázdné schválně: tohle rozhodnutí padlo tady podle role, ne odpovědí
        // serveru, takže žádné číslo požadavku k němu neexistuje. Vymyslet ho
        // by znamenalo poslat podporu hledat něco, co v logu není.
        requestId=""
      />
    );
  }

  const data = await loadEditorData({ userId: me.data.user.id, workspaceSlug, templateId });
  if (!data) return notFoundState;

  return (
    <EditorClient
      templateId={templateId}
      document={data.document}
      designHash={data.designHash}
      fieldCatalog={data.fieldCatalog}
      // ODCHYLKA OD PLÁNU: oprávnění `templates:write_html` v registru P04
      // **není** (jsou tam jen `templates:read` a `templates:write`). Editor ho
      // nesmí zavést sám, protože registr oprávnění vlastní P04, takže se
      // vlastní HTML zatím řídí právem na zápis. Až oprávnění vznikne, je to
      // změna jediného řádku.
      canWriteHtml={hasPermission(access.data, 'templates:write')}
      readOnly={!hasPermission(access.data, 'templates:write')}
    />
  );
}
