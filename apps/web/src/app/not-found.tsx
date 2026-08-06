import { getTranslations } from 'next-intl/server';
import { NotFoundScreen } from '@/features/shell/not-found-screen';

/**
 * Poslední záchyt pro adresy, které se do jazykové větve vůbec nedostanou.
 *
 * PROČ NESTAČÍ `[locale]/not-found.tsx`: proxy má matcher
 * `/((?!_next|favicon.ico|.*\\..*).*)`, takže cokoli s tečkou v poslední části
 * cesty (`/logo.png`, `/robots.txt`) jazykovou vrstvou NEPROJDE a předponu
 * `/cs` nedostane. Totéž platí pro veřejné předpony (`/api/…`, `/t/…`), které
 * si proxy propouští bez `intlMiddleware`. Takové adresy se nikdy netrefí do
 * segmentu `[locale]`, takže by na ně padla výchozí stránka Nextu, přesně ta,
 * kvůli které tahle dvojice souborů vznikla.
 *
 * Odkaz je PROSTÉ `<a>`, ne `Link` z `@mlain/i18n/navigation`. Sem se dojde
 * mimo jazykovou vrstvu, takže by neměl z čeho odvodit předponu; kořen `/`
 * si jazyk vyjedná sám a rozcestník pošle uživatele dál. Věty se přesto berou
 * z katalogu: `getRequestConfig` na neznámý jazyk padá na výchozí, takže
 * překlad je tu vždycky, jen se nemusí trefit do preference uživatele.
 */
export default async function RootNotFound() {
  const t = await getTranslations('common.notFoundPage');

  return (
    <NotFoundScreen
      backLink={
        <a href="/" className="underline">
          {t('back')}
        </a>
      }
    />
  );
}
