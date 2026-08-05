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
};

export function ListDetail({
  basePath,
  workspaceId,
  list,
}: {
  basePath: string;
  /** Projekt pro změnu režimu potvrzení a archivaci. Bez něj API vrátí 404. */
  workspaceId: string;
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
