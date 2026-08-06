'use client';

import { useActionState, useEffect, useId, useRef, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { PageHeader } from '@mlain/ui/components/page-header';
import { RadioGroup, RadioGroupItem } from '@mlain/ui/components/radio-group';
import { Tag } from '@mlain/ui/components/tag';
import { Textarea } from '@mlain/ui/components/textarea';
import { ChevronDown, ChevronRight, Mail, Save } from '@mlain/ui/icons';
import { Alert } from '@mlain/ui/patterns/states';
import { SelectField } from '@/lib/forms/select-field';
import type { FieldErrors } from '@/lib/errors/field-errors';
import { useFormErrorFocus } from '@/lib/forms/use-form-error-focus';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { formLevelErrors } from '@/lib/errors/field-errors';
import { ContactsProblem } from './contacts-problem';
import { previewGreetingAction, type GreetingPreview } from './edit-actions';

export type ContactFormField = {
  key: string;
  label: string;
  type:
    | 'text'
    | 'long_text'
    | 'number'
    | 'boolean'
    | 'date'
    | 'datetime'
    | 'enum'
    | 'multi_enum'
    | 'url'
    | 'email'
    | 'phone';
  value: string;
};

export type ContactFormValues = {
  id: string | null;
  email: string;
  first_name: string;
  last_name: string;
  title_prefix: string;
  title_suffix: string;
  gender: 'female' | 'male' | 'unknown';
  /** Oslovení uložené v databázi. U založení null, protože ještě žádné není. */
  greeting: string | null;
  greeting_locked: boolean;
  /** Stav kontaktu do meta řádku pod nadpisem. U založení chybí. */
  status?: string;
  /** Kdy kontakt vznikl. Taky jen do meta řádku. */
  created_at?: string | null;
  fields: ContactFormField[];
  /** Jména štítků projektu a příznak, jestli je kontakt má. */
  tags: { name: string; selected: boolean }[];
  /**
   * `double_opt_in` řídí, co se u zaškrtnutého seznamu doopravdy stane. Od
   * 5. 8. 2026 se u volby „nepotvrzený" na takovém seznamu POTVRZOVACÍ E-MAIL
   * SKUTEČNĚ POŠLE, takže to musí být vidět u zaškrtávátka, ne až v historii.
   */
  lists: {
    id: string;
    name: string;
    selected: boolean;
    double_opt_in: boolean;
    /**
     * Výchozí seznam projektu. Při zakládání je předem zaškrtnutý (rozhodnutí
     * zadavatele z 5. 8. 2026), takže u něj musí být vidět, PROČ je zaškrtnutý.
     * Bez toho vypadá předvyplněná volba jako volba uživatele a přehlédne se.
     */
    is_default?: boolean;
  }[];
};

export type ContactFormProps = {
  mode: 'create' | 'edit';
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  workspaceId: string;
  workspaceSlug: string;
  basePath: string;
  values: ContactFormValues;
  /**
   * Řeší projekt oslovení a 5. pád? Vypnuto skryje náhled „Jak ho oslovíme"
   * i požadavky, které ho počítají. Výchozí `true` je kvůli starším testům.
   */
  greetingEnabled?: boolean;
};

/**
 * Pole, která u založení nejsou vidět hned, ale až po rozbalení „Další údaje".
 *
 * Slouží k jedinému rozhodnutí: jestli se má schovaná část otevřít sama, protože
 * je v ní chyba. Bez toho by uživatel dostal hlášku „opravte formulář" a chybu by
 * neviděl, protože by byla schovaná.
 */
const ADVANCED_FIELDS = ['title_prefix', 'title_suffix', 'gender'] as const;

function hasAdvancedError(errors: FieldErrors): boolean {
  return Object.keys(errors).some(
    (key) =>
      (ADVANCED_FIELDS as readonly string[]).includes(key) ||
      // Vlastní pole chodí ze serveru jako `attributes.mesto`, tedy s tečkou.
      key.startsWith('attributes.'),
  );
}

/** Je ve schované části něco vyplněného? Pak nemá smysl ji před uživatelem zavírat. */
function hasAdvancedValue(values: ContactFormValues): boolean {
  return (
    values.title_prefix.trim() !== '' ||
    values.title_suffix.trim() !== '' ||
    values.gender !== 'unknown' ||
    values.fields.some((field) => field.value.trim() !== '')
  );
}

/**
 * Hlavní tlačítko formuláře. Je na obrazovce DVAKRÁT, v hlavičce i pod
 * formulářem, přesně jak to má návrh: formulář je dlouhý a k tlačítku by se
 * jinak muselo rolovat nahoru nebo dolů podle toho, kde uživatel skončil.
 *
 * Nepoužívá se sdílený `SubmitButton`, protože ten ikonu nenese a návrh ji
 * u ukládání má. Chování je jinak stejné: `disabled` nikdy (princip P5),
 * běh se hlásí přes `pending` a `pendingLabel`.
 */
function SaveButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" pending={pending} pendingLabel={pendingLabel}>
      <Save aria-hidden className="icon-md" />
      {label}
    </Button>
  );
}

