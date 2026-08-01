import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createWorkspaceAction } from '@/features/auth/actions';
import { NoWorkspacePanel } from '@/features/auth/no-workspace-panel';
import { AuthProblem } from '@/features/auth/action-problem';
import { requireUser } from '@/lib/identity/require-user';
import { getConfig } from '@/lib/runtime';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('noWorkspace.title') };
}

/**
 * Uživatel, který mezitím pozvánku přijal, nemá na téhle obrazovce co dělat.
 * Přesměrování na první projekt je levnější než tlačítko „Zkontrolovat znovu",
 * které by musel zmáčknout.
 *
 * DVĚ ODCHYLKY OD PLÁNU, obě vynucené skutečným tvarem cizího kódu:
 * 1. Konfigurace se čte přes `getConfig()` z `@/lib/runtime`. `@mlain/core/config`
 *    žádný singleton `config` nevydává, jen továrnu `loadConfig()`.
 * 2. Slug členství se jmenuje `slug`, ne `workspace_slug`, viz kapitola 2.1
 *    plánu a `MembershipSchema` v P04.
 */
export default async function NoWorkspacePage() {
  const me = await requireUser('/no-workspace');
  if (!me.ok) return <AuthProblem problem={me.problem} />;

  const first = me.data.memberships[0];
  if (first) redirect(`/w/${first.slug}`);

  return (
    <NoWorkspacePanel
      action={createWorkspaceAction}
      canCreate={getConfig().SIGNUP_MODE !== 'closed'}
    />
  );
}
