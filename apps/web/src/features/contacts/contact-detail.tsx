'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Tooltip } from '@mlain/ui/components/tooltip';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { ReadOnlyBanner } from '@mlain/ui/patterns/states';
import { useToast } from '@mlain/ui/patterns/toast';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { deleteContactAction, exportContactAction, unsubscribeContactAction } from './actions';
import {
  cancelSnoozeAction,
  resendConfirmationAction,
  resubscribeAction,
  type ContactActionResult,
} from './edit-actions';
import { describeContactState } from './contact-state';
import { ContactStatusBadges } from './status-badges';
import type { ContactStatus } from './filters';

export type ContactDetailData = {
  id: string;
  email: string;
  name: string | null;
  greeting: string;
  greeting_locked: boolean;
  gender: 'female' | 'male' | 'unknown';
  status: ContactStatus;
  processing_restricted: boolean;
  snooze_until: string | null;
  anonymized_at: string | null;
  status_changed_at: string;
  restriction_requested_at: string | null;
  /**
   * Seznamy kontaktu VČETNĚ STAVU přihlášení. Stav tu není navíc: bez něj se nedá určit,
   * ve kterém seznamu má smysl poslat potvrzení znovu (jen tam, kde je přihlášení
   * `pending`) a do kterého se dá přihlásit zpět (jen tam, kde je `unsubscribed`).
   * Dokud tu stav nebyl, obě tlačítka neměla kam mířit.
   */
  lists: { id: string; name: string; status: string }[];
  tags: { id: string; name: string }[];
  attributes: { key: string; label: string; value: string }[];
  source: string;
  subscribed_at: string | null;
  consent_summary: string | null;
};

const GENDER_KEY = {
  female: 'detail.genderFemale',
  male: 'detail.genderMale',
  unknown: 'detail.genderUnknown',
} as const;

