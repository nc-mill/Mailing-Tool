import type { PreferencesData } from '@mlain/core/contacts';
import type { ReactElement } from 'react';
import type { PublicTranslator } from './i18n';

/**
 * Stránka pro odkaz, který neplatí.
 *
 * Vykresluje se pro neplatný, poškozený, prošlý i cizí token, a to BAJTOVĚ STEJNĚ:
 * nebere žádný parametr kromě překladače, takže z ní není co odvodit. Kdyby se lišila,
 * dalo by se podle odpovědi zjišťovat, které kontakty a projekty existují.
 */
export function InvalidLinkPage({ t }: { t: PublicTranslator }): ReactElement {
  return (
    <>
      <h1>{t('invalidLink.title')}</h1>
      <p>{t('invalidLink.body')}</p>
    </>
  );
}

export type ConfirmPageProps = {
  t: PublicTranslator;
  action: string;
  listName: string;
  senderName: string;
  autoSubmit: boolean;
};

/**
 * Stránka potvrzení přihlášení. GET NIKDY nepotvrzuje, v žádném režimu.
 *
 * Rozhodnutí zadavatele: chceme variantu s jedním kliknutím, ale firemní bezpečnostní
 * skenery samy proklikávají odkazy v e-mailech, stejně jako Apple předstírá otevření.
 * Při potvrzení na GET by skener potvrdil přihlášení za příjemce a dvojí potvrzení
 * by ztratilo důkazní hodnotu, což je jediné, kvůli čemu existuje.
 *
 * Řešení: potvrzuje se POSTem. V režimu one_step ho odešle statický skript, takže
 * uživatel pořád klikne jednou. Bez JavaScriptu zůstane tlačítko.
 */
export function ConfirmPage(props: ConfirmPageProps): ReactElement {
  const { t } = props;
  return (
    <>
      <h1>{t('confirm.title', { list: props.listName })}</h1>
      <p>{t('confirm.body', { list: props.listName, sender: props.senderName })}</p>
      <form method="post" action={props.action} id="ml-confirm-form">
        <button type="submit">{t('confirm.button')}</button>
      </form>
      {props.autoSubmit ? (
        // Statický soubor, ne vložený kód: nese ho cache, projde přísnou politikou
        // obsahu a nikdy do něj nemůže proniknout hodnota z požadavku.
        <script src="/ml-autosubmit.js" defer />
      ) : (
        <p className="ml-muted">{t('confirm.twoStepExplainer')}</p>
      )}
    </>
  );
}

export function ConfirmExpiredPage({
  t,
  action,
}: {
  t: PublicTranslator;
  action: string;
}): ReactElement {
  return (
    <>
      <h1>{t('confirm.expiredTitle')}</h1>
      <p>{t('confirm.expiredBody')}</p>
      <form method="post" action={action}>
        <input type="hidden" name="action" value="resend" />
        <button type="submit">{t('confirm.resendButton')}</button>
      </form>
    </>
  );
}

export function ConfirmResultPage({
  t,
  view,
  listName,
}: {
  t: PublicTranslator;
  view: 'done' | 'already_used' | 'expired' | 'expired_resent';
  listName: string | null;
}): ReactElement {
  const list = listName ?? '';
  return (
    <>
      <h1>{t(`confirm.${view}Title`, { list })}</h1>
      <p>{t(`confirm.${view}Body`, { list })}</p>
    </>
  );
}

export type UnsubscribePageProps = {
  t: PublicTranslator;
  action: string;
  preferencesHref: string;
  senderName: string;
  listName: string | null;
  scoped: boolean;
  done: boolean;
};

/**
 * GET /u/{token} vykreslí stránku a NIC NEODHLÁSÍ. Odhlašuje až POST.
 *
 * Text se řídí ROZSAHEM: token se seznamem znamená odhlášení z jednoho seznamu
 * a stránka to musí říct, protože tvrdit „už vám nic nepřijde" by při odhlášení
 * z jednoho seznamu byla nepravda.
 */
