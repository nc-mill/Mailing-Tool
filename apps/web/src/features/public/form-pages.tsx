import {
  formFieldName,
  localizedText,
  parseConsentText,
  type FormField,
} from '@mlain/core/contacts';
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
 * Značka pole na typ vstupu HTML. `datetime` je `datetime-local`, protože `datetime`
 * jako typ vstupu prohlížeče dávno nepodporují; ostatní se jmenují stejně.
 */
function inputTypeFor(type: FormField['type']): string {
  if (type === 'datetime') return 'datetime-local';
  if (type === 'hidden') return 'hidden';
  return type;
}

/**
 * Hostovaná stránka formuláře. Používá se jako cíl rámečku a jako varianta
 * „Použiju hotovou stránku, zatím nemáme web".
 *
 * Je to obyčejný formulář: funguje bez JavaScriptu a odeslání vede na 303.
 *
 * NA ROZDÍL OD VKLÁDANÉHO FORMULÁŘE tahle stránka styly mít smí a má: je NAŠE,
 * běží na naší adrese a nikam na cizí web se nevkládá. Styly jsou NAŠE KONSTANTA
 * z `features/public/styles.ts`; sloupec `forms.custom_css` se sem NEDOSTANE ani
 * on, protože ho od migrace 0015 nečte nikdo. Vkládaný formulář nenese ani jedno
 * pravidlo, viz `features/public/embed-script.ts`.
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
          const id = `ml-${name}`;
          const placeholder =
            field.placeholder === undefined
              ? undefined
              : localizedText(field.placeholder, props.locale);

          return (
            <div key={name}>
              <label htmlFor={id}>{localizedText(field.label, props.locale)}</label>
              {/*
                Vykreslení se řídí značkou pole, ne jen tím, jestli je to e-mail.
                Hostovaná stránka a vkládaný formulář musí sbírat TOTÉŽ: kdyby se
                lišily, dala by se hodnota zadat na jedné straně a na druhé ne
                a rozdíl by se projevil až chybějícími daty.
              */}
              {field.type === 'textarea' ? (
                <textarea id={id} name={name} required={field.required} {...{ placeholder }} />
              ) : field.type === 'select' ? (
                <select id={id} name={name} required={field.required}>
                  {(field.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {localizedText(option.label, props.locale)}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={id}
                  type={inputTypeFor(field.type)}
                  name={name}
                  required={field.required}
                  {...{ placeholder }}
                />
              )}
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

        {/*
          Text souhlasu se skládá ze SEGMENTŮ, ne z hotového HTML. Autor formuláře
          smí vložit odkaz na obchodní podmínky, které leží na webu, kam je formulář
          vložený; cokoli jiného zůstane textem a React ho sám escapuje. Rozbor
          i zdůvodnění jsou v `forms/consent-markup.ts`.
        */}
        {props.consentText === null ? null : (
          <label htmlFor="ml-consent">
            <input
              id="ml-consent"
              type="checkbox"
              name="ml_consent"
              required={props.consentRequired}
            />{' '}
            {parseConsentText(props.consentText).map((segment, index) =>
              segment.kind === 'text' ? (
                <span key={index}>{segment.value}</span>
              ) : (
                <a
                  key={index}
                  href={segment.href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  {segment.text}
                </a>
              ),
            )}
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