export function ContactDetail({
  basePath,
  workspacePath,
  workspaceId,
  contact,
}: {
  basePath: string;
  /** Kořen projektu, tedy `/w/{slug}`. Odkazy mimo kontakty se skládají z něj. */
  workspacePath: string;
  /**
   * Identifikátor projektu pro serverové akce. Není to duplicita `workspacePath`:
   * z něj jde slug, ale API chce hlavičku `X-Workspace-Id` s identifikátorem, a bez ní
   * odpoví 404 na kontakt, který existuje.
   */
  workspaceId: string;
  contact: ContactDetailData;
}) {
  const t = useTranslations('contacts');
  const format = useFormatter();
  const router = useRouter();
  const toast = useToast();
  const confirmLabels = useConfirmDialogLabels();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const state = describeContactState(contact);
  const displayName = contact.name ?? contact.email;

  // Seznamy, ve kterých má daná akce co dělat. Prázdné pole znamená, že se tlačítko
  // nenabídne vůbec: „Poslat potvrzení znovu" u kontaktu bez čekajícího přihlášení
  // nemá co poslat a skončilo by chybou ze serveru.
  const pendingLists = contact.lists.filter((list) => list.status === 'pending');
  const unsubscribedLists = contact.lists.filter((list) => list.status === 'unsubscribed');
  // Seznamy, ze kterých je z čeho odhlašovat. Odhlášení míří na `DELETE
  // /lists/{id}/subscribe`, takže potřebuje jejich identifikátory.
  const subscribedLists = contact.lists.filter((list) => list.status !== 'unsubscribed');

  /**
   * Společné vyhodnocení výsledku akce. Chyba se ukáže, ne spolkne, a nese kód:
   * `resend_throttled` a `already_confirmed` vypadají zvenčí jako úspěch (server na ně
   * odpovídá 200) a bez kódu by uživatel nepoznal, že se nic neodeslalo.
   */
  function report(result: ContactActionResult, successMessage: string): void {
    if (result.status === 'success') {
      toast.success(successMessage);
      router.refresh();
      return;
    }
    toast.error(t('detail.actionFailed', { code: result.code }));
  }

  return (
    <article className="flex flex-col gap-6">
      <Link href={basePath}>{t('detail.back')}</Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-text">{displayName}</h1>
        <p className="text-sm text-text-muted">{contact.email}</p>
        <ContactStatusBadges badges={state.badges} />
        {state.notes.map((note) => (
          <p key={note.textKey} className="text-sm text-text-muted">
            {t(note.textKey, { date: format.dateTime(new Date(note.values['date']!), 'short') })}
          </p>
        ))}
      </header>

      {state.readOnly ? <ReadOnlyBanner reason={t('detail.readOnly')} /> : null}

      {state.restricted ? (
        <section
          data-testid="contact-restricted"
          className="flex flex-col gap-2 rounded-[var(--radius-surface)] border border-warning-text bg-warning-surface p-4"
        >
          <h2 className="font-semibold text-text">{t('restricted.title')}</h2>
          <p>
            {t('restricted.body', {
              name: displayName,
              date: format.dateTime(
                new Date(contact.restriction_requested_at ?? contact.status_changed_at),
                'short',
              ),
            })}
          </p>
          {/* Věta o segmentech je tam schválně: uživatel jinak vidí kontakt v seznamu,
              vidí, že splňuje podmínky segmentu, a nechápe, proč se počet nesejde. */}
          <p>{t('restricted.consequence')}</p>
          <Link href={`${workspacePath}/settings/privacy?contact=${contact.id}`}>
            {t('restricted.action')}
          </Link>
        </section>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="flex flex-col gap-6">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-sm font-medium text-text">{t('detail.addressing')}</dt>
            <dd className="flex items-center gap-2 text-sm text-text">
              {contact.greeting}
              {contact.greeting_locked ? (
                <Tooltip content={t('detail.addressingLocked')}>
                  <span role="img" aria-label={t('detail.addressingLocked')}>
                    {'\u{1F512}'}
                  </span>
                </Tooltip>
              ) : null}
              {/* Míří na editaci, ne na `/greeting`. Obrazovka `/greeting` v aplikaci
                  NEEXISTUJE (v `app/.../contacts/[id]/` je jen `page.tsx` a `timeline/`),
                  takže tenhle odkaz do téhle chvíle vracel 404. Oslovení se navíc počítá
                  ze jména a rodu, a obojí se mění právě ve formuláři, kde je hned vedle
                  vidět náhled výsledku. */}
              <Link href={`${basePath}/${contact.id}/edit`}>{t('detail.addressingChange')}</Link>
            </dd>

            <dt className="text-sm font-medium text-text">{t('detail.gender')}</dt>
            <dd className="text-sm text-text">{t(GENDER_KEY[contact.gender])}</dd>
          </dl>

          <div>
            <h2 className="font-semibold text-text">{t('detail.sectionMembership')}</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <dt className="text-sm font-medium text-text">{t('detail.lists')}</dt>
              <dd className="text-sm text-text">
                {contact.lists.length > 0
                  ? format.list(contact.lists.map((list) => list.name))
                  : t('detail.noLists')}
              </dd>
              <dt className="text-sm font-medium text-text">{t('detail.tags')}</dt>
              <dd className="text-sm text-text">
                {contact.tags.length > 0
                  ? format.list(contact.tags.map((tag) => tag.name))
                  : t('detail.noTags')}
              </dd>
            </dl>
          </div>

          {state.showsPersonalData ? (
            <div>
              <h2 className="font-semibold text-text">{t('detail.sectionData')}</h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                {contact.attributes.map((attribute) => (
                  <div key={attribute.key} className="contents">
                    <dt className="text-sm font-medium text-text">{attribute.label}</dt>
                    <dd className="text-sm text-text">{attribute.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          <div>
            <h2 className="font-semibold text-text">{t('detail.sectionOrigin')}</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <dt className="text-sm font-medium text-text">{t('detail.source')}</dt>
              <dd className="text-sm text-text">{contact.source}</dd>
              {contact.subscribed_at ? (
                <>
                  <dt className="text-sm font-medium text-text">{t('detail.subscribedAt')}</dt>
                  <dd className="text-sm text-text">
                    <time dateTime={contact.subscribed_at}>
                      {format.dateTime(new Date(contact.subscribed_at), 'short')}
                    </time>
                  </dd>
                </>
              ) : null}
              {contact.consent_summary ? (
                <>
                  <dt className="text-sm font-medium text-text">{t('detail.consent')}</dt>
                  <dd className="flex flex-wrap items-center gap-2 text-sm text-text">
                    {contact.consent_summary}
                    <Link href={`${basePath}/${contact.id}/consents`}>
                      {t('detail.consentHistory')}
                    </Link>
                  </dd>
                </>
              ) : null}
            </dl>
          </div>

          <div className="flex flex-wrap gap-2">
            {state.actions.includes('edit') ? (
              <Button
                variant="primary"
                onClick={() => router.push(`${basePath}/${contact.id}/edit`)}
              >
                {t('detail.actionEdit')}
              </Button>
            ) : null}
            {state.actions.includes('unsubscribe') && subscribedLists.length > 0 ? (
              <Button
                variant="secondary"
                onClick={async () => {
                  // Odhlašuje se ze VŠECH seznamů, ve kterých kontakt ještě je.
                  // Odhlášení je v API operace nad seznamem, ne nad kontaktem.
                  const result = await unsubscribeContactAction({
                    workspaceId,
                    email: contact.email,
                    listIds: subscribedLists.map((list) => list.id),
                  });
                  if (result.status === 'success') {
                    // Ruční odhlášení bývá omyl, proto má vrácení s odpočtem 10 s (6.6 části 6).
                    toast.undoable({
                      message: t('detail.unsubscribed'),
                      onUndo: () => router.refresh(),
                    });
                    router.refresh();
                  }
                }}
              >
                {t('detail.actionUnsubscribe')}
              </Button>
            ) : null}
            {/* Jedno tlačítko na seznam, ne jedno na kontakt. Potvrzení se posílá
                za konkrétní přihlášení a kontakt jich může mít víc naráz; jedno
                tlačítko by muselo hádat, které z nich uživatel myslel. Když je
                čekající přihlášení jediné, jméno seznamu se do popisku nepíše. */}
            {state.actions.includes('resendConfirmation')
              ? pendingLists.map((list) => (
                  <Button
                    key={list.id}
                    variant="secondary"
                    onClick={async () => {
                      report(
                        await resendConfirmationAction({
                          workspaceId,
                          listId: list.id,
                          contactId: contact.id,
                        }),
                        t('detail.confirmationResent'),
                      );
                    }}
                  >
                    {pendingLists.length === 1
                      ? t('statusAction.resendConfirmation')
                      : t('statusAction.resendConfirmationIn', { list: list.name })}
                  </Button>
                ))
              : null}
            {state.actions.includes('resubscribe')
              ? unsubscribedLists.map((list) => (
                  <Tooltip key={list.id} content={t('statusAction.resubscribeNote')}>
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        report(
                          await resubscribeAction({
                            workspaceId,
                            listId: list.id,
                            email: contact.email,
                          }),
                          t('detail.resubscribeSent'),
                        );
                      }}
                    >
                      {unsubscribedLists.length === 1
                        ? t('statusAction.resubscribe')
                        : t('statusAction.resubscribeIn', { list: list.name })}
                    </Button>
                  </Tooltip>
                ))
              : null}
            {state.actions.includes('openSuppressions') ? (
              <Link href={`${workspacePath}/suppressions?q=${encodeURIComponent(contact.email)}`}>
                {t('statusAction.openSuppressions')}
              </Link>
            ) : null}
            {state.actions.includes('cancelSnooze') ? (
              <Button
                variant="secondary"
                onClick={async () => {
                  report(
                    await cancelSnoozeAction({ workspaceId, id: contact.id }),
                    t('detail.snoozeCancelled'),
                  );
                }}
              >
                {t('statusAction.cancelSnooze')}
              </Button>
            ) : null}
            {state.actions.includes('delete') ? (
              <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                {t('detail.actionDelete')}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => void exportContactAction({ workspaceId, id: contact.id })}
            >
              {t('detail.actionExport')}
            </Button>
          </div>
        </section>

        {/* K8 z 13.1 části 6. Položky do osy dodá plán P14; tenhle plán dodává jen místo
            a jeho prázdný stav, který je pravdivý i tehdy, když ještě není zdroj dat. */}
        <section data-testid="contact-timeline" className="flex flex-col gap-2">
          <h2 className="font-semibold text-text">{t('detail.timeline')}</h2>
          <div className="rounded-[var(--radius-surface)] border border-border bg-surface p-6">
            <h3 className="font-medium text-text">{t('detail.timelineEmptyTitle')}</h3>
            <p className="text-sm text-text-muted">
              {t('detail.timelineEmptyBody', { name: displayName })}
            </p>
          </div>
        </section>
      </div>

      {/* Smazání jednoho kontaktu je N2 podle 6.2 části 6: dialog se souhrnem, bez
          zaškrtávání a bez opisování. Znění je doslovné podle 8.8 části 6. */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        level="N2"
        title={t('detail.deleteTitle', { name: displayName })}
        consequences={[
          t('detail.deleteConsequenceLists'),
          t('detail.deleteConsequenceHistory'),
          t('detail.deleteConsequenceReports'),
          t('detail.deleteConsequenceSuppression'),
        ]}
        extraAction={
          <Button
            variant="secondary"
            onClick={() => void exportContactAction({ workspaceId, id: contact.id })}
          >
            {t('detail.deleteExport')}
          </Button>
        }
        confirmLabel={t('detail.deleteConfirm')}
        cancelLabel={t('detail.deleteCancel')}
        labels={confirmLabels}
        onConfirm={async () => {
          const result = await deleteContactAction({ workspaceId, id: contact.id });
          if (result.status === 'success') router.push(basePath);
        }}
      />
    </article>
  );
}
