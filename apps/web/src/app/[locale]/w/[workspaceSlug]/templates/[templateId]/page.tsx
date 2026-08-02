import { Link } from '@mlain/i18n/navigation';
import { ForbiddenState, NotFoundState } from '@mlain/ui/patterns/states';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getProvider } from '@mlain/core/ai';
import { AiAssistantPanel } from '@/features/ai/assistant-panel';
import { loadEditorData } from '@/features/editor/ports/server-ports';
import {
  aiWorkspaceContext,
  fetchBrandProfiles,
  fetchCredentials,
  fetchUsage,
} from '@/lib/ai/queries';
import { requireUser } from '@/lib/identity/require-user';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';
import { EditorClient } from './editor-client';

/**
 * Stránka závisí na přihlášeném uživateli, takže se NEPŘEDRENDEROVÁVÁ.
 *
 * Bez tohohle ji Next při `next build` vykreslí a spadne, protože v době
 * sestavení žádná relace neexistuje:
 *
 *   TypeError: Cannot read properties of null (reading 'useContext')
 *   Export encountered an error on <cesta>, exiting the build.
 *
 * Chyba nemíří na příčinu, takže se hledá v komponentách. Statická podoba
 * téhle stránky přitom neexistuje: obsah je pro každého jiný.
 */
export const dynamic = 'force-dynamic';

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

  /*
   * Podklady pro panel asistenta (P15, úkol 37). Čtou se týmiž funkcemi jako na
   * obrazovce nastavení, aby existoval jediný zdroj pravdy o tom, jestli
   * projekt má klíč. Panel bez klíče není chyba: vysvětlí, co je potřeba.
   */
  const aiCtx = await aiWorkspaceContext({ userId: me.data.user.id, workspaceSlug });
  const [credentials, brandProfiles, usage] = await Promise.all([
    fetchCredentials(aiCtx),
    fetchBrandProfiles(aiCtx),
    fetchUsage(aiCtx, 30),
  ]);
  const format = await getFormatter();
  const defaultBrand = brandProfiles.find((profile) => profile.defaultProfile) ?? brandProfiles[0];
  const defaultCredential =
    credentials.find((credential) => credential.default_credential) ?? credentials[0];
  const providerLabel =
    defaultCredential === undefined ? undefined : getProvider(defaultCredential.provider).label;
  const spendLabel =
    usage.estimatedCostUsd === null
      ? undefined
      : format.number(usage.estimatedCostUsd, { style: 'currency', currency: 'USD' });

  return (
    <EditorClient
      templateId={templateId}
      assistant={
        <AiAssistantPanel
          templateId={templateId}
          hasCredential={credentials.length > 0}
          brandName={defaultBrand?.name ?? null}
          {...(providerLabel === undefined ? {} : { providerLabel })}
          settingsHref={`/w/${workspaceSlug}/settings/ai`}
          {...(spendLabel === undefined ? {} : { spendLabel })}
        />
      }
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
