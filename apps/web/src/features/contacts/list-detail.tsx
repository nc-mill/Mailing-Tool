'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { PageHeader } from '@mlain/ui/components/page-header';
import { RadioGroup, RadioGroupItem } from '@mlain/ui/components/radio-group';
import { Switch } from '@mlain/ui/components/switch';
import { Textarea } from '@mlain/ui/components/textarea';
import { Tooltip } from '@mlain/ui/components/tooltip';
import { Archive, ChevronRight, CircleCheckBig, Save } from '@mlain/ui/icons';
import { Alert } from '@mlain/ui/patterns/states';
import {
  archiveListAction,
  confirmPendingAction,
  setConfirmationModeAction,
  setListPublicVisibilityAction,
  setOptInAction,
} from './actions';
import {
  saveListBasicsAction,
  saveListRedirectsAction,
  setDefaultListAction,
} from './list-email-actions';
import { ListEmails, type ListEmailState } from './list-emails';

export type ListDetailData = {
  id: string;
  name: string;
  confirmed_count: number;
  pending_count: number;
  double_opt_in: boolean;
  confirmation_mode: 'one_step' | 'two_step';
  archived: boolean;
  /** Nabízí se seznam příjemcům v centru předvoleb k přihlášení? */
  public_visible: boolean;
  /** Název, který uvidí příjemce. Prázdné znamená, že se ukáže pracovní název. */
  public_name: string;
  public_description: string;
  description: string;
  /**
   * Jak dlouho platí potvrzovací odkaz a kolikrát se smí za 24 hodin poslat znovu.
   * Krátká platnost je nejčastější důvod, proč lidem přihlášení „nejde"; strop
   * je ochrana cizí schránky před opakovaným odesláním z formuláře.
   */
  confirmation_ttl_hours: number;
  confirmation_max_resends: number;
  /** Kam po potvrzení a po odhlášení. Prázdné znamená „zůstane naše stránka". */
  confirm_redirect_url: string;
  unsubscribe_redirect_url: string;
  /**
   * Výchozí seznam projektu. Řídí, co je předem zaškrtnuté při ručním přidání
   * kontaktu a předvybrané v průvodci importem, takže je to rozhodnutí o tom,
   * kam lidé přistávají, ne ozdoba.
   */
  is_default: boolean;
  /** Tři e-maily seznamu: potvrzení, uvítání, rozloučení. */
  emails: ListEmailState[];
};

/** Popisek a nápověda k jedné volbě přepínače. Obojí povinné, viz níž. */
type Choice<Value extends string> = { value: Value; label: string; hint: string };

/**
 * Skupina přepínačů s vysvětlením u každé volby.
 *
 * VYSVĚTLENÍ JE POVINNÉ, ne nepovinná ozdoba: rozdíl mezi „jedním kliknutím"
 * a „potvrzením na stránce" z názvů nepozná nikdo a chybná volba se projeví až
 * tím, že se lidem nedaří přihlásit.
 */
function ChoiceGroup<Value extends string>({
  name,
  value,
  choices,
  onChange,
}: {
  name: string;
  value: Value;
  choices: ReadonlyArray<Choice<Value>>;
  onChange: (next: Value) => void;
}) {
  return (
    <RadioGroup
      name={name}
      value={value}
      className="gap-[var(--spacing-stack)]"
      onValueChange={(next: string) => onChange(next as Value)}
    >
      {choices.map((choice) => (
        <div key={choice.value} className="flex items-start gap-3">
          <RadioGroupItem
            value={choice.value}
            id={`${name}-${choice.value}`}
            aria-labelledby={`${name}-label-${choice.value}`}
            className="mt-1"
          />
          <div className="flex flex-col gap-1.5">
            <span id={`${name}-label-${choice.value}`} className="text-ui font-semibold text-text">
              {choice.label}
            </span>
            <span className="text-meta text-text-muted">{choice.hint}</span>
          </div>
        </div>
      ))}
    </RadioGroup>
  );
}

