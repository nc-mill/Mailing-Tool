'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { Alert, ReadOnlyBanner, ReadOnlyValue } from '@mlain/ui/patterns/states';
import { SelectField } from '@/lib/forms/select-field';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import { SubmitButton } from '@/lib/forms/submit-button';
import { useFormErrorFocus } from '@/lib/forms/use-form-error-focus';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { NO_SELECTION } from './no-selection';
import { unscheduleCampaignAction } from './actions';

export type NamedOption = { id: string; name: string };

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
  unsubscribe_list_id: string | null;
  track_opens: boolean;
  track_clicks: boolean;
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
}) {
  const chosen = new Set(selected);
  return (
    <fieldset className="min-w-0 flex-1">
      <legend className="mb-2 text-sm font-medium text-text">{legend}</legend>
      {options.length === 0 ? (
        <p className="text-sm text-text-muted">
          {emptyText}{' '}
          <Link href={emptyHref} className="underline">
            {emptyAction}
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {options.map((option) => (
            <li key={option.id}>
              <label className="flex items-center gap-2 text-sm text-text">
                <Checkbox name={name} value={option.id} defaultChecked={chosen.has(option.id)} />
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

function nameOf(items: readonly NamedOption[], id: string | null, fallback: string): string {
  if (id === null) return fallback;
  return items.find((item) => item.id === id)?.name ?? fallback;
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
 * Nastavení kampaně: všechno, co kontrolní seznam na obrazovce odeslání vyžaduje,
 * na jednom formuláři. Obrazovka odeslání umí jen říct, co chybí; vyplnit se to
 * musí dát tady, jinak se kampaň nedá dokončit.
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
}: CampaignSettingsFormProps) {
  const t = useTranslations('campaigns.settings');
  const [state, formAction] = useActionState(action, initialState ?? IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};
  useFormErrorFocus(fieldErrors, formRef);

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
      <section aria-labelledby="campaign-settings-title" className="flex flex-col gap-4">
        <h1 id="campaign-settings-title" className="text-xl font-semibold">
          {t('title')}
        </h1>
        <ReadOnlyBanner reason={scheduled ? t('lockedScheduled') : t('locked')} />
        <div className="flex flex-col gap-4">
          <ReadOnlyValue label={t('name')} value={campaign.name} />
          <ReadOnlyValue label={t('subject')} value={campaign.subject} />
          <ReadOnlyValue label={t('preheader')} value={campaign.preheader} />
          <ReadOnlyValue
            label={t('template')}
            value={nameOf(options.templates, campaign.template_id, none)}
          />
          <ReadOnlyValue
            label={t('provider')}
            value={nameOf(options.providers, campaign.provider_id, none)}
          />
        </div>
        {scheduled ? (
          <UnscheduleAction workspaceId={workspaceId} campaignId={campaign.id} />
        ) : (
          <p>
            <Link href={`${basePath}/campaigns/${campaign.id}/progress`} className="underline">
              {t('toProgress')}
            </Link>
          </p>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby="campaign-settings-title" className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between gap-4">
        <h1 id="campaign-settings-title" className="text-xl font-semibold">
          {t('title')}
        </h1>
        <p role="status" data-testid="settings-saved" className="text-sm text-text-muted">
          {savedVisible ? t('saved') : ''}
        </p>
      </div>

      <p className="text-text-muted">{t('intro')}</p>

      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <SettingsProblem problem={state.problem} />
      ) : null}

      <form ref={formRef} action={formAction} className="flex flex-col gap-8" noValidate>
        <input type="hidden" name="workspace_id" value={workspaceId} readOnly />
        <input type="hidden" name="campaign_id" value={campaign.id} readOnly />

        <section aria-labelledby="campaign-basics" className="flex flex-col gap-4">
          <h2 id="campaign-basics" className="text-lg font-semibold">
            {t('basicsTitle')}
          </h2>

          <div>
            <Label htmlFor="name">{t('name')}</Label>
            <Input
              id="name"
              name="name"
              defaultValue={campaign.name}
              {...fieldAria('name', fieldErrors)}
            />
            <p className="mt-1 text-sm text-text-muted">{t('nameHint')}</p>
            <FieldError name="name" errors={fieldErrors} />
          </div>

          <div>
            <Label htmlFor="subject">{t('subject')}</Label>
            <Input
              id="subject"
              name="subject"
              defaultValue={campaign.subject}
              {...fieldAria('subject', fieldErrors)}
            />
            <p className="mt-1 text-sm text-text-muted">{t('subjectHint')}</p>
            <FieldError name="subject" errors={fieldErrors} />
          </div>

          <div>
            <Label htmlFor="preheader">{t('preheader')}</Label>
            <Input
              id="preheader"
              name="preheader"
              defaultValue={campaign.preheader}
              {...fieldAria('preheader', fieldErrors)}
            />
            <p className="mt-1 text-sm text-text-muted">{t('preheaderHint')}</p>
            <FieldError name="preheader" errors={fieldErrors} />
          </div>
        </section>

        <section aria-labelledby="campaign-content" className="flex flex-col gap-4">
          <h2 id="campaign-content" className="text-lg font-semibold">
            {t('contentTitle')}
          </h2>
          <SelectField
            key={selectKey('template', campaign.template_id)}
            name="template_id"
            label={t('template')}
            placeholder={none}
            defaultValue={selected(campaign.template_id)}
            options={withNoneOption(options.templates, none)}
            hint={t('templateHint')}
            errors={fieldErrors}
          />
          <p className="text-sm">
            <Link href={`${basePath}/templates`} className="underline">
              {options.templates.length === 0 ? t('templatesEmptyAction') : t('templatesManage')}
            </Link>
          </p>
        </section>

        <section aria-labelledby="campaign-audience" className="flex flex-col gap-4">
          <h2 id="campaign-audience" className="text-lg font-semibold">
            {t('audienceTitle')}
          </h2>
          <p className="text-sm text-text-muted">{t('audienceHint')}</p>

          {/* Chyba publika patří k celé skupině, ne k jedinému zaškrtávátku:
              stačí jedna položka z kterékoli strany, takže by u konkrétního
              řádku hlásila něco, co ten řádek sám nezpůsobil. */}
          <div data-testid="audience-include" className="flex flex-wrap gap-8">
            <OptionGroup
              legend={t('includeLists')}
              name="include_list"
              options={options.lists}
              selected={campaign.include_lists}
              emptyText={t('noLists')}
              emptyHref={`${basePath}/lists`}
              emptyAction={t('noListsAction')}
            />
            <OptionGroup
              legend={t('includeSegments')}
              name="include_segment"
              options={options.segments}
              selected={campaign.include_segments}
              emptyText={t('noSegments')}
              emptyHref={`${basePath}/segments`}
              emptyAction={t('noSegmentsAction')}
            />
          </div>
          <FieldError name="audience" errors={fieldErrors} />

          <h3 className="text-base font-medium">{t('excludeTitle')}</h3>
          <p className="text-sm text-text-muted">{t('excludeHint')}</p>
          <div data-testid="audience-exclude" className="flex flex-wrap gap-8">
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
        </section>

        <section aria-labelledby="campaign-sender" className="flex flex-col gap-4">
          <h2 id="campaign-sender" className="text-lg font-semibold">
            {t('senderTitle')}
          </h2>

          <div>
            <Label htmlFor="from_name">{t('fromName')}</Label>
            <Input
              id="from_name"
              name="from_name"
              defaultValue={campaign.from_name}
              {...fieldAria('from_name', fieldErrors)}
            />
            <FieldError name="from_name" errors={fieldErrors} />
          </div>

          <div>
            <Label htmlFor="from_email">{t('fromEmail')}</Label>
            <Input
              id="from_email"
              name="from_email"
              type="email"
              defaultValue={campaign.from_email}
              {...fieldAria('from_email', fieldErrors)}
            />
            <p className="mt-1 text-sm text-text-muted">{t('fromEmailHint')}</p>
            <FieldError name="from_email" errors={fieldErrors} />
          </div>

          <div>
            <Label htmlFor="reply_to">{t('replyTo')}</Label>
            <Input
              id="reply_to"
              name="reply_to"
              type="email"
              defaultValue={campaign.reply_to ?? ''}
              {...fieldAria('reply_to', fieldErrors)}
            />
            <p className="mt-1 text-sm text-text-muted">{t('replyToHint')}</p>
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
            <Link href={`${basePath}/settings/sending`} className="underline">
              {options.providers.length === 0 ? t('sendingEmptyAction') : t('sendingManage')}
            </Link>
          </p>
        </section>

        <section aria-labelledby="campaign-tracking" className="flex flex-col gap-4">
          <h2 id="campaign-tracking" className="text-lg font-semibold">
            {t('trackingTitle')}
          </h2>

          <SelectField
            key={selectKey('unsub', campaign.unsubscribe_list_id)}
            name="unsubscribe_list_id"
            label={t('unsubscribeList')}
            placeholder={none}
            defaultValue={selected(campaign.unsubscribe_list_id)}
            options={withNoneOption(options.lists, none)}
            hint={t('unsubscribeListHint')}
            errors={fieldErrors}
          />

          <label className="flex items-center gap-2 text-sm text-text">
            <Checkbox name="track_opens" value="on" defaultChecked={campaign.track_opens} />
            <span>{t('trackOpens')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-text">
            <Checkbox name="track_clicks" value="on" defaultChecked={campaign.track_clicks} />
            <span>{t('trackClicks')}</span>
          </label>
        </section>

        <div className="flex flex-wrap items-center gap-4">
          <SubmitButton label={t('save')} pendingLabel={t('saving')} />
          {/* Odkaz na kontrolní seznam, ne tlačítko „odeslat": odeslat se dá až
              z obrazovky, která ukáže, komu a kolika lidem to půjde. */}
          <Link href={sendHref} className="underline" data-testid="to-send">
            {t('toSend')}
          </Link>
        </div>
      </form>
    </section>
  );
}
