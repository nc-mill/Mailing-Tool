import createNextIntlPlugin from 'next-intl/plugin';

/**
 * Obal nad pluginem, aby `apps/web` nemusel mít `next-intl` jako přímou
 * závislost. Cesta ukazuje na tenký soubor v aplikaci, který jen
 * re-exportuje konfiguraci z tohohle balíčku.
 */
export const withMlainIntl = createNextIntlPlugin('./src/i18n/request.ts');
