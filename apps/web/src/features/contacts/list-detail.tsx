'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { RadioGroup, RadioGroupItem } from '@mlain/ui/components/radio-group';
import { Switch } from '@mlain/ui/components/switch';
import { Textarea } from '@mlain/ui/components/textarea';
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

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-text">{list.name}</h1>

      {/* Základní údaje. Do téhle chvíle šel na seznamu nastavit jen režim potvrzení,
          opt-in a veřejné nabízení, takže seznam nešlo ani přejmenovat. */}
      <h2 className="font-semibold text-text">{t('lists.basicsTitle')}</h2>
      <div className="flex flex-col gap-3">
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
            rows={2}
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
            onChange={(event) => setMaxResends(event.target.value)}
          />
        </Field>
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            data-testid="list-basics-save"
            onClick={() => {
              if (!savingBasics) void saveBasics();
            }}
          >
            {savingBasics ? t('lists.basicsSaving') : t('lists.basicsSave')}
          </Button>
          {basicsSaved ? <p role="status">{t('lists.basicsSaved')}</p> : null}
          {basicsError ? (
            <p role="alert" className="text-sm text-danger-text">
              {t('lists.basicsFailed')}
            </p>
          ) : null}
        </div>
      </div>

      <p data-testid="list-counts">
        {t('lists.members', { count: list.confirmed_count })}
        {', '}
        {t('lists.pending', { count: list.pending_count })}
      </p>

      {/* Čekající se nedají odbýt jedním číslem. Dokud čekají, kampaň na tenhle seznam
          nemá komu odejít, a bez potvrzovacího e-mailu se z toho člověk sám nedostane.
          Tlačítko je proto vidět jen tehdy, když někdo doopravdy čeká, a je za dialogem,
          protože potvrdit cizí přihlášení smí jen ten, kdo má souhlas doložený. */}
      {list.pending_count > 0 && !list.archived ? (
        <div className="flex flex-col gap-2" data-testid="list-pending-block">
          <p className="text-sm text-text-muted">{t('lists.pendingExplained')}</p>
          {confirmOpen ? (
            <div className="flex flex-col gap-2 rounded-md border border-border p-3">
              <p className="text-sm text-text">
                {t('lists.confirmPendingQuestion', { count: list.pending_count })}
              </p>
              <p className="text-sm text-text-muted">{t('lists.confirmPendingDeclaration')}</p>
              <div className="flex gap-2">
                {/* Primární tlačítko se podle návrhového systému nezakazuje (princip P5),
                    takže se opakovanému kliknutí brání příznakem v obsluze, ne atributem. */}
                <Button
                  variant="primary"
                  data-testid="confirm-pending-submit"
                  onClick={() => {
                    if (!confirming) void confirmPending();
                  }}
                >
                  {confirming ? t('lists.confirmPendingWorking') : t('lists.confirmPendingSubmit')}
                </Button>
                <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
                  {t('lists.confirmPendingCancel')}
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button
                variant="primary"
                data-testid="confirm-pending-open"
                onClick={() => setConfirmOpen(true)}
              >
                {t('lists.confirmPending')}
              </Button>
            </div>
          )}
        </div>
      ) : null}
      {confirmResult === null ? null : (
        <p role="status" data-testid="confirm-pending-result">
          {confirmResult.skipped > 0
            ? t('lists.confirmPendingDoneWithSkipped', {
                confirmed: confirmResult.confirmed,
                skipped: confirmResult.skipped,
              })
            : t('lists.confirmPendingDone', { count: confirmResult.confirmed })}
        </p>
      )}

      <h2 className="font-semibold text-text">{t('lists.confirmationMode')}</h2>
      {/* Rozdíl mezi režimy se vysvětluje doslova. „Jednokrokové" versus „dvoukrokové"
          nikomu neřekne, co se stane, a hlavně zamlčí to podstatné: ani jeden režim
          nepotvrzuje na GET, protože firemní skenery odkazy v e-mailech proklikávají. */}
      <RadioGroup
        name="confirmation-mode"
        value={mode}
        onValueChange={(next: string) => void changeMode(next as 'one_step' | 'two_step')}
      >
        {(
          [
            {
              value: 'one_step',
              label: 'confirmationModeOneStep',
              hint: 'confirmationModeOneStepHint',
            },
            {
              value: 'two_step',
              label: 'confirmationModeTwoStep',
              hint: 'confirmationModeTwoStepHint',
            },
          ] as const
        ).map((option) => (
          <div key={option.value} className="flex items-start gap-3">
            <RadioGroupItem
              value={option.value}
              id={`confirmation-mode-${option.value}`}
              aria-labelledby={`confirmation-mode-label-${option.value}`}
            />
            <div className="flex flex-col gap-1">
              <span
                id={`confirmation-mode-label-${option.value}`}
                className="text-sm font-medium text-text"
              >
                {t(`lists.${option.label}`)}
              </span>
              <span className="text-sm text-text-muted">{t(`lists.${option.hint}`)}</span>
            </div>
          </div>
        ))}
      </RadioGroup>
      {saved ? <p role="status">{t('lists.confirmationModeChanged')}</p> : null}

      <h2 className="font-semibold text-text">{t('lists.doubleOptIn')}</h2>
      {/* Dřív to byl jen text a seznam se přepnout nedal, přestože API to umělo.
          Pro vlastní adresy je potvrzení e-mailem zbytečná překážka, a dokud se
          potvrzovací e-maily neposílají, je to překážka nepřekonatelná. Změna platí
          na přihlášení, která přijdou potom; kdo čeká, čeká dál. */}
      <RadioGroup
        name="opt-in"
        value={optIn}
        onValueChange={(next: string) => void changeOptIn(next as 'single' | 'double')}
      >
        {(
          [
            { value: 'double', label: 'optInDouble', hint: 'optInDoubleHint' },
            { value: 'single', label: 'optInSingle', hint: 'optInSingleHint' },
          ] as const
        ).map((option) => (
          <div key={option.value} className="flex items-start gap-3">
            <RadioGroupItem
              value={option.value}
              id={`opt-in-${option.value}`}
              aria-labelledby={`opt-in-label-${option.value}`}
            />
            <div className="flex flex-col gap-1">
              <span id={`opt-in-label-${option.value}`} className="text-sm font-medium text-text">
                {t(`lists.${option.label}`)}
              </span>
              <span className="text-sm text-text-muted">{t(`lists.${option.hint}`)}</span>
            </div>
          </div>
        ))}
      </RadioGroup>
      {optInSaved ? <p role="status">{t('lists.optInChanged')}</p> : null}

      {/* Veřejné nabízení. Není to vzhled: zapnuté nabízení znamená, že se do seznamu
          smí sám přihlásit kdokoli, kdo drží odhlašovací odkaz z libovolného našeho
          e-mailu. U seznamu, který znamená nárok, je to nárok zdarma, takže výchozí
          stav je vypnuto. Odhlásit se jde vždycky a tohle to neovlivňuje. */}
      <h2 className="font-semibold text-text">{t('lists.publicVisible')}</h2>
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
        <div className="flex flex-col gap-1">
          <label htmlFor="list-public-visible" className="text-sm font-medium text-text">
            {publicVisible ? t('lists.publicVisibleOn') : t('lists.publicVisibleOff')}
          </label>
          <span className="text-sm text-text-muted">{t('lists.publicVisibleHint')}</span>
        </div>
      </div>

      {publicVisible ? (
        <div className="flex flex-col gap-3">
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
        </div>
      ) : null}
      {publicSaved ? <p role="status">{t('lists.publicVisibleChanged')}</p> : null}

      {/* Kam po potvrzení a po odhlášení. Prázdné pole znamená, že člověk zůstane
          na naší stránce, a to je pro většinu projektů správně: naše stránka mu
          řekne, co se právě stalo, a nabídne opravu, kdyby to bylo omylem. */}
      {/* Výchozí seznam projektu. Endpoint na to existoval od začátku a neměl
          volajícího, takže se výchozí seznam nedal přehodit odnikud. Je to
          rozhodnutí o tom, kam lidé přistávají při ručním přidání a při importu,
          proto se nabízí jako vědomý krok a ne jako tichá vlastnost. */}
      <h2 className="font-semibold text-text">{t('lists.defaultTitle')}</h2>
      <p className="text-sm text-text-muted">{t('lists.defaultHint')}</p>
      {list.is_default ? (
        <p data-testid="list-is-default">{t('lists.defaultOn')}</p>
      ) : (
        <div>
          <Button
            variant="secondary"
            data-testid="list-make-default"
            onClick={() => void makeDefault()}
          >
            {t('lists.defaultSet')}
          </Button>
        </div>
      )}
      {defaultSaved ? <p role="status">{t('lists.basicsSaved')}</p> : null}
      {defaultError ? (
        <p role="alert" className="text-sm text-danger-text" data-testid="list-default-failed">
          {t('lists.basicsFailed')}
        </p>
      ) : null}

      <h2 className="font-semibold text-text">{t('lists.redirectsTitle')}</h2>
      <div className="flex flex-col gap-3">
        <Field
          label={t('lists.confirmRedirect')}
          hint={t('lists.confirmRedirectHint')}
          optionalLabel={t('lists.publicOptional')}
        >
          <Input
            type="url"
            value={confirmRedirect}
            data-testid="list-confirm-redirect"
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
            data-testid="list-unsubscribe-redirect"
            onChange={(event) => setUnsubscribeRedirect(event.target.value)}
            onBlur={() => void saveRedirects()}
          />
        </Field>
        {redirectsSaved ? <p role="status">{t('lists.basicsSaved')}</p> : null}
      </div>

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

      {list.archived ? null : (
        <div>
          <Button
            variant="secondary"
            onClick={async () => {
              await archiveListAction({ workspaceId, id: list.id });
              router.push(basePath);
            }}
          >
            {t('lists.archive')}
          </Button>
        </div>
      )}
    </section>
  );
}
