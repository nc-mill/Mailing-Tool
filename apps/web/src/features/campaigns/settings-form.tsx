'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { PageHeader } from '@mlain/ui/components/page-header';
import { Users } from '@mlain/ui/icons';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { Alert, ReadOnlyBanner, ReadOnlyValue } from '@mlain/ui/patterns/states';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { SelectField } from '@/lib/forms/select-field';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import { SubmitButton } from '@/lib/forms/submit-button';
import { useFormErrorFocus } from '@/lib/forms/use-form-error-focus';
import { firstErrorField, type FieldErrors } from '@/lib/errors/field-errors';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { NO_SELECTION } from './no-selection';
import { unscheduleCampaignAction } from './actions';
import { SenderIdentityPicker, type SenderIdentityOption } from './sender-identity-picker';
import { encodeSenderIdentityFingerprints } from './sender-fingerprint';
import {
  unsubscribeFieldValue,
  unsubscribeScopeChanged,
  unsubscribeScopeFor,
  type UnsubscribeScope,
} from './unsubscribe-scope';
import { DeleteCampaignSection } from './delete-campaign-section';
import { CampaignBreadcrumbs } from './campaign-breadcrumbs';
import { CampaignStepNav } from './campaign-steps';
import {
  CAMPAIGN_STEPS,
  campaignStepHref,
  DEFAULT_CAMPAIGN_STEP,
  parseCampaignStep,
  STEP_PARAM,
  stepOfField,
  type CampaignStep,
} from './steps';

export type NamedOption = { id: string; name: string };

/** Stálá identita prázdných chyb, viz použití v `CampaignSettingsForm`. */
const NO_FIELD_ERRORS: FieldErrors = {};

export type CampaignSettings = {
  id: string;
  name: string;
  status: string;
  subject: string;
  preheader: string;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  template_id: string | null;
  provider_id: string | null;
  sender_domain_id: string | null;
  /**
   * Předvolba odesílatele, ze které se pět polí níž naposledy vyplnilo.
   * `null` znamená „vyplněno ručně", ne chybu: takhle vypadá každá kampaň,
   * kterou nikdo z uložené předvolby nesestavil.
   */
  sender_identity_id: string | null;
  unsubscribe_list_id: string | null;
  track_opens: boolean;
  track_clicks: boolean;
  /**
   * Má kampaň vlastní dokument? Chodí z odpovědi API jako `has_design`, samotný
   * dokument se neposílá. Podle toho se pozná, jestli se má převzetí knihovní
   * šablony ptát na přepis, nebo jestli není co přepsat.
   */
  has_design: boolean;
  /**
   * Je v tom dokumentu doopravdy něco? Dokument, ve kterém není nic než patička,
   * má `has_design` pravdivé a tohle nepravdivé. Přesně takový e-mail odešel
   * prázdný, takže krok obsahu to musí říct nahlas a nečekat na kontrolu před
   * odesláním.
   */
  has_content: boolean;
  include_lists: string[];
  include_segments: string[];
  exclude_lists: string[];
  exclude_segments: string[];
};

export type CampaignSettingsOptions = {
  lists: NamedOption[];
  segments: NamedOption[];
  templates: NamedOption[];
  providers: NamedOption[];
  domains: NamedOption[];
  /**
   * Uložené předvolby odesílatele. Prázdný seznam NENÍ chyba: je to stav prvních
   * minut instalace a rozbalovací seznam se v něm nahradí větou s cestou tam,
   * kde předvolby vznikají.
   */
  senderIdentities: SenderIdentityOption[];
};

export type CampaignSettingsFormProps = {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  workspaceId: string;
  campaign: CampaignSettings;
  options: CampaignSettingsOptions;
  /** Rozepsanou kampaň jde měnit celou, u ostatních stavů zápis odmítne API. */
  canEdit: boolean;
  basePath: string;
  initialState?: ActionState | undefined;
  /**
   * Krok, na kterém se obrazovka otevře. Bere se z adresy (`?step=`), aby
   * odkaz „Upravit nastavení" vedl rovnou tam, kam slibuje. Bez něj se
   * kampaň otevírá obsahem.
   */
  initialStep?: CampaignStep | undefined;
};

/**
 * Skupina zaškrtávátek pro jednu stranu publika.
 *
 * Prázdná skupina se NEVYNECHÁVÁ, ukáže větu s odkazem, kde seznam nebo segment
 * vzniká. Zmizelá skupina vypadá jako chybějící funkce, ne jako prázdný stav.
 */