export function ListDetail({
  basePath,
  templatesPath,
  workspaceId,
  language,
  list,
}: {
  basePath: string;
  /** Kam vede odkaz na šablonu vlastního znění, tedy `/w/{slug}/templates`. */
  templatesPath: string;
  /** Projekt pro změnu režimu potvrzení a archivaci. Bez něj API vrátí 404. */
  workspaceId: string;
  /** Jazyk, ve kterém se předvyplní nově založené znění e-mailu. */
  language: 'cs' | 'en';
  list: ListDetailData;
}) {
  const t = useTranslations('contacts');
  const tc = useTranslations('common');
  const router = useRouter();
  const [mode, setMode] = useState(list.confirmation_mode);
  const [saved, setSaved] = useState(false);
  const [optIn, setOptIn] = useState<'single' | 'double'>(list.double_opt_in ? 'double' : 'single');
  const [optInSaved, setOptInSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmResult, setConfirmResult] = useState<{
    confirmed: number;
    skipped: number;
  } | null>(null);
  const [publicVisible, setPublicVisible] = useState(list.public_visible);
  const [publicName, setPublicName] = useState(list.public_name);
  const [publicDescription, setPublicDescription] = useState(list.public_description);
  const [publicSaved, setPublicSaved] = useState(false);
  const [name, setName] = useState(list.name);
  const [description, setDescription] = useState(list.description);
  // Čísla se drží jako řetězec, protože prázdné pole v `<input type="number">`
  // dává NaN a to by se do API poslalo jako `null`, tedy jako změna, kterou
  // nikdo nechtěl.
  const [ttl, setTtl] = useState(String(list.confirmation_ttl_hours));
  const [maxResends, setMaxResends] = useState(String(list.confirmation_max_resends));
  const [confirmRedirect, setConfirmRedirect] = useState(list.confirm_redirect_url);
  const [unsubscribeRedirect, setUnsubscribeRedirect] = useState(list.unsubscribe_redirect_url);
  const [redirectsSaved, setRedirectsSaved] = useState(false);
  const [defaultSaved, setDefaultSaved] = useState(false);
  const [defaultError, setDefaultError] = useState(false);
  const [savingBasics, setSavingBasics] = useState(false);
  const [basicsSaved, setBasicsSaved] = useState(false);
  const [basicsError, setBasicsError] = useState(false);

  async function saveBasics() {
    setSavingBasics(true);
    setBasicsError(false);
    const result = await saveListBasicsAction({
      workspaceId,
      listId: list.id,
      name,
      description,
      confirmationTtlHours: Number(ttl),
      confirmationMaxResends: Number(maxResends),
    });
    setSavingBasics(false);
    if (result.status === 'error') {
      setBasicsError(true);
      return;
    }
    setBasicsSaved(true);
    router.refresh();
  }

  async function makeDefault() {
    setDefaultError(false);
    const result = await setDefaultListAction({ workspaceId, listId: list.id });
    // Neúspěch se MUSÍ ozvat. Dřív tu byla jen větev pro úspěch, takže když
    // akce selhala, obrazovka se nezměnila a vypadalo to, že se nic nestalo.
    // Tichý neúspěch je přesně ta vada, kvůli které je celý tenhle plán.
    if (result.status === 'error') {
      setDefaultError(true);
      return;
    }
    setDefaultSaved(true);
    router.refresh();
  }

  async function saveRedirects() {
    const result = await saveListRedirectsAction({
      workspaceId,
      listId: list.id,
      confirmRedirectUrl: confirmRedirect,
      unsubscribeRedirectUrl: unsubscribeRedirect,
    });
    if (result.status === 'success') {
      setRedirectsSaved(true);
      router.refresh();
    }
  }

  async function savePublic(next: {
    publicVisible?: boolean;
    publicName?: string;
    publicDescription?: string;
  }) {
    const payload = {
      workspaceId,
      id: list.id,
      publicVisible: next.publicVisible ?? publicVisible,
      publicName: next.publicName ?? publicName,
      publicDescription: next.publicDescription ?? publicDescription,
    };
    const result = await setListPublicVisibilityAction(payload);
    if (result.status === 'success') {
      setPublicSaved(true);
      router.refresh();
    }
  }

  async function changeMode(next: 'one_step' | 'two_step') {
    setMode(next);
    const result = await setConfirmationModeAction({ workspaceId, id: list.id, mode: next });
    if (result.status === 'success') {
      setSaved(true);
      router.refresh();
    }
  }

  async function changeOptIn(next: 'single' | 'double') {
    setOptIn(next);
    const result = await setOptInAction({ workspaceId, id: list.id, optIn: next });
    if (result.status === 'success') {
      setOptInSaved(true);
      router.refresh();
    }
  }

  async function confirmPending() {
    setConfirming(true);
    const result = await confirmPendingAction({ workspaceId, id: list.id });
    setConfirming(false);
    setConfirmOpen(false);
    if (result.status === 'success') {
      setConfirmResult({ confirmed: result.confirmed ?? 0, skipped: result.skipped ?? 0 });
      router.refresh();
    }
  }

  // Meta řádek pod nadpisem: potvrzení, čekající a případně to, že je seznam
  // výchozí. Odděluje se prostřední tečkou, protože jsou to tři samostatné
  // údaje, ne věta. Testid zůstává, počty se z něj čtou.
  const meta = (
    <span data-testid="list-counts">
      {t('lists.members', { count: list.confirmed_count })}
      {' · '}
      {t('lists.pending', { count: list.pending_count })}
      {list.is_default ? ` · ${t('lists.metaDefault')}` : ''}
    </span>
  );

  return (
    <>
      <PageHeader
        title={list.name}
        meta={meta}
        breadcrumbs={
          <nav aria-label={tc('a11y.breadcrumbs')} className="flex items-center gap-2">
            <Link href={basePath} className="text-sm underline-offset-[3px]">
              {t('lists.title')}
            </Link>
            <ChevronRight aria-hidden className="icon-xs shrink-0 text-border-strong" />
            <span className="min-w-0 truncate font-mono text-meta text-text-muted">
              {list.name}
            </span>
          </nav>
        }
        actions={
          <>
            {/* Archivace je v návrhu ikonový čtverec 44×44 s bublinou, ne tlačítko
                se slovem: vedle hlavní akce by druhé textové tlačítko soupeřilo
                o pozornost. Popisek nese `aria-label`, takže se význam neztratí. */}
            {list.archived ? null : (
              <Tooltip content={t('lists.archive')}>
                <button
                  type="button"
                  aria-label={t('lists.archive')}
                  className={[
                    'inline-flex items-center justify-center',
                    'size-[var(--size-target-min)] rounded-[var(--radius-control)]',
                    'border border-edge bg-transparent text-text',
                    'shadow-[0_var(--edge-raised)_0_var(--color-edge)]',
                    'transition-[background-color,box-shadow,transform] duration-[var(--duration-fast)]',
                    'hover:translate-y-[var(--edge-travel)] hover:bg-surface-muted',
                    'hover:shadow-[0_var(--edge-pressed)_0_var(--color-edge)]',
                  ].join(' ')}
                  onClick={async () => {
                    await archiveListAction({ workspaceId, id: list.id });
                    router.push(basePath);
                  }}
                >
                  <Archive aria-hidden className="icon-md" />
                </button>
              </Tooltip>
            )}
            <Button
              variant="primary"
              data-testid="list-basics-save"
              pending={savingBasics}
              pendingLabel={t('lists.basicsSaving')}
              onClick={() => {
                if (!savingBasics) void saveBasics();
              }}
            >
              <Save aria-hidden className="icon-md" />
              {t('lists.basicsSave')}
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-[var(--spacing-gutter)]">
        {basicsSaved ? (
          <Alert tone="success" role="status">
            {t('lists.basicsSaved')}
          </Alert>
        ) : null}
        {basicsError ? <Alert tone="error">{t('lists.basicsFailed')}</Alert> : null}

        {/* Čekající se nedají odbýt jedním číslem. Dokud čekají, kampaň na tenhle seznam
            nemá komu odejít, a bez potvrzovacího e-mailu se z toho člověk sám nedostane.
            Karta je vidět jen tehdy, když někdo doopravdy čeká, a potvrzení je za
            dialogem, protože potvrdit cizí přihlášení smí jen ten, kdo má souhlas
            doložený. */}
        {list.pending_count > 0 && !list.archived ? (
          <Card
            tone="highlight"
            padding="sm"
            className="px-[var(--spacing-card-tight)]"
            data-testid="list-pending-block"
          >
            <div className="flex flex-wrap items-center gap-[var(--spacing-gutter)]">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-base font-semibold text-text">
                  {t('lists.pending', { count: list.pending_count })}
                </p>
                <p className="text-sm text-warning-text">{t('lists.pendingExplained')}</p>
              </div>
              {confirmOpen ? null : (
                <Button
                  variant="secondary"
                  className="ml-auto"
                  data-testid="confirm-pending-open"
                  onClick={() => setConfirmOpen(true)}
                >
                  <CircleCheckBig aria-hidden className="icon-md" />
                  {t('lists.confirmPending')}
                </Button>
              )}
            </div>

            {confirmOpen ? (
              <div className="flex flex-col gap-[var(--spacing-stack)] border-t border-primary-hover pt-[var(--spacing-stack)]">
                <p className="text-ui text-text">
                  {t('lists.confirmPendingQuestion', { count: list.pending_count })}
                </p>
                <p className="text-sm text-warning-text">{t('lists.confirmPendingDeclaration')}</p>
                <div className="flex flex-wrap gap-[var(--spacing-inline)]">
                  {/* Primární tlačítko se podle návrhového systému nezakazuje (princip P5),
                      takže se opakovanému kliknutí brání příznakem v obsluze, ne atributem. */}
                  <Button
                    variant="primary"
                    data-testid="confirm-pending-submit"
                    pending={confirming}
                    pendingLabel={t('lists.confirmPendingWorking')}
                    onClick={() => {
                      if (!confirming) void confirmPending();
                    }}
                  >
                    {t('lists.confirmPendingSubmit')}
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
                    {t('lists.confirmPendingCancel')}
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        ) : null}

        {confirmResult === null ? null : (
          <Alert tone="success" role="status" data-testid="confirm-pending-result">
            {confirmResult.skipped > 0
              ? t('lists.confirmPendingDoneWithSkipped', {
                  confirmed: confirmResult.confirmed,
                  skipped: confirmResult.skipped,
                })
              : t('lists.confirmPendingDone', { count: confirmResult.confirmed })}
          </Alert>
        )}

        {/* Dva sloupce od 360 px na sloupec. `items-start` je podstatné: bez něj by se
            karty v jednom sloupci roztáhly na výšku toho druhého. */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(360px,1fr))] items-start gap-[var(--spacing-gutter)]">
          <div className="flex flex-col gap-[var(--spacing-gutter)]">
            {/* Základní údaje. Do 5. 8. 2026 šel na seznamu nastavit jen režim potvrzení,
                opt-in a veřejné nabízení, takže seznam nešlo ani přejmenovat.
                Tlačítko „Uložit údaje" je v hlavičce obrazovky, ne tady. */}
            <Card gap="gutter">
              <CardTitle>{t('lists.basicsTitle')}</CardTitle>
              <Field label={t('lists.name')}>
                <Input
                  value={name}
                  maxLength={120}
                  data-testid="list-name"
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field label={t('lists.description')} optionalLabel={t('lists.publicOptional')}>
                <Textarea
                  value={description}
                  maxLength={2000}
                  rows={3}
                  data-testid="list-description"
                  onChange={(event) => setDescription(event.target.value)}
                />
              </Field>
              <Field label={t('lists.confirmationTtl')} hint={t('lists.confirmationTtlHint')}>
                <Input
                  type="number"
                  min={1}
                  max={720}
                  value={ttl}
                  data-testid="list-ttl"
                  className="max-w-[200px] font-mono"
                  onChange={(event) => setTtl(event.target.value)}
                />
              </Field>
              <Field
                label={t('lists.confirmationMaxResends')}
                hint={t('lists.confirmationMaxResendsHint')}
              >
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={maxResends}
                  data-testid="list-max-resends"
                  className="max-w-[200px] font-mono"
                  onChange={(event) => setMaxResends(event.target.value)}
                />
              </Field>
            </Card>

            {/* Kam po potvrzení a po odhlášení. Prázdné pole znamená, že člověk zůstane
                na naší stránce, a to je pro většinu projektů správně: naše stránka mu
                řekne, co se právě stalo, a nabídne opravu, kdyby to bylo omylem.
                Ukládá se opuštěním pole, proto tu není tlačítko. */}
            <Card gap="gutter">
              <CardTitle>{t('lists.redirectsTitle')}</CardTitle>
              <Field
                label={t('lists.confirmRedirect')}
                hint={t('lists.confirmRedirectHint')}
                optionalLabel={t('lists.publicOptional')}
              >
                <Input
                  type="url"
                  value={confirmRedirect}
                  placeholder="https://"
                  data-testid="list-confirm-redirect"
                  className="font-mono"
                  onChange={(event) => setConfirmRedirect(event.target.value)}
                  onBlur={() => void saveRedirects()}
                />
              </Field>
              <Field
                label={t('lists.unsubscribeRedirect')}
                hint={t('lists.unsubscribeRedirectHint')}
                optionalLabel={t('lists.publicOptional')}
              >
                <Input
                  type="url"
                  value={unsubscribeRedirect}
                  placeholder="https://"
                  data-testid="list-unsubscribe-redirect"
                  className="font-mono"
                  onChange={(event) => setUnsubscribeRedirect(event.target.value)}
                  onBlur={() => void saveRedirects()}
                />
              </Field>
              {redirectsSaved ? (
                <p role="status" className="text-sm text-success-text">
                  {t('lists.basicsSaved')}
                </p>
              ) : null}
            </Card>

            {/* Výchozí seznam projektu. Endpoint na to existoval od začátku a neměl
                volajícího, takže se výchozí seznam nedal přehodit odnikud. Je to
                rozhodnutí o tom, kam lidé přistávají při ručním přidání a při importu,
                proto se nabízí jako vědomý krok a ne jako tichá vlastnost. */}
            <Card>
              <CardTitle>{t('lists.defaultTitle')}</CardTitle>
              <p className="text-meta text-text-muted">{t('lists.defaultHint')}</p>
              {list.is_default ? (
                <p className="text-ui text-text" data-testid="list-is-default">
                  {t('lists.defaultOn')}
                </p>
              ) : (
                <div>
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="list-make-default"
                    onClick={() => void makeDefault()}
                  >
                    {t('lists.defaultSet')}
                  </Button>
                </div>
              )}
              {defaultSaved ? (
                <p role="status" className="text-sm text-success-text">
                  {t('lists.basicsSaved')}
                </p>
              ) : null}
              {defaultError ? (
                <p
                  role="alert"
                  className="text-sm text-danger-text"
                  data-testid="list-default-failed"
                >
                  {t('lists.basicsFailed')}
                </p>
              ) : null}
            </Card>
          </div>

          <div className="flex flex-col gap-[var(--spacing-gutter)]">
            {/* Rozdíl mezi režimy se vysvětluje doslova. „Jednokrokové" versus „dvoukrokové"
                nikomu neřekne, co se stane, a hlavně zamlčí to podstatné: ani jeden režim
                nepotvrzuje na GET, protože firemní skenery odkazy v e-mailech proklikávají. */}
            <Card gap="gutter">
              <CardTitle>{t('lists.confirmationMode')}</CardTitle>
              <ChoiceGroup
                name="confirmation-mode"
                value={mode}
                onChange={(next) => void changeMode(next)}
                choices={[
                  {
                    value: 'one_step',
                    label: t('lists.confirmationModeOneStep'),
                    hint: t('lists.confirmationModeOneStepHint'),
                  },
                  {
                    value: 'two_step',
                    label: t('lists.confirmationModeTwoStep'),
                    hint: t('lists.confirmationModeTwoStepHint'),
                  },
                ]}
              />
              {saved ? (
                <p role="status" className="text-sm text-success-text">
                  {t('lists.confirmationModeChanged')}
                </p>
              ) : null}
            </Card>

            {/* Dřív to byl jen text a seznam se přepnout nedal, přestože API to umělo.
                Pro vlastní adresy je potvrzení e-mailem zbytečná překážka, a dokud se
                potvrzovací e-maily neposílají, je to překážka nepřekonatelná. Změna platí
                na přihlášení, která přijdou potom; kdo čeká, čeká dál. */}
            <Card gap="gutter">
              <CardTitle>{t('lists.doubleOptIn')}</CardTitle>
              <ChoiceGroup
                name="opt-in"
                value={optIn}
                onChange={(next) => void changeOptIn(next)}
                choices={[
                  {
                    value: 'double',
                    label: t('lists.optInDouble'),
                    hint: t('lists.optInDoubleHint'),
                  },
                  {
                    value: 'single',
                    label: t('lists.optInSingle'),
                    hint: t('lists.optInSingleHint'),
                  },
                ]}
              />
              {optInSaved ? (
                <p role="status" className="text-sm text-success-text">
                  {t('lists.optInChanged')}
                </p>
              ) : null}
            </Card>

            {/* Veřejné nabízení. Není to vzhled: zapnuté nabízení znamená, že se do seznamu
                smí sám přihlásit kdokoli, kdo drží odhlašovací odkaz z libovolného našeho
                e-mailu. U seznamu, který znamená nárok, je to nárok zdarma, takže výchozí
                stav je vypnuto. Odhlásit se jde vždycky a tohle to neovlivňuje. */}
            <Card gap="gutter">
              <CardTitle>{t('lists.publicVisible')}</CardTitle>
              <div className="flex items-start gap-3">
                <Switch
                  id="list-public-visible"
                  checked={publicVisible}
                  data-testid="list-public-visible"
                  onCheckedChange={(next: boolean) => {
                    setPublicVisible(next);
                    void savePublic({ publicVisible: next });
                  }}
                />
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="list-public-visible" className="text-ui font-semibold text-text">
                    {publicVisible ? t('lists.publicVisibleOn') : t('lists.publicVisibleOff')}
                  </label>
                  <span className="text-meta text-text-muted">{t('lists.publicVisibleHint')}</span>
                </div>
              </div>

              {publicVisible ? (
                <>
                  <Field
                    label={t('lists.publicName')}
                    hint={t('lists.publicNameHint', { name: list.name })}
                    optionalLabel={t('lists.publicOptional')}
                  >
                    <Input
                      value={publicName}
                      maxLength={120}
                      data-testid="list-public-name"
                      onChange={(event) => setPublicName(event.target.value)}
                      onBlur={() => void savePublic({})}
                    />
                  </Field>
                  <Field
                    label={t('lists.publicDescription')}
                    hint={t('lists.publicDescriptionHint')}
                    optionalLabel={t('lists.publicOptional')}
                  >
                    <Textarea
                      value={publicDescription}
                      maxLength={500}
                      rows={2}
                      data-testid="list-public-description"
                      onChange={(event) => setPublicDescription(event.target.value)}
                      onBlur={() => void savePublic({})}
                    />
                  </Field>
                </>
              ) : null}
              {publicSaved ? (
                <p role="status" className="text-sm text-success-text">
                  {t('lists.publicVisibleChanged')}
                </p>
              ) : null}
            </Card>

            {/* E-maily seznamu. Patří sem, ne do samostatné obrazovky: rozhodnutí
                „dvojí potvrzení" o kus výš a „jak vypadá potvrzovací e-mail" jsou
                dvě poloviny téže věci a odděleně se nastavit nedají. */}
            <ListEmails
              workspaceId={workspaceId}
              listId={list.id}
              listName={list.name}
              language={language}
              templatesPath={templatesPath}
              emails={list.emails}
            />
          </div>
        </div>
      </div>
    </>
  );
}
