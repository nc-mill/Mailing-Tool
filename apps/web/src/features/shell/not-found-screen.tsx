import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { NotFoundState } from '@mlain/ui/patterns/states';

/**
 * Obrazovka pro neexistující adresu.
 *
 * VADA, KTEROU TO OPRAVUJE: aplikace žádnou vlastní 404 neměla, takže každá
 * neplatná adresa vykreslila výchozí stránku Nextu („This page could not be
 * found"). Ta je černobílá, anglická bez ohledu na jazyk rozhraní a hlavně
 * nemá jedinou cestu pryč. Uživatel, kterému vypršel odkaz ze staré záložky,
 * z ní neměl jak odejít jinak než tlačítkem zpět v prohlížeči.
 *
 * `backLink` DODÁVÁ VOLAJÍCÍ, a je to schválně. Jazyková varianta (`[locale]`)
 * odkazuje přes `Link` z `@mlain/i18n/navigation`, který sám doplní jazykovou
 * předponu. Kořenová varianta žádný jazykový kontext nemá, protože se dostane
 * i na cesty, které jazyková vrstva vůbec nevidí, a musí si vystačit s prostým
 * `<a>`. Tvar obrazovky tím zůstává jeden, liší se jen odkaz.
 *
 * Stav se NEVYMÝŠLÍ znovu: `NotFoundState` je hotový stav S13 z návrhového
 * systému a používá ho i detail šablony a obsah kampaně.
 */
export async function NotFoundScreen({ backLink }: { backLink: ReactNode }) {
  const t = await getTranslations('common.notFoundPage');

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <main id="main" tabIndex={-1} className="w-full">
        <NotFoundState title={t('title')} body={t('body')} backLink={backLink} />
      </main>
    </div>
  );
}