export function UnsubscribePage(props: UnsubscribePageProps): ReactElement {
  const { t, scoped } = props;
  const list = props.listName ?? '';

  if (props.done) {
    return (
      <>
        <h1>{scoped ? t('unsubscribe.doneList', { list }) : t('unsubscribe.done')}</h1>
        {/*
          Jedna věta, která brání nejdražší možné reakci. Část 2 v 4.9.4 přiznává,
          že v okně mezi vyzvednutím dávky senderem a odesláním může odhlášenému
          člověku ještě odejít jedna zpráva. Bez vysvětlení to vypadá, že odhlášení
          nefunguje, a příjemce sáhne po tlačítku spam, což poškodí doručitelnost
          celého projektu.
        */}
        <p className="ml-muted">{t('unsubscribe.inFlightNotice')}</p>
        {scoped ? (
          <form method="post" action={props.action}>
            <input type="hidden" name="action" value="unsubscribe_all" />
            <button type="submit">{t('unsubscribe.global')}</button>
          </form>
        ) : null}
        <p>
          <a className="ml-button ml-button--secondary" href={props.preferencesHref}>
            {t('unsubscribe.preferencesLink')}
          </a>
        </p>
      </>
    );
  }

  return (
    <>
      <h1>{t('unsubscribe.confirmTitle', { sender: props.senderName })}</h1>
      <p>{scoped ? t('unsubscribe.listScope', { list }) : t('unsubscribe.globalScope')}</p>
      <form method="post" action={props.action}>
        <input
          type="hidden"
          name="action"
          value={scoped ? 'unsubscribe_list' : 'unsubscribe_all'}
        />
        <button type="submit">{t('unsubscribe.submit')}</button>
      </form>
      {scoped ? (
        <form method="post" action={props.action}>
          <input type="hidden" name="action" value="unsubscribe_all" />
          <button type="submit" className="ml-button ml-button--secondary">
            {t('unsubscribe.global')}
          </button>
        </form>
      ) : null}
      <p className="ml-muted">
        <a href={props.preferencesHref}>{t('unsubscribe.preferencesLink')}</a>
      </p>
    </>
  );
}

/**
 * Odpověď na one-click POST podle RFC 8058. Text se řídí ROZSAHEM stejně jako stránka:
 * po odhlášení z jednoho seznamu se nesmí tvrdit „už vám nic nepošleme", protože
 * ostatní e-maily chodí dál a příjemce by druhý z nich označil jako spam.
 */
export function OneClickDonePage({
  t,
  scoped,
  listName,
}: {
  t: PublicTranslator;
  scoped: boolean;
  listName: string | null;
}): ReactElement {
  return (
    <>
      <h1>
        {scoped ? t('unsubscribe.doneList', { list: listName ?? '' }) : t('unsubscribe.done')}
      </h1>
      <p className="ml-muted">{t('unsubscribe.inFlightNotice')}</p>
    </>
  );
}

/**
 * Reaktivace se potvrzuje POSTem, ne otevřením odkazu: reaktivační odkaz proklikávají
 * bezpečnostní skenery úplně stejně jako potvrzovací a souhlas z nich by byl nepravdivý.
 */
export function ReactivationPromptPage({
  t,
  action,
}: {
  t: PublicTranslator;
  action: string;
}): ReactElement {
  return (
    <>
      <h1>{t('reactivation.promptTitle')}</h1>
      <p>{t('reactivation.promptBody')}</p>
      <form method="post" action={action}>
        <button type="submit">{t('reactivation.button')}</button>
      </form>
    </>
  );
}

export function ReactivationDonePage({ t }: { t: PublicTranslator }): ReactElement {
  return (
    <>
      <h1>{t('reactivation.title')}</h1>
      <p>{t('reactivation.body')}</p>
    </>
  );
}

export type PreferencesPageProps = {
  t: PublicTranslator;
  action: string;
  data: PreferencesData;
  maskedEmail: string;
  formatDate: (value: Date) => string;
};

/**
 * Centrum předvoleb. Sedm bloků podle 4.9.5 části 2, všechny funkční bez JavaScriptu.
 *
 * Pořadí bloků není libovolné. „Posílat méně často" je nabídnuté PŘED odhlášením,
 * protože je to měkčí volba, kterou většina lidí uvítá, a projekt o kontakt nepřijde.
 * „Odhlásit ze všeho" je zároveň vidět bez rolování, protože kdo hledá odhlášení
 * a nenajde ho, klikne na spam.
 *
 * Adresa je maskovaná: odkaz bez expirace může najít kdokoliv.
 */