function OptionGroup({
  legend,
  name,
  options,
  selected,
  emptyText,
  emptyHref,
  emptyAction,
  labelPrefix,
  onToggle,
}: {
  legend: string;
  name: string;
  options: readonly NamedOption[];
  selected: readonly string[];
  emptyText: string;
  emptyHref: string;
  emptyAction: string;
  /**
   * Předpona jména zaškrtávátka. Týž seznam je na obrazovce dvakrát, jednou
   * v publiku a jednou ve vynechání; bez ní by čtečka ohlásila dvě různá
   * zaškrtávátka stejně a nešlo by poznat, které z nich koho přidává.
   */
  labelPrefix?: string;
  /**
   * Ohlášení změny nahoru. Zaškrtávátka zůstávají NEŘÍZENÁ, hodnotu drží dál
   * DOM; tohle je jen ozvěna pro obrazovku, protože na výběru publika visí
   * rozsah odhlášení a ten se musí překreslit hned, ne až po uložení.
   * Skupiny vynechání ho nedostávají: na rozsah odhlášení nemají vliv.
   */
  onToggle?: (id: string, checked: boolean) => void;
}) {
  const chosen = new Set(selected);
  return (
    <fieldset className="min-w-0 flex-1">
      {/* Popisek skupiny je mono verzálky, stejně jako hlavička sloupce
          v tabulce: je to název skupiny údajů, ne věta. */}
      <legend className="meta-caps mb-[var(--spacing-hairline)] text-text-muted">{legend}</legend>
      {options.length === 0 ? (
        <p className="text-sm text-text-muted">
          {emptyText} <Link href={emptyHref}>{emptyAction}</Link>
        </p>
      ) : (
        <ul className="flex flex-col">
          {options.map((option) => (
            <li key={option.id}>
              <label className="flex min-h-[var(--size-target-min)] cursor-pointer items-center gap-[var(--spacing-inline)] text-ui text-text">
                <Checkbox
                  name={name}
                  value={option.id}
                  defaultChecked={chosen.has(option.id)}
                  {...(onToggle === undefined
                    ? {}
                    : { onCheckedChange: (next) => onToggle(option.id, next === true) })}
                />
                <span>
                  {labelPrefix === undefined ? option.name : `${labelPrefix} ${option.name}`}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

function withNoneOption(
  items: readonly NamedOption[],
  noneLabel: string,
): Array<{ value: string; label: string }> {
  return [
    { value: NO_SELECTION, label: noneLabel },
    ...items.map((item) => ({ value: item.id, label: item.name })),
  ];
}

/** `null` se do `SelectField` předat nedá, prázdno nese zástupná hodnota. */
function selected(value: string | null): string {
  return value ?? NO_SELECTION;
}

/**
 * Klíč rozbalovacího seznamu, odvozený z ULOŽENÉ hodnoty. Vypadá jako kosmetika,
 * není: bez něj mizí data.
 *
 * `SelectField` si hodnotu drží ve vlastním `useState` a bere ji z `defaultValue`
 * jenom při vzniku. Po úspěšné akci se komponenta vytvoří znovu ještě předtím,
 * než dorazí čerstvý payload serverové komponenty, takže se stav ustaví na starou
 * hodnotu a už se s novou nikdy nesrovná. Vybraná šablona proto skočí zpátky na
 * „Nevybráno", uživatel to vidí a uloží znovu, jenže druhé uložení pošle tu
 * zástupnou hodnotu a `template_id` v databázi se vynuluje.
 *
 * Naměřeno v prohlížeči: vyber šablonu, ulož, ulož znovu bez jediné změny;
 * `GET /campaigns/{id}` vrátil `template_id: null`. S klíčem drží hodnota
 * obě uložení. `router.refresh()` na to nestačil, protože stav vzniklé
 * komponenty už se podle nových propů nepřepočítá.
 */
function selectKey(prefix: string, value: string | null): string {
  return `${prefix}-${value ?? 'none'}`;
}

/**
 * Má formulář rozepsané hodnoty, které se ještě neuložily?
 *
 * Ptá se DOM, ne stavu komponenty, protože formulář je nekontrolovaný: hodnoty
 * drží prohlížeč. `defaultValue` a `defaultChecked` nesou to, co přišlo ze
 * serveru, takže rozdíl proti nim je přesně „uživatel něco změnil a neuložil".
 *
 * Je to jediná pojistka před odchodem na krok obsahu. Ten je na jiné adrese,
 * takže odchod formulář odmontuje i s tím, co do něj uživatel napsal; mezi
 * kroky 2 a 3 se nic takového dít nemůže, ty jsou dva panely téhož formuláře.
 */
function formDirty(form: HTMLFormElement | null): boolean {
  if (form === null) return false;
  return Array.from(form.elements).some((element) => {
    if (element instanceof HTMLInputElement) {
      if (element.type === 'hidden') return false;
      if (element.type === 'checkbox' || element.type === 'radio') {
        return element.checked !== element.defaultChecked;
      }
      return element.value !== element.defaultValue;
    }
    if (element instanceof HTMLTextAreaElement) return element.value !== element.defaultValue;
    return false;
  });
}

/**
 * Krok, který tenhle formulář umí ukázat. Krok obsahu je vlastní stránka
 * (editor), takže `?step=content` sem normálně nedorazí: detail kampaně ho
 * přesměruje. Kdyby přece, ukáže se předmět místo prázdné obrazovky, protože
 * obrazovka bez jediného viditelného panelu je vada, ne stav.
 */
function onThisScreen(step: CampaignStep): CampaignStep {
  return step === 'content' ? 'basics' : step;
}

function nameOf(items: readonly NamedOption[], id: string | null, fallback: string): string {
  if (id === null) return fallback;
  return items.find((item) => item.id === id)?.name ?? fallback;
}

/**
 * Rozsah odhlášení: buď věta o tom, co se stane, nebo volba.
 *
 * PROČ TO NENÍ POŘÁD ROZBALOVACÍ SEZNAM. Vada, kterou to léčí, zněla doslova:
 * „Nechápu funkci toho, pro co je Seznam pro odhlášení. Je to trochu matoucí
 * položka." Byla, a právem: u kampaně na jediný seznam se ptala na něco, co
 * z publika jednoznačně plyne, a špatná odpověď rozbíjela odhlašovací odkaz,
 * aniž by to kdokoli poznal. Pravidlo i jeho důvody jsou v `unsubscribe-scope.ts`.
 *
 * POLE NIKDY NEZMIZÍ, jen přestane být otázkou. Schovat ho úplně by bylo horší
 * ze dvou důvodů: uživatel by se nedozvěděl, co odhlašovací odkaz v jeho kampani
 * vlastně udělá, a hodnota by se přitom pořád ukládala. Právě tenhle rozpor,
 * kdy obrazovka mlčí a databáze si žije po svém, je vada, ne pohodlí. Odvozený
 * rozsah proto jede formulářem ve skrytém poli a nad ním je napsáno, co znamená.
 */
function UnsubscribeScopeField({
  scope,
  lists,
  storedId,
  fieldErrors,
}: {
  scope: UnsubscribeScope;
  lists: readonly NamedOption[];
  /** `campaign.unsubscribe_list_id`, tedy co je uloženo teď. */
  storedId: string | null;
  fieldErrors: FieldErrors;
}) {
  const t = useTranslations('campaigns.settings');
  const all = t('unsubscribeAll');

  if (scope.kind === 'choice') {
    return (
      <div data-testid="unsubscribe-choice">
        <SelectField
          key={selectKey('unsub', storedId)}
          name="unsubscribe_list_id"
          label={t('unsubscribeList')}
          placeholder={all}
          /*
           * DOPORUČENÁ VOLBA VYHRÁVÁ NAD ULOŽENOU HODNOTOU, a je to rozhodnutí
           * zadavatele, ne opomenutí. Do téhle větve se kampaň dostane teprve
           * tehdy, když v publiku PŘIBYL segment; do té chvíle se rozsah
           * odvozoval. Uložená hodnota tedy popisuje jiné publikum, než jaké
           * kampaň má teď, a předvyplnit ji znamená nabídnout odhlášení
           * z jednoho seznamu lidem, kteří na něm být nemusí. Ti by pak klikli
           * na „odhlásit" a nestalo by se nic.
           *
           * Prázdná hodnota znamená odhlášení ze všech rozesílek, což je pro
           * příjemce vždycky bezpečné. Kdo chce užší rozsah, vybere si ho
           * vědomě.
           *
           * Prop `defaultValue` se NEPŘEDÁVÁ VŮBEC, nepředává se `undefined`:
           * `exactOptionalPropertyTypes` v tomhle repozitáři rozlišuje „klíč
           * chybí" a „klíč je undefined" a druhé neprojde typovou kontrolou.
           */
          options={withNoneOption(lists, all)}
          hint={t('unsubscribeChoiceHint')}
          errors={fieldErrors}
        />
      </div>
    );
  }

  const listName = scope.kind === 'list' ? nameOf(lists, scope.listId, t('none')) : '';
  return (
    <div data-testid="unsubscribe-derived" className="flex flex-col gap-[var(--spacing-stack)]">
      {/*
        Odvozený rozsah je TLUMENÁ PLOCHA, ne pole: nedá se do něj psát, jen
        popisuje, co odhlašovací odkaz v téhle kampani udělá.

        Popisek NENÍ `aria-hidden` jako u `SelectField`. Tam ho nese přístupné
        jméno spouštěče, tady žádný ovládací prvek není, takže by ho čtečka
        vynechala a věta níž by visela bez toho, čeho se týká.
      */}
      <div className="flex flex-col gap-[var(--spacing-hairline)] rounded-[var(--radius-control)] bg-surface-muted px-[var(--spacing-stack)] py-[var(--spacing-stack)]">
        <span className="text-ui font-semibold text-text">{t('unsubscribeList')}</span>
        <input
          type="hidden"
          name="unsubscribe_list_id"
          value={unsubscribeFieldValue(scope)}
          readOnly
        />
        <p className="text-ui text-text">
          {scope.kind === 'list'
            ? t('unsubscribeFromList', { name: listName })
            : t('unsubscribeFromAll')}
        </p>
        <p className="text-meta text-text-muted">
          {scope.kind === 'list'
            ? t('unsubscribeSingleReason')
            : scope.reason === 'empty'
              ? t('unsubscribeEmptyReason')
              : t('unsubscribeManyReason')}
        </p>
      </div>
      {/*
        Tichá změna uložené hodnoty se NEDĚLÁ. Kdo si kdysi vybral konkrétní
        seznam a od té doby přidal do publika další, dostane po uložení jiný
        rozsah, než jaký si nastavil; dozvědět se to až z chování odkazu
        v odeslaném e-mailu je pozdě.
      */}
      {unsubscribeScopeChanged(scope, storedId) && (
        <Alert tone="info" data-testid="unsubscribe-changed">
          {t('unsubscribeChanged', { name: nameOf(lists, storedId, t('none')) })}
        </Alert>
      )}
    </div>
  );
}

/**
 * „Zrušit plán a upravit" u naplánované kampaně.
 *
 * `PATCH` u stavu `scheduled` pustí jen tři klíče plánu a na cokoli dalšího
 * vrátí 409 `campaign_locked`, takže tohle je jediná cesta zpátky k úpravám.
 * Bez ní by uzamčená obrazovka jen konstatovala, že to nejde.
 *
 * Neúspěch se NIKDY nespolkne: tlačítko, které po kliknutí nic neudělá a nic
 * neřekne, je horší než chybová hláška.
 */
function UnscheduleAction({
  workspaceId,
  campaignId,
}: {
  workspaceId: string;
  campaignId: string;
}) {
  const t = useTranslations('campaigns.settings');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      {failure !== null && (
        <Alert tone="error" data-testid="unschedule-failed">
          {t('unscheduleFailed')}
        </Alert>
      )}
      <div>
        <Button
          variant="secondary"
          data-testid="unschedule"
          pending={pending}
          pendingLabel={t('unscheduling')}
          onClick={() =>
            startTransition(async () => {
              const result = await unscheduleCampaignAction({ workspaceId, campaignId });
              if (result.status === 'success') {
                setFailure(null);
                router.refresh();
              } else {
                setFailure(result.code);
              }
            })
          }
        >
          {t('unschedule')}
        </Button>
      </div>
      <p className="text-sm text-text-muted">{t('unscheduleHint')}</p>
    </div>
  );
}

/**
 * Kampaň ve třech krocích: OBSAH E-MAILU, PŘEDMĚT A NÁZEV, NASTAVENÍ
 * A ODESLÁNÍ. Všechno, co kontrolní seznam na obrazovce odeslání vyžaduje,
 * se vyplní tady, jinak se kampaň nedá dokončit.
 *
 * Kroky jsou TRVALÁ STRUKTURA kampaně, ne průvodce na jedno použití. Přepínají
 * se přepínačem nad formulářem a chodí se mezi nimi tam a zpátky, kolikrát je
 * potřeba. Dřív krok 1 žil jen na `campaigns/new`, takže rozepsaná kampaň se
 * otevírala rovnou na nastavení a k obsahu už nevedla žádná cesta.
 *
 * POŘADÍ SE ŘÍDÍ PRACÍ UŽIVATELE. První je editor a obsah e-mailu, protože
 * kvůli němu kampaň vzniká; s ním jde ruku v ruce převzetí obsahu ze šablony
 * a uložení obsahu do knihovny. Předmět, název a předhlavička jsou popisky
 * hotového e-mailu, takže jsou druhé. Publikum, odesílatel a měření jsou
 * třetí, protože se řeší, až je co odeslat. Dřív byly kroky dva a ten první
 * schovával editor pod tři textová pole.
 *
 * JEDEN FORMULÁŘ, TŘI PANELY. Všechny kroky jsou uvnitř téhož `<form>`
 * a neaktivní panel se jen skryje, nezmizí z dokumentu. Proto přepnutí kroku
 * nezahodí, co uživatel rozepsal a neuložil, a proto jedno uložení pošle
 * všechno. Panel na jiné adrese ani odmontované záložky by tohle neuměly.
 *
 * Formulář je nativní `<form>` se serverovou akcí, ne řízené vstupy: hodnoty drží
 * DOM, ne stav komponenty, takže se odešle i bez JavaScriptu.
 */
export function CampaignSettingsForm({
  action,
  workspaceId,
  campaign,
  options,
  canEdit,
  basePath,
  initialState,
  initialStep,
}: CampaignSettingsFormProps) {
  const t = useTranslations('campaigns.settings');
  const tNew = useTranslations('campaigns.new');
  const confirmLabels = useConfirmDialogLabels();
  const router = useRouter();
  const [state, formAction] = useActionState(action, initialState ?? IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  /** Adresa kroku obsahu, na kterou se čeká na potvrzení odchodu bez uložení. */
  const [leavingTo, setLeavingTo] = useState<string | null>(null);
  // Prázdno je JEDEN sdílený objekt, ne `{}` při každém vykreslení. Nový objekt
  // by vypadal jako nová chyba a odvozování kroku níž by se zacyklilo.
  const fieldErrors = state.status === 'error' ? state.fieldErrors : NO_FIELD_ERRORS;

  /*
   * Krok drží ADRESA, ne jen paměť komponenty.
   *
   * Naměřeno v prohlížeči: po úspěšném uložení serverová akce zneplatní cestu,
   * strom se poskládá znovu a formulář při tom vznikne nanovo. Kdyby krok žil
   * jen v `useState`, spadl by uživatel z nastavení zpátky na obsah, přestože
   * nikam neklikl. Proto se při vzniku čte z adresy, kterou přepínač níž
   * udržuje srovnanou.
   *
   * Při hydrataci vrací obojí totéž: server vykresluje ze `searchParams` téhož
   * požadavku, takže se první vykreslení na klientovi neliší.
   */
  const [step, setStep] = useState<CampaignStep>(() => {
    const fallback = initialStep ?? DEFAULT_CAMPAIGN_STEP;
    if (typeof window === 'undefined') return onThisScreen(fallback);
    const fromUrl = new URLSearchParams(window.location.search).get(STEP_PARAM);
    return onThisScreen(fromUrl === null ? fallback : parseCampaignStep(fromUrl));
  });

  /*
   * Chyba pole si přepne krok NA SEBE, ještě než se obrazovka vykreslí.
   *
   * Uložení posílá oba kroky najednou, takže odpověď může vytknout pole, které
   * je zrovna ve skrytém panelu. Bez tohohle by uživatel zůstal stát u formuláře,
   * na kterém se nic nezměnilo, a nedozvěděl se, že se neuložilo.
   *
   * Přepíná se PŘI VYKRESLENÍ, ne v `useEffect`: fokus na první chybné pole
   * (`useFormErrorFocus` níž) běží až po vykreslení a na skryté pole zaskočit
   * nejde. Tenhle tvar je React vzor „úprava stavu podle nových propů".
   */
  const [errorsShown, setErrorsShown] = useState<FieldErrors>(fieldErrors);
  if (fieldErrors !== errorsShown) {
    setErrorsShown(fieldErrors);
    const field = firstErrorField(fieldErrors);
    if (field !== undefined) setStep(stepOfField(field));
  }

  /*
   * VÝBĚR PUBLIKA SE OZVĚNOU DRŽÍ I VE STAVU, přestože zaškrtávátka zůstávají
   * neřízená a hodnotu pořád nese DOM.
   *
   * Visí na něm rozsah odhlášení: podle toho, jestli je v publiku jeden seznam,
   * víc seznamů, nebo segment, se pole níž buď dopočítá, nebo se z něj stane
   * volba. Kdyby se to počítalo jen z propů, změnilo by se to až po uložení
   * a uživatel by mezitím četl větu, která pro jeho publikum neplatí.
   *
   * Ozvěna se srovnává s ULOŽENÝM publikem stejným vzorem jako `errorsShown`
   * níž, tedy úpravou stavu při vykreslení. `router.refresh()` po výběru
   * odesílatele přinese totéž publikum, takže rozdělaný výběr nepřepíše.
   */
  const savedAudience = `${campaign.include_lists.join(',')}|${campaign.include_segments.join(',')}`;
  const [audienceShown, setAudienceShown] = useState(savedAudience);
  const [include, setInclude] = useState<{ lists: string[]; segments: string[] }>(() => ({
    lists: campaign.include_lists,
    segments: campaign.include_segments,
  }));
  if (audienceShown !== savedAudience) {
    setAudienceShown(savedAudience);
    setInclude({ lists: campaign.include_lists, segments: campaign.include_segments });
  }

  /*
   * Ozvěna předmětu a předhlavičky pro náhled schránky. Týž vzor jako u publika
   * výš: pole zůstávají neřízená, tohle je jen kopie pro vykreslení. Uložená
   * hodnota ji přebije, aby náhled po uložení neukazoval starý text.
   */
  const savedInbox = `${campaign.subject}\n${campaign.preheader}`;
  const [inboxShown, setInboxShown] = useState(savedInbox);
  const [subjectShown, setSubjectShown] = useState(campaign.subject);
  const [preheaderShown, setPreheaderShown] = useState(campaign.preheader);
  if (inboxShown !== savedInbox) {
    setInboxShown(savedInbox);
    setSubjectShown(campaign.subject);
    setPreheaderShown(campaign.preheader);
  }

  function toggleInclude(key: 'lists' | 'segments', id: string, checked: boolean) {
    setInclude((current) => {
      const without = current[key].filter((value) => value !== id);
      return { ...current, [key]: checked ? [...without, id] : without };
    });
  }

  useFormErrorFocus(fieldErrors, formRef);

  /*
   * Krok se dopisuje do adresy, ale BEZ přechodu směrovače: `router.push` by
   * stránku vykreslil znovu, formulář by vznikl nanovo a neuložené hodnoty by
   * zmizely. `replaceState` adresu jen srovná, takže se dá poslat odkazem
   * a obnovení stránky ho udrží.
   *
   * U rozjeté kampaně se do adresy nepíše nic: kroky tam nejsou, takže by
   * `?step=` sliboval přepínač, který na obrazovce není.
   */
  useEffect(() => {
    if (!canEdit) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get(STEP_PARAM) === step) return;
    url.searchParams.set(STEP_PARAM, step);
    window.history.replaceState(window.history.state, '', url);
  }, [step, canEdit]);

  const [savedVisible, setSavedVisible] = useState(state.status === 'success');
  useEffect(() => {
    if (state.status !== 'success') return;
    setSavedVisible(true);
    const timer = window.setTimeout(() => setSavedVisible(false), 3000);
    return () => window.clearTimeout(timer);
  }, [state]);

  const sendHref = `${basePath}/campaigns/${campaign.id}/send`;
  const none = t('none');

  /*
   * Uzamčená kampaň se ukazuje JAKO TEXT, ne jako zašedlá pole (stav S12).
   * Zašedlý formulář svádí ke klikání a teprve odeslání by řeklo, že to nejde;
   * `PATCH` na kampaň mimo stav `draft` vrací 409 `campaign_locked`.
   *
   * Rozlišuje se JEDNA hodnota stavu, `scheduled`, protože jen u ní existuje
   * cesta zpátky k úpravám. Není to `switch` a nemá výčet: výčet stavů je
   * OTEVŘENÝ, takže cokoli neznámého projde touhle větví jako obyčejný zámek,
   * nikdy to obrazovku neshodí a nikdy se kvůli tomu nezahazuje odpověď.
   */
  if (!canEdit) {
    const scheduled = campaign.status === 'scheduled';
    return (
      <section aria-labelledby="campaign-settings-title" className="flex flex-col">
        <PageHeader
          title={<span id="campaign-settings-title">{campaign.name}</span>}
          eyebrow={t('title')}
          breadcrumbs={<CampaignBreadcrumbs basePath={basePath} campaignName={campaign.name} />}
        />
        <div className="flex flex-col gap-[var(--spacing-gutter)]">
          <ReadOnlyBanner reason={scheduled ? t('lockedScheduled') : t('locked')} />
          <Card gap="gutter">
            <ReadOnlyValue label={t('name')} value={campaign.name} />
            <ReadOnlyValue label={t('subject')} value={campaign.subject} />
            <ReadOnlyValue label={t('preheader')} value={campaign.preheader} />
            {/*
            Ukazuje se, JESTLI kampaň obsah má, ne jméno šablony. Obsah je
            vlastní dokument kampaně, takže jméno knihovní šablony by tu
            u zamčené kampaně buď chybělo, nebo lhalo o tom, odkud se vzal.
            Odeslanou podobu si uživatel prohlédne v reportu kampaně.
          */}
            {/*
            Tři stavy, ne dva. „Kampaň má vlastní obsah" se u dokumentu s pouhou
            patičkou četlo jako hotová práce, přestože v e-mailu nebylo nic.
          */}
            <ReadOnlyValue
              label={t('contentTitle')}
              value={
                campaign.has_content
                  ? t('content.present')
                  : campaign.has_design
                    ? t('content.empty')
                    : none
              }
            />
            <ReadOnlyValue
              label={t('provider')}
              value={nameOf(options.providers, campaign.provider_id, none)}
            />
          </Card>
          {scheduled ? (
            <UnscheduleAction workspaceId={workspaceId} campaignId={campaign.id} />
          ) : (
            <p>
              <Link href={`${basePath}/campaigns/${campaign.id}/progress`}>{t('toProgress')}</Link>
            </p>
          )}
          {/* I u zamčené kampaně se řekne, jak je to s mazáním. Bez toho by
            uživatel hledal mazání tam, kde není, a nedozvěděl se proč. */}
          <DeleteCampaignSection
            workspaceId={workspaceId}
            campaign={{ id: campaign.id, name: campaign.name, status: campaign.status }}
            basePath={basePath}
          />
        </div>
      </section>
    );
  }

  const stepIndex = CAMPAIGN_STEPS.indexOf(step);
  const nextStep = CAMPAIGN_STEPS[stepIndex + 1];

  /*
   * ODESÍLATEL: identita polí odvozená z ULOŽENÝCH hodnot.
   *
   * Výběr předvolby zapíše pět hodnot na server a překreslí stránku. Textová
   * pole jsou ale NEŘÍZENÁ, takže `router.refresh()` je nepřemountuje a to, co
   * do nich uživatel předtím napsal, by v nich zůstalo viset, přestože
   * v databázi už je něco jiného. Obrazovka by lhala přesně v okamžiku, kdy
   * uživatel čeká, že se pole vyplní sama.
   *
   * Společný klíč nad všemi pěti údaji je proti tomu poctivý: jakmile se
   * kterýkoli z nich na serveru změní, vzniknou pole znovu a ukazují to, co je
   * uložené. Cenou je, že výběr předvolby zahodí ručně rozepsaný text v polích
   * odesílatele. Je to VĚDOMÁ volba a rozbalovací seznam ji říká nahlas: tiše
   * uložit jinou hodnotu, než jakou má uživatel před očima, je horší.
   *
   * Je to týž vzor jako `selectKey` výš, jen nad víc hodnotami najednou: dvě
   * předvolby se můžou lišit jen doménou, takže klíč z jediného pole by změnu
   * nezachytil.
   */
  const senderKey = [
    campaign.sender_identity_id ?? 'manual',
    campaign.from_name,
    campaign.from_email,
    campaign.reply_to ?? '',
  ].join('\n');

  /*
   * Skrytý panel se schovává atributem `hidden` I třídou. Atribut sám nestačí:
   * `[hidden] { display: none }` má stejnou váhu jako utilita `flex`, která
   * stojí v šabloně stylů níž, takže by ji přebila a „skrytý" panel by byl
   * pořád vidět. Atribut přitom zůstává, protože právě on bere panel
   * z přístupnostního stromu a ze pořadí tabulátoru.
   *
   * Pole skrytého kroku se pořád ODESÍLAJÍ: `display: none` na odeslání
   * formuláře nemá vliv, a přesně to se tu chce. Jedno uložení uloží všechno.
   */
  function panel(visible: boolean, layout: string): string {
    return visible ? layout : 'hidden';
  }

  /** Krok 2 je jeden úzký sloupec, aby se řádky předmětu četly na jeden pohled. */
  const BASICS_LAYOUT = 'flex max-w-[820px] flex-col gap-[var(--spacing-gutter)]';
  /**
   * Krok 3 jsou dva sloupce. Karty jsou v nich naskládané ručně, ne mřížkou
   * přes všechny čtyři: mřížka řadí po řádcích, takže by vysoká karta publika
   * odsunula všechno vedle sebe a sloupce by se rozjely.
   */
  const SETTINGS_LAYOUT =
    'grid grid-cols-[repeat(auto-fit,minmax(380px,1fr))] items-start gap-[var(--spacing-gutter)]';
  const COLUMN = 'flex min-w-0 flex-col gap-[var(--spacing-gutter)]';

  /** Úvodní věta kroku. Každý krok má vlastní, jinak by lhala dvěma třetinám. */
  const intro = step === 'basics' ? t('steps.basicsIntro') : t('intro');

  /**
   * Výběr kroku z pásu.
   *
   * Kroky 2 a 3 jsou dva panely TOHOHLE formuláře, takže se jen přepnou a nic
   * se neztratí. Krok obsahu je EDITOR na jiné adrese: odchod formulář
   * odmontuje i s tím, co do něj uživatel napsal, takže se na to musí zeptat
   * předem. Ptá se jen tehdy, když opravdu je o co přijít.
   */
  function selectStep(next: CampaignStep) {
    if (next !== 'content') {
      setStep(next);
      return;
    }
    const href = campaignStepHref(basePath, campaign.id, next);
    if (formDirty(formRef.current)) setLeavingTo(href);
    else router.push(href);
  }

  return (
    /*
      Hlavička stojí MIMO mezerovaný sloupec, protože si spodní mezeru
      (`--spacing-section`) píše sama. Kdyby seděla uvnitř, sečetla by se
      s mezerou sloupce a odstup pod nadpisem by byl o 20 px větší.
    */
    <section aria-labelledby="campaign-settings-title" className="flex flex-col">
      {/*
        Kroky kampaně. Ohlašují se stejně jako při zakládání, protože je to
        pokračování téže práce, jen se k ní dá vrátit kdykoli.

        Ukazují se jen u kampaně, která se ještě dodělává. U rozjeté kampaně by
        věta o krocích lhala: nic se nezakládá, jen se prohlíží nastavení.

        Číslo kroku stojí NAD nadpisem, ne pod ním: pod nadpisem je v systému
        meta řádek s údaji o obsahu obrazovky, kdežto tohle je návěští toho,
        kde v kampani uživatel je.
      */}
      <PageHeader
        title={<span id="campaign-settings-title">{campaign.name}</span>}
        eyebrow={
          <span role="status" aria-live="polite">
            {tNew('stepOf', { current: stepIndex + 1, total: CAMPAIGN_STEPS.length })}
          </span>
        }
        breadcrumbs={<CampaignBreadcrumbs basePath={basePath} campaignName={campaign.name} />}
      />

      <div className="flex flex-col gap-[var(--spacing-gutter)]">
        <CampaignStepNav current={step} onSelect={selectStep} />

        {/*
        Potvrzení uložení. Živá oblast je na obrazovce POŘÁD, i když je prázdná:
        čtečka si ji tak drží od začátku a hlášku ohlásí, jakmile se objeví.
        Kdyby vznikala až s hláškou, část čteček by ji přeslechla.
      */}
        <div role="status" aria-live="polite" data-testid="settings-saved">
          {savedVisible ? <Alert tone="success">{t('saved')}</Alert> : null}
        </div>

        {/*
        STAV OBSAHU SE HLÁSÍ I TADY, přestože obsah se tvoří v kroku 1.
        Vzniklo z vady z instalace: kampaň, jejíž dokument neobsahoval nic než
        patičku, prošla celým zakládáním bez jediné poznámky a odešla na tři
        adresy. Kdo je v kroku 2 nebo 3, do editoru se nedívá, takže by se to
        dozvěděl až z kontroly před odesláním, nebo ze své schránky.

        Tři stavy, ne dva: „obsah vůbec nevznikl", „je rozepsaný v editoru, ale
        kampaň ho ještě nepřevzala" a „je prázdný". Každý má jinou radu.
      */}
        {campaign.template_id === null ? (
          <Alert tone="warning" data-testid="content-missing">
            {t('content.noContent')}
          </Alert>
        ) : !campaign.has_design ? (
          <Alert tone="info" data-testid="content-not-applied">
            {t('content.notApplied')}
          </Alert>
        ) : campaign.has_content ? null : (
          <Alert tone="warning" data-testid="content-empty">
            {t('content.empty')}
          </Alert>
        )}

        <p className="max-w-[90ch] text-meta text-text-muted">{intro}</p>

        {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
          <SettingsProblem problem={state.problem} />
        ) : null}

        <form
          ref={formRef}
          action={formAction}
          className="flex flex-col gap-[var(--spacing-gutter)]"
          noValidate
        >
          <input type="hidden" name="workspace_id" value={workspaceId} readOnly />
          <input type="hidden" name="campaign_id" value={campaign.id} readOnly />

          {/*
          KROK OBSAHU TADY NENÍ, a je to podstatná změna. Krok 1 je sám editor
          na vlastní adrese (`/campaigns/{id}/content`), ne panel formuláře
          s odkazem do editoru. Zůstává po něm jediná věc: skryté pole
          `has_design`, podle kterého se po uložení pozná, jestli má smysl
          kampaň zkompilovat.

          Rozbalovací seznam šablon tu nebyl už dřív a nevrací se: nabízel jen
          knihovní šablony, takže pracovní kopie kampaně mezi jeho položkami
          nikdy nebyla a první uložení nastavení by `template_id` vynulovalo.
          Převzít knihovní šablonu jde v kroku 1, výslovnou akcí s potvrzením.
        */}
          <input type="hidden" name="has_design" value={String(campaign.has_design)} />

          {/*
          Krok 2: popisky hotového e-mailu. Předmět stojí AŽ ZA obsahem
          schválně. Dřív byl první a převzetí obsahu z editoru na něm viselo:
          kdo se vrátil z editoru do kampaně bez vyplněného předmětu, dostal
          `campaign_subject_missing`, přestože se obsah uložil. Předmět je
          teď povinný až k odeslání, ne k psaní.
        */}
          <div
            data-testid="campaign-panel-basics"
            hidden={step !== 'basics'}
            className={panel(step === 'basics', BASICS_LAYOUT)}
          >
            <Card aria-labelledby="campaign-basics" gap="gutter">
              <CardTitle>
                <span id="campaign-basics">{t('basicsTitle')}</span>
              </CardTitle>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="subject">{t('subject')}</Label>
                <Input
                  id="subject"
                  name="subject"
                  defaultValue={campaign.subject}
                  onChange={(event) => setSubjectShown(event.target.value)}
                  {...fieldAria('subject', fieldErrors)}
                />
                <p className="text-meta text-text-muted">{t('subjectHint')}</p>
                <FieldError name="subject" errors={fieldErrors} />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="preheader">{t('preheader')}</Label>
                <Input
                  id="preheader"
                  name="preheader"
                  defaultValue={campaign.preheader}
                  onChange={(event) => setPreheaderShown(event.target.value)}
                  {...fieldAria('preheader', fieldErrors)}
                />
                <p className="text-meta text-text-muted">{t('preheaderHint')}</p>
                <FieldError name="preheader" errors={fieldErrors} />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">{t('name')}</Label>
                <Input
                  id="name"
                  name="name"
                  defaultValue={campaign.name}
                  {...fieldAria('name', fieldErrors)}
                />
                <p className="text-meta text-text-muted">{t('nameHint')}</p>
                <FieldError name="name" errors={fieldErrors} />
              </div>
            </Card>

            {/*
            Náhled schránky. Ukazuje TOTÉŽ, co uvidí příjemce, ještě než e-mail
            otevře: předmět, předhlavičku a odesílatele. Je to jediné místo,
            kde se dvě pole vedle sebe čtou tak, jak se čtou ve schránce.

            Pole zůstávají NEŘÍZENÁ, hodnotu dál drží DOM; stav níž je jen
            ozvěna pro náhled, takže se odeslání formuláře nedotkne.
          */}
            <Card tone="muted" padding="md" gap="none" className="gap-3">
              <span className="meta-caps text-text-muted">{t('inboxPreviewTitle')}</span>
              <div className="flex flex-col gap-1 rounded-[var(--radius-control)] border border-border bg-field px-[var(--spacing-stack)] py-[var(--spacing-stack)]">
                <span className="text-ui font-semibold text-text">
                  {subjectShown === '' ? t('inboxPreviewNoSubject') : subjectShown}
                </span>
                <span className="text-meta text-text-muted">
                  {preheaderShown === '' ? t('inboxPreviewNoPreheader') : preheaderShown}
                </span>
                <span className="font-mono text-label text-text-muted">
                  {[campaign.from_name, campaign.from_email]
                    .filter((part) => part !== '')
                    .join(' · ')}
                </span>
              </div>
              <p className="text-meta text-text-muted">
                {t('inboxPreviewLength', { count: subjectShown.length })}
              </p>
            </Card>
          </div>

          {/*
          Krok 3 stojí ve DVOU SLOUPCÍCH. Vlevo publikum a vynechání, tedy
          otázka „komu", vpravo odesílatel a měření, tedy „odkud a co změříme".
          Mřížka se skládá sama (`auto-fit`), takže na úzkém okně přejde do
          jednoho sloupce a pořadí zůstane čitelné.
        */}
          <div
            data-testid="campaign-panel-settings"
            hidden={step !== 'settings'}
            className={panel(step === 'settings', SETTINGS_LAYOUT)}
          >
            <div className={COLUMN}>
              <Card aria-labelledby="campaign-audience" gap="gutter">
                <div className="flex flex-col gap-[var(--spacing-hairline)]">
                  <CardTitle>
                    <span id="campaign-audience">{t('audienceTitle')}</span>
                  </CardTitle>
                  <p className="text-meta text-text-muted">{t('audienceHint')}</p>
                </div>

                {/* Chyba publika patří k celé skupině, ne k jedinému zaškrtávátku:
              stačí jedna položka z kterékoli strany, takže by u konkrétního
              řádku hlásila něco, co ten řádek sám nezpůsobil. */}
                <div
                  data-testid="audience-include"
                  className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-[var(--spacing-gutter)]"
                >
                  <OptionGroup
                    legend={t('includeLists')}
                    name="include_list"
                    options={options.lists}
                    selected={campaign.include_lists}
                    emptyText={t('noLists')}
                    emptyHref={`${basePath}/lists`}
                    emptyAction={t('noListsAction')}
                    onToggle={(id, checked) => toggleInclude('lists', id, checked)}
                  />
                  <OptionGroup
                    legend={t('includeSegments')}
                    name="include_segment"
                    options={options.segments}
                    selected={campaign.include_segments}
                    emptyText={t('noSegments')}
                    emptyHref={`${basePath}/segments`}
                    emptyAction={t('noSegmentsAction')}
                    onToggle={(id, checked) => toggleInclude('segments', id, checked)}
                  />
                </div>
                <FieldError name="audience" errors={fieldErrors} />

                {/* Shrnutí publika. Nula zdrojů není prázdný stav, ale vada
                kampaně, takže se o ní píše rovnou tady, ne až v kontrole. */}
                <p className="flex items-center gap-3 rounded-[var(--radius-control)] bg-surface-muted px-[var(--spacing-stack)] py-3 text-ui text-text">
                  <Users aria-hidden className="icon-md shrink-0 text-text-muted" />
                  {t('audienceSummary', { count: include.lists.length + include.segments.length })}
                </p>
              </Card>

              <Card aria-labelledby="campaign-exclude" gap="gutter">
                <div className="flex flex-col gap-[var(--spacing-hairline)]">
                  <CardTitle>
                    <span id="campaign-exclude">{t('excludeTitle')}</span>
                  </CardTitle>
                  <p className="text-meta text-text-muted">{t('excludeHint')}</p>
                </div>
                <div
                  data-testid="audience-exclude"
                  className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-[var(--spacing-gutter)]"
                >
                  <OptionGroup
                    legend={t('excludeLists')}
                    name="exclude_list"
                    options={options.lists}
                    selected={campaign.exclude_lists}
                    emptyText={t('noLists')}
                    emptyHref={`${basePath}/lists`}
                    emptyAction={t('noListsAction')}
                    labelPrefix={t('excludePrefix')}
                  />
                  <OptionGroup
                    legend={t('excludeSegments')}
                    name="exclude_segment"
                    options={options.segments}
                    selected={campaign.exclude_segments}
                    emptyText={t('noSegments')}
                    emptyHref={`${basePath}/segments`}
                    emptyAction={t('noSegmentsAction')}
                    labelPrefix={t('excludePrefix')}
                  />
                </div>
              </Card>

              {/*
            Mazání stojí ve sloupci pod publikem, tedy co nejdál od primárního
            tlačítka. Uvnitř formuláře být SMÍ: `Button` má `type="button"`,
            takže kliknutí formulář neodešle, a potvrzovací dialog se vykresluje
            do portálu mimo něj.

            Patří do posledního kroku, protože u rozepsaného e-mailu i u předmětu
            je to cizí, nebezpečná akce.
          */}
              <DeleteCampaignSection
                workspaceId={workspaceId}
                campaign={{ id: campaign.id, name: campaign.name, status: campaign.status }}
                basePath={basePath}
              />
            </div>

            <div className={COLUMN}>
              <Card aria-labelledby="campaign-sender" gap="gutter">
                <CardTitle>
                  <span id="campaign-sender">{t('senderTitle')}</span>
                </CardTitle>

                {/*
              Výběr uložené předvolby STOJÍ NAD POLI, ne pod nimi. Je to zkratka
              k jejich vyplnění, takže po ní uživatel sáhne dřív, než začne psát;
              pod poli by ji našel až ve chvíli, kdy je vypsal ručně.
            */}
                <SenderIdentityPicker
                  identities={options.senderIdentities}
                  workspaceId={workspaceId}
                  campaignId={campaign.id}
                  selectedId={campaign.sender_identity_id}
                  basePath={basePath}
                />

                {/*
              Odkaz na předvolbu jede s formulářem, aby se při uložení dal
              srovnat s tím, co je v polích. Sám o sobě nic neurčuje: serverová
              akce si odkaz odvodí z HODNOT (viz `sender-fingerprint.ts`), takže
              ručně přepsaná adresa poznámku „vzniklo z předvolby X" zruší
              a seznam poctivě spadne na „Vyplněno ručně".

              Otisky všech předvoleb jedou s tím: bez nich by akce musela do API
              pro seznam předvoleb při každém uložení nastavení.
            */}
                <input
                  type="hidden"
                  name="sender_identity_id"
                  value={campaign.sender_identity_id ?? ''}
                  readOnly
                />
                <input
                  type="hidden"
                  name="sender_identity_options"
                  value={encodeSenderIdentityFingerprints(options.senderIdentities)}
                  readOnly
                />

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="from_name">{t('fromName')}</Label>
                  <Input
                    key={`from-name-${senderKey}`}
                    id="from_name"
                    name="from_name"
                    defaultValue={campaign.from_name}
                    {...fieldAria('from_name', fieldErrors)}
                  />
                  <FieldError name="from_name" errors={fieldErrors} />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="from_email">{t('fromEmail')}</Label>
                  <Input
                    key={`from-email-${senderKey}`}
                    id="from_email"
                    name="from_email"
                    type="email"
                    defaultValue={campaign.from_email}
                    {...fieldAria('from_email', fieldErrors)}
                  />
                  <p className="text-meta text-text-muted">{t('fromEmailHint')}</p>
                  <FieldError name="from_email" errors={fieldErrors} />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reply_to">{t('replyTo')}</Label>
                  <Input
                    key={`reply-to-${senderKey}`}
                    id="reply_to"
                    name="reply_to"
                    type="email"
                    defaultValue={campaign.reply_to ?? ''}
                    {...fieldAria('reply_to', fieldErrors)}
                  />
                  <p className="text-meta text-text-muted">{t('replyToHint')}</p>
                  <FieldError name="reply_to" errors={fieldErrors} />
                </div>

                <SelectField
                  key={selectKey('provider', campaign.provider_id)}
                  name="provider_id"
                  label={t('provider')}
                  placeholder={none}
                  defaultValue={selected(campaign.provider_id)}
                  options={withNoneOption(options.providers, none)}
                  hint={t('providerHint')}
                  errors={fieldErrors}
                />

                <SelectField
                  key={selectKey('domain', campaign.sender_domain_id)}
                  name="sender_domain_id"
                  label={t('senderDomain')}
                  placeholder={none}
                  defaultValue={selected(campaign.sender_domain_id)}
                  options={withNoneOption(options.domains, none)}
                  hint={t('senderDomainHint')}
                  errors={fieldErrors}
                />

                <p className="text-sm">
                  <Link href={`${basePath}/settings/sending`}>
                    {options.providers.length === 0 ? t('sendingEmptyAction') : t('sendingManage')}
                  </Link>
                </p>
              </Card>

              <Card aria-labelledby="campaign-tracking" gap="gutter">
                <CardTitle>
                  <span id="campaign-tracking">{t('trackingTitle')}</span>
                </CardTitle>

                <UnsubscribeScopeField
                  scope={unsubscribeScopeFor(include)}
                  lists={options.lists}
                  storedId={campaign.unsubscribe_list_id}
                  fieldErrors={fieldErrors}
                />

                <div className="flex flex-col gap-[var(--spacing-hairline)]">
                  <label className="flex min-h-[var(--size-target-min)] cursor-pointer items-center gap-[var(--spacing-inline)] text-ui text-text">
                    <Checkbox name="track_opens" value="on" defaultChecked={campaign.track_opens} />
                    <span>{t('trackOpens')}</span>
                  </label>
                  <label className="flex min-h-[var(--size-target-min)] cursor-pointer items-center gap-[var(--spacing-inline)] text-ui text-text">
                    <Checkbox
                      name="track_clicks"
                      value="on"
                      defaultChecked={campaign.track_clicks}
                    />
                    <span>{t('trackClicks')}</span>
                  </label>
                </div>
                <p className="text-meta text-text-muted">{t('trackingHint')}</p>
              </Card>
            </div>
          </div>

          {/* Uložení stojí MIMO panely a je vidět ve všech krocích. Formulář je
            jeden, takže jedno kliknutí uloží obsah i nastavení; tlačítko jen
            v jednom kroku by svádělo k tomu, že se ostatní kroky neuložily. */}
          <div className="flex flex-wrap items-center gap-[var(--spacing-stack)]">
            <SubmitButton label={t('save')} pendingLabel={t('saving')} />
            {/*
            Cesta vpřed jedním kliknutím. Přepínač kroků nad formulářem je
            rozcestník, ne návod, kudy se pokračuje; bez tohohle tlačítka končí
            každý krok slepě u „Uložit" a uživatel musí uhodnout, že se má
            vrátit nahoru na záložku. Krok jen přepíná, NEUKLÁDÁ: `type="button"`
            drží formulář v klidu a neuložené hodnoty zůstávají v dokumentu.
          */}
            {nextStep === undefined ? null : (
              <Button
                type="button"
                variant="secondary"
                data-testid="step-next"
                onClick={() => setStep(nextStep)}
              >
                {t('nextStep', { step: t(`steps.${nextStep}`) })}
              </Button>
            )}
            {/* Odkaz na kontrolní seznam, ne tlačítko „odeslat": odeslat se dá až
              z obrazovky, která ukáže, komu a kolika lidem to půjde. Je vidět
              ve všech krocích, protože k odeslání se uživatel může rozhodnout
              kdykoli a kontrola před odesláním mu stejně řekne, co ještě chybí. */}
            <Link href={sendHref} data-testid="to-send">
              {t('toSend')}
            </Link>
          </div>
        </form>

        {/*
        Odchod do editoru s rozepsanými hodnotami. Ptá se jen tehdy, když
        opravdu je o co přijít; potvrzení u čistého formuláře by bylo klikání
        navíc, na které si uživatel zvykne odpovídat bez čtení.
      */}
        <ConfirmDialog
          open={leavingTo !== null}
          onOpenChange={(open) => {
            if (!open) setLeavingTo(null);
          }}
          // N2, ne N1: N1 se podle design systému neptá vůbec a rozepsaný text
          // se po odchodu vzít zpět nedá.
          level="N2"
          title={t('leaveTitle')}
          consequences={[t('leaveConsequence')]}
          confirmLabel={t('leaveSubmit')}
          cancelLabel={t('leaveCancel')}
          onConfirm={() => {
            const href = leavingTo;
            setLeavingTo(null);
            if (href !== null) router.push(href);
          }}
          labels={confirmLabels}
        />
      </div>
    </section>
  );
}