/**
 * Formulář kontaktu. Jeden pro založení i pro úpravu, protože je to týž formulář:
 * liší se jedním polem (adresa) a jednou větou nad seznamy.
 *
 * ROZVRŽENÍ PODLE NÁVRHU: dva sloupce karet. Vlevo „Kdo to je" a „Údaje",
 * vpravo „Štítky" a „Seznamy". Při zúžení okna se sloupce zalomí pod sebe,
 * protože mřížka je `auto-fit` s minimem 360 px.
 *
 * CO STAČÍ VYPLNIT, MUSÍ BÝT VIDĚT NA PRVNÍ POHLED. Povinná je jediná věc, adresa,
 * ale dokud byl formulář jeden dlouhý sloupec polí, vypadal, že chce všechno. U založení
 * je proto nahoře adresa a jméno a zbytek (tituly, rod, oslovení, vlastní pole) je
 * v rozbalovací části. Nic se neodstranilo, jen schovalo, a schovaná pole zůstávají
 * v DOM, takže se odešlou i zavřená.
 *
 * U ÚPRAVY SE NIC NESCHOVÁVÁ. Tam se pole většinou už vyplněná jsou a hlavně se tam
 * chodí kvůli kontrole oslovení, takže by rozbalovátko přidávalo klik ke každé opravě.
 *
 * NÁHLED OSLOVENÍ JE HLAVNÍ VĚC NA TÉHLE OBRAZOVCE, ne ozdoba. Celý produkt stojí na
 * tom, že se česky oslovuje pátým pádem, a jestli z „Ondřej" vypadne „Ondřeji", se bez
 * náhledu pozná až v odeslané kampani. Počítá ho server, protože skloňování stojí na
 * slovníku, na přepisech projektu a na nastavení vykání, a nic z toho v prohlížeči není.
 * Proto je to jediná zvýrazněná karta na obrazovce.
 */