export function PreferencesPage(props: PreferencesPageProps): ReactElement {
  const { t, data } = props;
  return (
    <>
      {/* 1. Identita. */}
      <h1>{t('preferences.masked', { maskedEmail: props.maskedEmail })}</h1>

      {/* 2. Seznamy se stavem a datem přihlášení. */}
      <form method="post" action={props.action}>
        <input type="hidden" name="action" value="update_lists" />
        <fieldset>
          <legend>{t('preferences.lists')}</legend>
          {data.lists.map((list) => (
            <label key={list.id} htmlFor={`ml-list-${list.id}`}>
              <input
                id={`ml-list-${list.id}`}
                type="checkbox"
                name="list"
                value={list.id}
                defaultChecked={list.subscribed}
              />{' '}
              {list.name}{' '}
              {list.subscribedAt === null ? null : (
                <span className="ml-muted">
                  {t('preferences.since', { date: props.formatDate(list.subscribedAt) })}
                </span>
              )}
            </label>
          ))}
        </fieldset>
        <button type="submit">{t('preferences.save')}</button>
      </form>

      {/* 3. Frekvence. Nabídnuté PŘED odhlášením. */}
      <form method="post" action={props.action}>
        <input type="hidden" name="action" value="snooze" />
        <fieldset>
          <legend>{t('preferences.snoozeTitle')}</legend>
          <p className="ml-muted">{t('preferences.snoozeBody')}</p>
          {[30, 60, 90].map((days) => (
            <button
              key={days}
              type="submit"
              name="days"
              value={days}
              className="ml-button ml-button--secondary"
            >
              {t('preferences.snoozeDays', { days })}
            </button>
          ))}
        </fieldset>
      </form>

      {/* 4. Jazyk a 5. údaje podle článku 16. */}
      <form method="post" action={props.action}>
        <input type="hidden" name="action" value="update" />
        <label htmlFor="ml-locale">{t('preferences.language')}</label>
        <select id="ml-locale" name="locale" defaultValue={data.locale}>
          {data.availableLocales.map((locale) => (
            <option key={locale} value={locale}>
              {t(`preferences.locale.${locale}`)}
            </option>
          ))}
        </select>

        <label htmlFor="ml-first">{t('preferences.firstName')}</label>
        <input id="ml-first" type="text" name="first_name" defaultValue={data.firstName ?? ''} />
        <label htmlFor="ml-last">{t('preferences.lastName')}</label>
        <input id="ml-last" type="text" name="last_name" defaultValue={data.lastName ?? ''} />

        {/*
          Jen pole s příznakem subject_editable. Server hodnoty mimo tenhle seznam
          zahodí, i kdyby je někdo do těla dopsal ručně.
        */}
        {data.editableFields.map((field) => (
          <div key={field.key}>
            <label htmlFor={`ml-${field.key}`}>
              {field.label['cs'] ?? field.label['en'] ?? field.key}
            </label>
            <input
              id={`ml-${field.key}`}
              type="text"
              name={`attr_${field.key}`}
              defaultValue={field.value}
            />
          </div>
        ))}
        <button type="submit">{t('preferences.save')}</button>
      </form>

      {/* 6. Odhlásit ze všeho. */}
      <form method="post" action={props.action}>
        <input type="hidden" name="action" value="unsubscribe_all" />
        <button type="submit">{t('preferences.unsubscribeAll')}</button>
      </form>

      {/* 7. Moje data podle článků 15, 20 a 17. */}
      <form method="post" action={props.action}>
        <button
          type="submit"
          name="action"
          value="export_data"
          className="ml-button ml-button--secondary"
        >
          {t('preferences.exportData')}
        </button>{' '}
        <button
          type="submit"
          name="action"
          value="erase_data"
          className="ml-button ml-button--secondary"
        >
          {t('preferences.eraseData')}
        </button>
      </form>
    </>
  );
}

export function PreferencesDonePage({
  t,
  action,
}: {
  t: PublicTranslator;
  action: 'export_data' | 'erase_data';
}): ReactElement {
  return (
    <>
      <h1>{t(`preferences.${action}DoneTitle`)}</h1>
      <p>{t(`preferences.${action}DoneBody`)}</p>
    </>
  );
}
