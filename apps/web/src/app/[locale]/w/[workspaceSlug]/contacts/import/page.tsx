import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@mlain/i18n/navigation';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';
import { ForbiddenSection } from '@/features/settings/forbidden-section';
import { ImportWizard, type Step } from '@/features/import/import-wizard';

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

type PageProps = {
  params: Promise<{ locale: string; workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('import');
  return { title: t('wizard.title') };
}

const STEPS = ['upload', 'fileCheck', 'mapping', 'preview', 'options', 'progress'];

export default async function ImportPage({ params, searchParams }: PageProps) {
  const [{ locale, workspaceSlug }, query] = await Promise.all([params, searchParams]);

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    notFound();
  }
  const workspaceId = access.data.workspace.id;

  /**
   * Kdo nemá `contacts:import`, se to dozví TEĎ, ne až u uložení.
   *
   * Bez tohohle průvodce nastartoval komukoli, kdo si napsal adresu: prohlížející
   * prošel nahrání souboru, kontrolu, mapování sloupců i náhled a odmítnutí
   * dostal až od API v posledním kroku, po vyplnění celého průvodce.
   *
   * Vysvětlení, ne `notFound()`: 404 by tvrdila, že obrazovka neexistuje, a
   * uživatel by nevěděl, o co má požádat. Pravidlo 2 ze 7.2b části 6 chce, aby
   * akce byla vidět a vysvětlená; jen pro čtení tady být nemůže, protože celá
   * stránka JE akce a prázdný průvodce nemá co ukázat.
   */
  if (!hasPermission(access.data, 'contacts:import')) {
    return (
      <ForbiddenSection
        permission="contacts:import"
        currentRole={access.data.role}
        workspaceSlug={workspaceSlug}
      />
    );
  }

  const step =
    typeof query['step'] === 'string' && STEPS.includes(query['step']) ? query['step'] : 'upload';
  const importId = typeof query['import'] === 'string' ? query['import'] : null;

  const lists = await apiFetch<{
    data: { id: string; name: string; opt_in: 'single' | 'double'; is_default: boolean }[];
  }>('/api/v1/lists', { workspaceId });

  // Odkaz na vložení textem patří sem, ne dovnitř průvodce: kdo přišel importovat
  // deset adres z e-mailu, nemá kvůli nim vyrábět soubor, a bez téhle cesty by
  // se o druhé možnosti nedozvěděl. Odkaz vykresluje stránka, protože popisek je
  // v katalogu `contacts`, kdežto celý průvodce čte katalog `import`.
  const tContacts = await getTranslations('contacts');

  return (
    <>
      <p>
        <Link href={`/w/${workspaceSlug}/contacts/paste`}>{tContacts('paste.entry')}</Link>
      </p>
      <ImportWizard
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        locale={locale}
        importId={importId}
        initialStep={step as Step}
        greetingEnabled={access.data.workspace.greeting_enabled}
        lists={(lists.ok ? lists.data.data : []).map((list) => ({
          id: list.id,
          name: list.name,
          optIn: list.opt_in,
          // Výchozí seznam projektu je v průvodci předvybraný. Import bez seznamu
          // je legitimní, ale je to nejčastější způsob, jak si člověk nahraje
          // tisíc kontaktů, kterým pak nejde poslat kampaň.
          isDefault: list.is_default,
        }))}
      />
    </>
  );
}
