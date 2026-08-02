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
/**
 * Stránka se NEPŘEDRENDEROVÁVÁ, a je to vynucené, ne preference.
 *
 * Nemá dynamický segment, takže by ji Next při sestavení vykreslil jako
 * `/cs/no-workspace`. Při tom renderu se sáhne na `getConfig()` a `next build`
 * spadne, protože stavba `SECRET_KEY` ani `DATABASE_URL` nezná a znát nemá:
 *
 *   Error [ConfigError]: Konfigurace není platná, 3 problémů.
 *   Export encountered an error on /[locale]/(account)/no-workspace/page
 *
 * Tady `dynamic = 'force-dynamic'` POMÁHÁ, na rozdíl od route handlerů. U nich
 * řídí jen předrenderování, ne import modulu, takže tam byla ta samá direktiva
 * k ničemu a musely se skládat líně. U stránky je předrenderování přesně ten
 * problém, takže jeden řádek stačí.
 *
 * Věcně to sedí i bez ohledu na stavbu: obsah závisí na přihlášeném uživateli
 * a na režimu registrace, takže žádná statická podoba téhle stránky neexistuje.
 */
export const dynamic = 'force-dynamic';

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
