import { Link } from '@mlain/i18n/navigation';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { loadTemplateList } from '@/features/editor/ports/server-ports';
import { requireUser } from '@/lib/identity/require-user';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { CreateTemplateButton, TemplatesEmpty } from './create-template';

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

/** Minimální seznam šablon (rozhodnutí R16): bez něj se do editoru nedá prokliknout. */
export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const t = await getTranslations('editor');

  const me = await requireUser(`/w/${workspaceSlug}/templates`);
  if (!me.ok) notFound();
  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) notFound();

  const templates = await loadTemplateList({ userId: me.data.user.id, workspaceSlug });

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('list.title')}</h1>
        {templates.length > 0 ? (
          <CreateTemplateButton
            workspaceSlug={workspaceSlug}
            workspaceId={access.data.workspace.id}
          />
        ) : null}
      </div>
      {templates.length === 0 ? (
        <TemplatesEmpty workspaceSlug={workspaceSlug} workspaceId={access.data.workspace.id} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <li key={template.id} className="rounded-md border border-border p-3">
              <Link
                href={`/w/${workspaceSlug}/templates/${template.id}`}
                className="font-medium underline"
              >
                {template.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
