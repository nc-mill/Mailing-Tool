import { getTranslations } from 'next-intl/server';
import { Link } from '@mlain/i18n/navigation';
import { NotFoundScreen } from '@/features/shell/not-found-screen';

/**
 * 404 pro celou jazykovou větev aplikace.
 *
 * PROČ PRÁVĚ TADY, a ne níž: `notFound()` si najde nejbližší `not-found` NAD
 * sebou, takže tenhle soubor obslouží úplně všechno pod `[locale]` naráz,
 * včetně `w/[workspaceSlug]/…`. Kdyby stál až v projektové větvi, potřeboval
 * by ke svému vykreslení slug projektu, jenže 404 vzniká i tam, kde žádný
 * projekt není: neexistující adresa mimo projekt, `/settings/profile` s
 * překlepem, nebo `[locale]/layout.tsx`, který na neznámý jazyk volá
 * `notFound()` ještě dřív, než se o projektu vůbec ví.
 *
 * Odkaz zpět míří na kořen, ne na seznam něčeho: kořenová stránka je
 * rozcestník, který přihlášeného pošle do jeho prvního projektu. Ze 404 se
 * totiž nedá poznat, co uživatel hledal, takže konkrétnější nabídka by byla
 * jen tipování.
 */
export default async function LocaleNotFound() {
  const t = await getTranslations('common.notFoundPage');

  return (
    <NotFoundScreen
      backLink={
        <Link href="/" className="underline">
          {t('back')}
        </Link>
      }
    />
  );
}
