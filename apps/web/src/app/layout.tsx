import { getLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
// Vstupní styl celé aplikace. Načítá se v kořenovém layoutu, protože jinak
// se Tailwind ani tokeny z @mlain/ui do stránky nikdy nedostanou.
import './globals.css';

export const metadata = { title: 'Mlain Mailer' };

/**
 * `lang` SE BERE Z JAZYKA POŽADAVKU, ne z pevné hodnoty.
 *
 * Do 5. 8. 2026 tu stálo `lang="cs"` natvrdo, takže anglická stránka se
 * prohlašovala za českou: `GET /en/login` vrátil `<html lang="cs">`.
 * Naměřeno v běžící instalaci. Dopad není kosmetický:
 *
 *  - čtečka obrazovky přepne hlas podle `lang` a anglický text pak přečte
 *    českou výslovností, tedy nesrozumitelně,
 *  - vyhledávače podle `lang` určují jazyk stránky,
 *  - `features/reports/api-client.ts` z `<html lang>` odvozuje jazyk vět,
 *    které skládá server, takže by si vyžádal české věty na anglickou obrazovku.
 *
 * `<html>` musí zůstat v KOŘENOVÉM layoutu, jeden na dokument, takže se sem
 * jazyk nedá předat parametrem trasy `[locale]`: ten zná až vnořený layout.
 * `getLocale()` čte tentýž jazyk, jaký vyjednal proxy a jaký dostane
 * `NextIntlClientProvider`, takže se ty dvě hodnoty nemůžou rozejít.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
