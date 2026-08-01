import { Link } from '@mlain/i18n/navigation';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { loadTemplateList } from '@/features/editor/ports/server-ports';
import { requireUser } from '@/lib/identity/require-user';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { CreateTemplateButton, TemplatesEmpty } from './create-template';

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
        {templates.length > 0 ? <CreateTemplateButton workspaceSlug={workspaceSlug} /> : null}
      </div>
      {templates.length === 0 ? (
        <TemplatesEmpty workspaceSlug={workspaceSlug} />
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
