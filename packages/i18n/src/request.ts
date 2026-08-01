import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { formats } from './formats';
import { loadMessages } from './load-messages';
import { routing } from './routing';

/**
 * Chybějící klíč: v produkci se vypíše poslední segment klíče a zaloguje
 * se `i18n_missing_key`, v dev a v testech se vyhodí výjimka, takže
 * chybějící klíč spadne v CI (pravidlo 3.9 části 1).
 *
 * `timeZone` je tady jen výchozí hodnota instalace. Zónu přihlášeného
 * uživatele (`users.timezone`) nastavuje skořápka přes `NextIntlClientProvider`,
 * protože v tuhle chvíli ještě není načtená relace.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: await loadMessages(locale),
    formats,
    timeZone: process.env.DEFAULT_TIMEZONE ?? 'Europe/Prague',
    onError(error) {
      if (process.env.NODE_ENV === 'production') {
        console.error(JSON.stringify({ event: 'i18n_missing_key', message: error.message }));
        return;
      }
      throw error;
    },
    getMessageFallback({ key, namespace }) {
      if (process.env.NODE_ENV !== 'production') {
        throw new Error(`Chybí překladový klíč ${namespace ?? ''}.${key}`);
      }
      return key.split('.').pop() ?? key;
    },
  };
});
