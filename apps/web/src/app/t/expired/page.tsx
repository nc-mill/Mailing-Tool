import Link from 'next/link';
import type { ReactElement } from 'react';

export const dynamic = 'force-static';

/**
 * Statická stránka bez parametrů. Nikdy nepřesměrovává dál,
 * jinak by z ní bylo přesně to otevřené přesměrování, kterému se vyhýbáme.
 *
 * ODCHYLKA OD PLÁNU: texty jsou zatím napevno česky, ne přes
 * `getTranslations('tracking.expired')`. Jmenný prostor `tracking` v katalogu
 * `packages/i18n` NEEXISTUJE a jeho registr `NAMESPACES` vlastní P05, tedy jiný
 * plán. Volání `getTranslations` by na chybějícím klíči vyhodilo výjimku (v dev
 * a v testech je chybějící klíč tvrdá chyba), takže by stránka nefungovala
 * vůbec. Jakmile katalog `tracking` vznikne, nahradí se tři řetězce voláním
 * překladače a nic jiného se měnit nemusí.
 *
 * Stránka leží mimo segment `[locale]` schválně: `/t/**` je veřejný povrch bez
 * jazykového prefixu, protože odkaz v e-mailu žádný jazyk nenese.
 */
export default function TrackingExpiredPage(): ReactElement {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-6 py-24 text-center">
      <h1 className="text-xl font-semibold">Odkaz už neplatí</h1>
      <p className="text-muted-foreground">
        Odkaz z e-mailu vypršel nebo byl poškozený. Zkuste otevřít původní zprávu znovu.
      </p>
      <Link href="/" className="underline">
        Přejít na úvodní stránku
      </Link>
    </main>
  );
}
