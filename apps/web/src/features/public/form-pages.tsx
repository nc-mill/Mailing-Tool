import { formFieldName, localizedText, type FormField } from '@mlain/core/contacts';
import type { ReactElement } from 'react';
import type { PublicTranslator } from './i18n';

export type HostedFormProps = {
  t: PublicTranslator;
  name: string;
  action: string;
  nonce: string;
  fields: FormField[];
  honeypotField: string;
  consentText: string | null;
  consentRequired: boolean;
  locale: string;
};

/**
 * Hostovaná stránka formuláře. Používá se jako cíl rámečku a jako varianta
 * „Použiju hotovou stránku, zatím nemáme web".
 *
 * Je to obyčejný formulář: funguje bez JavaScriptu a odeslání vede na 303.
 */
export function HostedFormPage(props: HostedFormProps): ReactElement {
  const { t } = props;
  return (
    <>
      <h1>{props.name}</h1>
      <form method="post" action={props.action}>
        <input type="hidden" name="ml_nonce" value={props.nonce} />

        {props.fields.map((field) => {
          const name = formFieldName(field);
          return (
            <div key={name}>
              <label htmlFor={`ml-${name}`}>{localizedText(field.label, props.locale)}</label>
              <input
                id={`ml-${name}`}
                type={field.type === 'email' ? 'email' : 'text'}
                name={name}
                required={field.required}
                placeholder={
                  field.placeholder === undefined
                    ? undefined
                    : localizedText(field.placeholder, props.locale)
                }
              />
            </div>
          );
        })}

        {/*
          Honeypot. Skryté pole, které člověk nevidí a bot vyplní. Skrývá se posunutím
          mimo plátno spolu s aria-hidden a tabindex, ne přes display none: kombinace
          zajistí, že ho čtečka obrazovky ignoruje a klávesnice na něj nenajede,
          zatímco automat vyplňující všechna pole do něj zapíše.
        */}
        <div style={{ position: 'absolute', left: '-9999px' }} aria-hidden="true">
          <input type="text" name={props.honeypotField} tabIndex={-1} autoComplete="off" />
        </div>

        {props.consentText === null ? null : (
          <label htmlFor="ml-consent">
            <input
              id="ml-consent"
              type="checkbox"
              name="ml_consent"
              required={props.consentRequired}
            />{' '}
            {props.consentText}
          </label>
        )}

        <button type="submit">{t('form.submit')}</button>
      </form>
    </>
  );
}

export function FormThanksPage({
  t,
  message,
}: {
  t: PublicTranslator;
  message: string | null;
}): ReactElement {
  return (
    <>
      <h1>{t('form.thanksTitle')}</h1>
      <p>{message === null || message === '' ? t('form.thanksBody') : message}</p>
    </>
  );
}
