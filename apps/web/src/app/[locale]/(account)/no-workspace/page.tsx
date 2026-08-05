import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createWorkspaceAction } from '@/features/auth/actions';
import { NoWorkspacePanel } from '@/features/auth/no-workspace-panel';
import { AuthProblem } from '@/features/auth/action-problem';
import { requireUser } from '@/lib/identity/require-user';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('noWorkspace.title') };
}

/**
 * Uživatel, který mezitím pozvánku přijal, nemá na téhle obrazovce co dělat.
 * Přesměrování na první projekt je levnější než tlačítko „Zkontrolovat znovu",
 * které by musel zmáčknout.
 *
 * ODCHYLKA OD PLÁNU, vynucená skutečným tvarem cizího kódu: slug členství se
 * jmenuje `slug`, ne `workspace_slug`, viz kapitola 2.1 plánu a
 * `MembershipSchema` v P04.
 */
/**
 * Stránka se NEPŘEDRENDEROVÁVÁ, a je to vynucené, ne preference.
 *
 * Nemá dynamický segment, takže by ji Next při sestavení vykreslil jako
 * `/cs/no-workspace`. Při tom renderu se čte relace z cookie, kterou v době
 * stavby nemá kdo poslat; dřív se sahalo i na `getConfig()` a `next build`
 * kvůli tomu padal, protože stavba `SECRET_KEY` ani `DATABASE_URL` nezná
 * a znát nemá:
 *
 *   Error [ConfigError]: Konfigurace není platná, 3 problémů.
 *   Export encountered an error on /[locale]/(account)/no-workspace/page
 *
 * Tady `dynamic = 'force-dynamic'` POMÁHÁ, na rozdíl od route handlerů. U nich
 * řídí jen předrenderování, ne import modulu, takže tam byla ta samá direktiva
 * k ničemu a musely se skládat líně. U stránky je předrenderování přesně ten
 * problém, takže jeden řádek stačí.
 *
 * Věcně to sedí i bez ohledu na stavbu: obsah závisí na přihlášeném uživateli,
 * takže žádná statická podoba téhle stránky neexistuje.
 */
export const dynamic = 'force-dynamic';

export default async function NoWorkspacePage() {
  const me = await requireUser('/no-workspace');
  if (!me.ok) return <AuthProblem problem={me.problem} />;

  const first = me.data.memberships[0];
  if (first) redirect(`/w/${first.slug}`);

  /**
   * `SIGNUP_MODE` tady dřív rozhodoval o tom, jestli se projekt smí založit,
   * a bylo to špatně hned dvakrát.
   *
   * Věcně: podle 3.1 části 1 řídí `SIGNUP_MODE`, kdo si smí založit ÚČET
   * (`closed` = účty zakládá owner pozvánkou, `invite` = jen s tokenem,
   * `open` = veřejná registrace). Kdo tuhle obrazovku vidí, účet už má, takže
   * ta otázka je za ním. Výchozí hodnota je přitom `closed`, takže pozvaný
   * uživatel bez projektu viděl místo formuláře odkaz „Zkontrolovat znovu",
   * který ho vrátil na tutéž obrazovku. Slepá ulička na první přihlášení.
   *
   * Technicky: `POST /api/v1/workspaces` žádnou takovou podmínku nemá,
   * vyžaduje jen relaci (`workspaces.routes.ts`, odpovědi 401 a 422, žádná
   * 403) a zakladatele udělá ownerem. Kontrola v rozhraní tedy nic nechránila,
   * jen schovala tlačítko před tím, kdo na akci právo měl.
   *
   * `canCreate` v panelu ZŮSTÁVÁ. Až vznikne pravidlo, kdo smí zakládat
   * projekty, bude se vynucovat v API a rozhraní se podle něj zařídí.
   */
  return <NoWorkspacePanel action={createWorkspaceAction} canCreate />;
}