export function ContactForm({
  mode,
  action,
  workspaceId,
  workspaceSlug,
  basePath,
  values,
  greetingEnabled = true,
}: ContactFormProps) {
  const t = useTranslations('contacts');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const [state, formAction] = useActionState(action, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};
  useFormErrorFocus(fieldErrors, formRef);

  const [firstName, setFirstName] = useState(values.first_name);
  const [lastName, setLastName] = useState(values.last_name);
  const [titlePrefix, setTitlePrefix] = useState(values.title_prefix);
  const [gender, setGender] = useState(values.gender);
  const [preview, setPreview] = useState<GreetingPreview | null>(null);
  const [, startPreview] = useTransition();

  const advancedId = useId();
  /**
   * Rozbalovací část se skládá ze DVOU důvodů k otevření a každý má jinou váhu.
   *
   * Vyplněný obsah nastaví jen VÝCHOZÍ stav; uživatel ji smí zase zavřít. Chyba
   * naproti tomu otevírá NATVRDO, protože zavřít ji nad neopravenou chybou znamená
   * formulář, který se nedá odeslat a neřekne proč. Proto je to `||`, ne stav
   * měněný efektem: efekt by po zavření chybu opět neschoval jen náhodou, podle
   * toho, jestli se mezitím překreslilo.
   */
  const [advancedOpen, setAdvancedOpen] = useState(() => hasAdvancedValue(values));
  const advancedForced = hasAdvancedError(fieldErrors);
  const advancedVisible = advancedOpen || advancedForced;

  /**
   * Volba správce. Drží se ve stavu, ne jen v `defaultChecked`, protože na ní visí
   * i věta u seznamů: zaškrtnutí seznamu znamená u přihlášeného něco jiného než
   * u nepotvrzeného a uživatel to musí vidět dřív, než odešle.
   */
  const [subscription, setSubscription] = useState<'confirmed' | 'pending'>('confirmed');
  /*
   * Zaškrtnuté seznamy se drží ve stavu, ne v `defaultChecked`. Důvod není
   * úhlednost: bez toho se nedá poznat, že uživatel odškrtl všechno, a právě
   * to je stav, na který se musí upozornit („kontakt nebude v žádném seznamu").
   * U založení je zaškrtnutý VÝCHOZÍ seznam projektu, u úpravy ty, ve kterých
   * kontakt je.
   */
  const [checkedLists, setCheckedLists] = useState<Set<string>>(
    () => new Set(values.lists.filter((list) => list.selected).map((list) => list.id)),
  );

  /**
   * Seznamy, kvůli kterým po uložení ODEJDE potvrzovací e-mail. Počítá se ze
   * stavu obrazovky, ne z domněnky: musí být zaškrtnuté, mít dvojí potvrzení
   * a správce musí zvolit „nepotvrzený". Kterákoli z těch tří podmínek jinak
   * znamená přímý zápis bez jediné odeslané zprávy.
   */
  const willSendConfirmation = values.lists.filter(
    (list) => checkedLists.has(list.id) && list.double_opt_in && subscription === 'pending',
  );

  function toggleList(id: string, checked: boolean): void {
    setCheckedLists((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /**
   * Náhled se přepočítává se zpožděním 400 ms po posledním úhozu. Bez zpoždění by
   * každé písmeno bylo jeden požadavek na server; se zpožděním je jich za napsané
   * jméno jeden.
   */
  useEffect(() => {
    // Projekt, který oslovení neřeší, náhled nevykresluje, takže se ani nepočítá.
    // Bez téhle podmínky by formulář při každém úhozu volal server o data,
    // která nikdo neuvidí.
    if (!greetingEnabled) {
      setPreview(null);
      return;
    }
    if (firstName.trim() === '' && lastName.trim() === '') {
      setPreview(null);
      return;
    }
    const timer = window.setTimeout(() => {
      startPreview(async () => {
        setPreview(
          await previewGreetingAction({
            workspaceId,
            first_name: firstName.trim() === '' ? null : firstName.trim(),
            last_name: lastName.trim() === '' ? null : lastName.trim(),
            title_prefix: titlePrefix.trim() === '' ? null : titlePrefix.trim(),
            gender,
          }),
        );
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [firstName, lastName, titlePrefix, gender, workspaceId, greetingEnabled]);

  const formErrors = formLevelErrors(fieldErrors);

  /**
   * Chyba pole pro `Field`. Vrací prázdný objekt, ne `undefined`: projekt má
   * zapnuté `exactOptionalPropertyTypes`, takže se volitelná propa nepředává
   * s hodnotou `undefined`, ale vynechá se.
   */
  function errorProps(name: string): { error?: string } {
    const messages = fieldErrors[name];
    return messages && messages.length > 0 ? { error: messages.join(' ') } : {};
  }

  const detailHref = values.id === null ? basePath : `${basePath}/${values.id}`;
  const contactName = [values.first_name, values.last_name].filter((part) => part !== '').join(' ');

  /**
   * Meta řádek pod nadpisem: adresa, stav a den vzniku. Mono, protože jsou to
   * údaje, které se čtou po znacích. Skládá se jen z toho, co obrazovka
   * doopravdy má; u založení kontakt ještě neexistuje, takže meta řádek není.
   */
  const meta =
    mode === 'edit'
      ? [
          values.email,
          values.status === undefined ? null : t(`status.${values.status}`),
          values.created_at === undefined || values.created_at === null
            ? null
            : t('form.metaAdded', {
                date: format.dateTime(new Date(values.created_at), {
                  day: 'numeric',
                  month: 'numeric',
                  year: 'numeric',
                }),
              }),
        ]
          .filter((part): part is string => part !== null)
          .join(' · ')
      : null;

  /** Tituly, rod a náhled oslovení. U úpravy rovnou, u založení po rozbalení. */
  const identityAdvanced = (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-[var(--spacing-gutter)]">
        <Field
          label={t('form.titlePrefix')}
          hint={t('form.titlePrefixHint')}
          {...errorProps('title_prefix')}
        >
          <Input
            name="title_prefix"
            value={titlePrefix}
            onChange={(event) => setTitlePrefix(event.target.value)}
          />
        </Field>
        <Field label={t('form.titleSuffix')} {...errorProps('title_suffix')}>
          <Input name="title_suffix" defaultValue={values.title_suffix} />
        </Field>
      </div>

      <div className="flex flex-col gap-1.5">
        <SelectField
          name="gender"
          label={t('form.gender')}
          placeholder={t('detail.genderUnknown')}
          defaultValue={values.gender}
          options={[
            { value: 'female', label: t('detail.genderFemale') },
            { value: 'male', label: t('detail.genderMale') },
            { value: 'unknown', label: t('detail.genderUnknown') },
          ]}
          errors={fieldErrors}
          onSelected={(next) => setGender(next as ContactFormValues['gender'])}
        />
        {/* Nápověda u rodu mluví o skloňování oslovení, což v projektu bez oslovení
            neplatí. Samotné pole zůstává: rod je údaj o člověku, ne o 5. pádu.
            Píše se tady, ne propou `hint`, aby měla velikost nápovědy pod polem
            (13 px) stejně jako u ostatních polí formuláře. */}
        <p className="text-meta text-text-muted">
          {greetingEnabled ? t('form.genderHint') : t('form.genderHintPlain')}
        </p>
      </div>

      {/* JEDINÁ ZVÝRAZNĚNÁ KARTA NA OBRAZOVCE. Návrh jí dává žlutou plochu proto,
          že je to jediný údaj, kvůli kterému se sem chodí: co kontaktu doopravdy
          přijde v e-mailu. */}
      {greetingEnabled ? (
        <Card
          as="div"
          tone="highlight"
          padding="sm"
          gap="none"
          data-testid="greeting-preview"
          className="gap-[var(--spacing-hairline)]"
        >
          <span className="meta-caps text-warning-text">{t('form.greetingPreviewTitle')}</span>
          {preview === null ? (
            <p className="text-ui text-text">{t('form.greetingPreviewEmpty')}</p>
          ) : (
            <p className="text-h3 font-semibold tracking-[var(--tracking-heading)] text-text">
              {t('form.greetingPreviewValue', { greeting: preview.greeting })}
            </p>
          )}
          {values.greeting_locked ? (
            <p className="text-sm text-warning-text">{t('form.greetingLocked')}</p>
          ) : null}
          {/* Návrh má pod tvarem VŽDYCKY větu o tom, odkud se vzal. Jistý tvar se
              proto taky komentuje, ne jen ten nejistý: bez toho by karta u dobře
              skloněného jména vypadala, že se náhled nespočítal. */}
          {preview !== null && preview.vocative_confidence === 'high' ? (
            <p className="text-sm text-warning-text">{t('greeting.hint.derived')}</p>
          ) : null}
          {preview !== null && preview.vocative_confidence === 'low' ? (
            <p className="text-sm text-warning-text">{t('form.greetingUncertain')}</p>
          ) : null}
          {preview !== null && preview.gender === 'unknown' ? (
            <p className="text-sm text-warning-text">{t('form.greetingGenderUnknown')}</p>
          ) : null}
        </Card>
      ) : null}
    </>
  );

  /** Vlastní pole projektu. U úpravy vlastní karta „Údaje", u založení schovaná část. */
  const customFields =
    values.fields.length === 0
      ? null
      : values.fields.map((field) => (
          <div key={field.key} className="flex flex-col gap-1.5">
            {/* Typ jde na server ve skrytém poli, protože formulář posílá všechno
                jako text a JSONB si typ pamatuje. Kdyby se číslo uložilo jako "42",
                segment s podmínkou nad číslem by kontakt nenašel a nic by nespadlo. */}
            <input type="hidden" name={`attrtype:${field.key}`} value={field.type} readOnly />
            <Field label={field.label} {...errorProps(`attributes.${field.key}`)}>
              {field.type === 'long_text' ? (
                <Textarea name={`attr:${field.key}`} defaultValue={field.value} rows={4} />
              ) : (
                <Input
                  name={`attr:${field.key}`}
                  defaultValue={field.value}
                  {...(field.type === 'number' ? { inputMode: 'decimal' as const } : {})}
                />
              )}
            </Field>
          </div>
        ));

  const cancelLink = (
    <Link href={detailHref} className="text-ui">
      {t('form.cancel')}
    </Link>
  );

  const saveLabels = {
    label: mode === 'create' ? t('form.create') : t('form.save'),
    pendingLabel: t('form.saving'),
  };

  return (
    <form ref={formRef} action={formAction} noValidate>
      <input type="hidden" name="workspace_id" value={workspaceId} readOnly />
      <input type="hidden" name="workspace_slug" value={workspaceSlug} readOnly />
      {values.id ? <input type="hidden" name="contact_id" value={values.id} readOnly /> : null}

      <PageHeader
        title={mode === 'create' ? t('form.createTitle') : t('form.editTitle')}
        {...(meta === null ? {} : { meta })}
        breadcrumbs={
          <nav aria-label={tCommon('a11y.breadcrumbs')} className="flex items-center gap-2">
            <Link href={basePath} className="text-sm">
              {t('detail.back')}
            </Link>
            {mode === 'edit' ? (
              <>
                <ChevronRight aria-hidden className="icon-xs text-border-strong" />
                <Link href={detailHref} className="text-sm">
                  {contactName === '' ? values.email : contactName}
                </Link>
              </>
            ) : null}
            <ChevronRight aria-hidden className="icon-xs text-border-strong" />
            <span className="font-mono text-meta text-text-muted">
              {mode === 'create' ? t('form.breadcrumbNew') : t('form.breadcrumbEdit')}
            </span>
          </nav>
        }
        actions={
          <>
            {cancelLink}
            <SaveButton {...saveLabels} />
          </>
        }
      />

      <div className="flex flex-col gap-[var(--spacing-gutter)]">
        {state.status === 'error' && formErrors.length === 0 ? (
          <ContactsProblem problem={state.problem} />
        ) : null}
        {formErrors.length > 0 ? <Alert tone="error">{formErrors.join(' ')}</Alert> : null}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(360px,1fr))] items-start gap-[var(--spacing-gutter)]">
          <div className="grid gap-[var(--spacing-gutter)]">
            <Card gap="gutter">
              <CardTitle>{t('form.sectionIdentity')}</CardTitle>

              {mode === 'create' ? (
                <Field label={t('form.email')} hint={t('form.emailHint')} {...errorProps('email')}>
                  <Input name="email" type="email" autoComplete="off" defaultValue={values.email} />
                </Field>
              ) : (
                <>
                  {/* Adresa je klíč kontaktu a zápisem se nemění (pravidlo 1 ze 4.1.2 části 2).
                      Na obrazovce je vidět, ale jako hodnota, ne jako pole: měnit ji smí jen
                      samostatná akce, která umí přepočítat otisky a odhalit kolizi. */}
                  <input type="hidden" name="email" value={values.email} readOnly />
                  <div className="flex items-center gap-[var(--spacing-stack)] rounded-[var(--radius-control)] border border-border bg-surface-muted p-[var(--spacing-stack)]">
                    <div className="grid min-w-0 gap-0.5">
                      <span className="meta-caps text-text-muted">{t('form.email')}</span>
                      <span className="font-mono text-ui break-all text-text">{values.email}</span>
                    </div>
                    <Link
                      href={`${basePath}/${values.id}/email`}
                      className="ml-auto text-sm whitespace-nowrap"
                    >
                      {t('form.changeEmail')}
                    </Link>
                  </div>
                </>
              )}

              <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-[var(--spacing-gutter)]">
                <Field label={t('form.firstName')} {...errorProps('first_name')}>
                  <Input
                    name="first_name"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                  />
                </Field>
                <Field label={t('form.lastName')} {...errorProps('last_name')}>
                  <Input
                    name="last_name"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                  />
                </Field>
              </div>

              {mode === 'edit' ? identityAdvanced : null}

              {mode === 'create' ? (
                <div className="flex flex-col gap-[var(--spacing-stack)]">
                  {/* Rozbalovátko, ne odkaz na druhou obrazovku: schovaná pole zůstávají
                      v DOM a odešlou se i zavřená, takže rozbalení nic neztratí ani nepřidá. */}
                  <button
                    type="button"
                    aria-expanded={advancedVisible}
                    aria-controls={advancedId}
                    onClick={() => setAdvancedOpen(!advancedVisible)}
                    className="flex min-h-[var(--size-control-sm)] items-center gap-[var(--spacing-inline)] self-start text-left text-ui font-semibold text-text"
                  >
                    <ChevronDown
                      aria-hidden
                      className={`icon-sm text-text-muted transition-transform duration-[var(--duration-normal)] ${
                        advancedVisible ? '' : '-rotate-90'
                      }`}
                    />
                    {t('form.moreDetails')}
                  </button>
                  <p className="text-meta text-text-muted">
                    {greetingEnabled ? t('form.moreDetailsHint') : t('form.moreDetailsHintPlain')}
                  </p>
                  <div
                    id={advancedId}
                    hidden={!advancedVisible}
                    className="flex flex-col gap-[var(--spacing-gutter)]"
                  >
                    {identityAdvanced}
                    {customFields}
                  </div>
                </div>
              ) : null}
            </Card>

            {mode === 'edit' && customFields !== null ? (
              <Card gap="gutter">
                <CardTitle>{t('detail.sectionData')}</CardTitle>
                {customFields}
              </Card>
            ) : null}

            {mode === 'create' ? (
              <Card gap="gutter">
                <CardTitle>{t('form.subscriptionTitle')}</CardTitle>
                {/* Volba správce, ne otázka na kontakt. Adresu odněkud má a je to on,
                    kdo za tvrzení o souhlasu ručí; nástroj mu ho nemá co vyvracet.
                    Výchozí je proto přihlášený. */}
                <RadioGroup
                  name="subscription"
                  value={subscription}
                  className="gap-[var(--spacing-stack)]"
                  onValueChange={(next: string) => setSubscription(next as 'confirmed' | 'pending')}
                >
                  {(['confirmed', 'pending'] as const).map((option) => (
                    <div key={option} className="flex items-start gap-3">
                      <RadioGroupItem
                        value={option}
                        id={`subscription-${option}`}
                        aria-labelledby={`subscription-label-${option}`}
                        className="mt-1"
                      />
                      <div className="flex flex-col gap-1.5">
                        <label
                          id={`subscription-label-${option}`}
                          htmlFor={`subscription-${option}`}
                          className="text-ui font-semibold text-text"
                        >
                          {option === 'confirmed'
                            ? t('form.subscriptionConfirmed')
                            : t('form.subscriptionPending')}
                        </label>
                        {/* Jedna věta o tom, co to znamená pro odesílání. Ne poučování
                            o právu: uživatel potřebuje vědět, jestli mu ten člověk přijde
                            do kampaně, nebo ne. */}
                        <span className="text-meta text-text-muted">
                          {option === 'confirmed'
                            ? t('form.subscriptionConfirmedHint')
                            : t('form.subscriptionPendingHint')}
                        </span>
                      </div>
                    </div>
                  ))}
                </RadioGroup>
              </Card>
            ) : null}
          </div>

          <div className="grid gap-[var(--spacing-gutter)]">
            <Card>
              <CardTitle>{t('detail.tags')}</CardTitle>
              {values.tags.length === 0 ? (
                <p className="text-sm text-text-muted">{t('form.noTagsYet')}</p>
              ) : (
                <ul className="grid gap-1">
                  {values.tags.map((tag) => (
                    <li key={tag.name}>
                      <label className="flex min-h-[var(--size-target-min)] cursor-pointer items-center gap-[var(--spacing-inline)] text-ui text-text">
                        <Checkbox name="tag" value={tag.name} defaultChecked={tag.selected} />
                        <span>{tag.name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <Field label={t('form.newTags')} hint={t('form.newTagsHint')}>
                <Input name="new_tags" placeholder={t('form.newTagsPlaceholder')} />
              </Field>
            </Card>

            <Card>
              <CardTitle>{t('detail.lists')}</CardTitle>
              <p className="text-sm text-text-muted">
                {mode === 'edit'
                  ? t('form.listsHintEdit')
                  : subscription === 'confirmed'
                    ? t('form.listsHintCreateConfirmed')
                    : t('form.listsHintCreatePending')}
              </p>
              {values.lists.length === 0 ? (
                <p className="text-sm text-text-muted">{t('detail.noLists')}</p>
              ) : (
                <ul className="grid gap-1">
                  {values.lists.map((list) => (
                    <li key={list.id}>
                      <label className="flex min-h-[var(--size-target-min)] cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-ui text-text">
                        <Checkbox
                          name="list"
                          value={list.id}
                          checked={checkedLists.has(list.id)}
                          onCheckedChange={(next: boolean | 'indeterminate') =>
                            toggleList(list.id, next === true)
                          }
                        />
                        <span>{list.name}</span>
                        {/* Dvojí potvrzení je vlastnost SEZNAMU, ne kontaktu, a rozhoduje
                            o tom, jestli po uložení odejde potvrzovací e-mail. Bez tohohle
                            štítku by se to uživatel dozvěděl až z doručené pošty příjemce. */}
                        {list.double_opt_in ? (
                          <Tag tone="neutral" className="gap-1.5">
                            <Mail aria-hidden className="icon-xs" />
                            {t('form.listDoubleOptIn')}
                          </Tag>
                        ) : null}
                        {/* PŘEDVYPLNĚNÁ VOLBA SE PŘIZNÁ. Výchozí seznam je při zakládání
                            zaškrtnutý za uživatele, takže u něj musí stát, kdo ho zaškrtl
                            a proč. Dva lidé nezávisle na sobě přehlédli, že tím někoho
                            přihlašují do seznamu, o kterém nevěděli. */}
                        {mode === 'create' && list.is_default ? (
                          <Tag tone="accent">{t('form.listDefault')}</Tag>
                        ) : null}
                      </label>
                      {/* Stav při vykreslení. Bez něj by akce nepoznala rozdíl mezi
                          „uživatel seznam odškrtl" a „nikdy zaškrtnutý nebyl", a odhlašovala
                          by kontakt ze seznamů, ve kterých nikdy nebyl. */}
                      {list.selected ? (
                        <input type="hidden" name="list_before" value={list.id} readOnly />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {/*
                ODCHOZÍ E-MAIL SE OHLÁSÍ DŘÍV, NEŽ ODEJDE, a jmenovitě.

                Věta nad zaškrtávátky mluví obecně („u seznamů s dvojím potvrzením"),
                takže z ní nikdo nevyčte, jestli se to týká právě téhle situace.
                Tahle hláška se ukáže jen tehdy, když po uložení opravdu odejde
                zpráva, a vyjmenuje seznamy, kvůli kterým odejde.

                Ověřeno v `repo/contacts-api.ts`: při zakládání jde přes
                `subscribeToList` (a tedy přes potvrzovací e-mail) jedině
                zaškrtnutý seznam s dvojím potvrzením při volbě „nepotvrzený".
                Volba „přihlášený" i seznam s jedním krokem se zapisují přímo,
                takže z nich neodejde nic.
              */}
              {mode === 'create' && willSendConfirmation.length > 0 ? (
                <Alert tone="warning" data-testid="confirmation-email-warning">
                  {t('form.listsWillSendConfirmation', {
                    lists: willSendConfirmation.map((list) => list.name).join(', '),
                  })}
                </Alert>
              ) : null}
              {/* Kontakt mimo seznamy je legitimní stav, ne chyba, ale musí být vidět,
                  co z něj plyne. Bez seznamu se do publika kampaně nedostane a nikde
                  jinde se to nedozví. */}
              {values.lists.length > 0 && checkedLists.size === 0 ? (
                <Alert tone="warning" data-testid="no-list-warning">
                  {t('form.listsNoneSelected')}
                </Alert>
              ) : null}
            </Card>
          </div>
        </div>

        <div className="mt-[var(--spacing-hairline)] flex flex-wrap items-center gap-[var(--spacing-stack)]">
          <SaveButton {...saveLabels} />
          {cancelLink}
        </div>
      </div>
    </form>
  );
}
