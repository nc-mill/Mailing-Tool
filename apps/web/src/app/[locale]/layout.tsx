import { routing } from '@mlain/i18n/routing';
import { ThemeProvider } from '@mlain/ui/theme';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Jazyková vrstva aplikace. Katalog se načte na serveru a předá klientským
 * komponentám jednou pro celý strom, aby se ICU zprávy nepřenášely po kusech.
 *
 * `ThemeProvider` je tady schválně: režim zobrazení potřebuje skořápka
 * i každá obrazovka pod ní a mimo `[locale]` žádná stránka aplikace není.
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  return (
    <NextIntlClientProvider>
      <ThemeProvider>{children}</ThemeProvider>
    </NextIntlClientProvider>
  );
}
