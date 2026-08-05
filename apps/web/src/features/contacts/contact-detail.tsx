'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { ReadOnlyBanner } from '@mlain/ui/patterns/states';
import { useToast } from '@mlain/ui/patterns/toast';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { deleteContactAction, unsubscribeContactAction } from './actions';
import { ContactExportDialog, useContactExport } from './contact-export';
import { emailsToAudience } from './export-audience';
import {
  cancelSnoozeAction,
  resendConfirmationAction,
  type ContactActionResult,
} from './edit-actions';
import { ContactTimeline } from '@/features/reports/timeline/contact-timeline';
import { ConfirmContactButton } from './confirm-contact-button';
import { ProcessingRestrictionButton } from './processing-restriction-button';
import { ResubscribeButton } from './resubscribe-button';
import { describeContactState } from './contact-state';
import { GreetingField } from './greeting-field';
import type { GreetingStatusInput } from './greeting-status';
import { ContactStatusBadges } from './status-badges';
import type { ContactStatus } from './filters';

export type ContactDetailData = {
  id: string;
  email: string;
  name: string | null;
  greeting: string;
  greeting_locked: boolean;
  /**
   * Podklad pro odznak a pro ruční úpravu tvaru. Je to víc než `greeting_locked`:
   * uživatel musí poznat, jestli je tvar potvrzený, odvozený ze slovníku, nebo
   * odhadnutý, a jestli se vokativ v jazyce kontaktu vůbec počítá.
   */
  greeting_status: GreetingStatusInput;
  gender: 'female' | 'male' | 'unknown';
  status: ContactStatus;
  processing_restricted: boolean;
  snooze_until: string | null;
  anonymized_at: string | null;
  status_changed_at: string;
  /**
   * Kdy se omezení zpracování zapnulo a proč. Skládá se z auditního záznamu
   * `contact.processing_restricted`, který vrací `GET /contacts/{id}`.
   *
   * DŘÍV TU BYLO `restriction_requested_at`, které stránka posílala VŽDY jako `null`,
   * takže věta „požádal o omezení {datum}" ukazovala `updated_at`, tedy datum poslední
   * jakékoli změny kontaktu. Po opravě překlepu ve jméně se „datum žádosti" posunulo.
   * Sloupec `contacts.restriction_requested_at` v databázi neexistuje a nikdy
   * neexistoval; jediné místo, které čas i důvod opravdu zná, je audit.
   *
   * `null` znamená, že záznam není (omezení nastavené jinou cestou nebo mimo dosah
   * auditu). Věta pak datum neuvádí, místo aby si nějaké vymýšlela.
   */
  restriction: { restricted_at: string; note: string | null } | null;
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
  workspaceLocale,
  greetingEnabled = true,
  canManageRestriction,
}: {
  basePath: string;
  /**
   * Řeší projekt oslovení a 5. pád? Vypnuto skryje celý blok oslovení včetně
   * odkazu do fronty kontroly. Výchozí `true` je kvůli starším testům.
   */
  greetingEnabled?: boolean;
  /** Kořen projektu, tedy `/w/{slug}`. Odkazy mimo kontakty se skládají z něj. */
  workspacePath: string;
  /**
   * Jazyk projektu. Oslovení se skládá jazykem KONTAKTU, takže rozdíl obou hodnot
   * je jediné vysvětlení, proč se kontakt s českým jménem osloví „Hello Petře".
   * Bez toho ho uživatel na obrazovce nemá kde vyčíst.
   */
  workspaceLocale?: string | undefined;
  /**
   * Identifikátor projektu pro serverové akce. Není to duplicita `workspacePath`:
   * z něj jde slug, ale API chce hlavičku `X-Workspace-Id` s identifikátorem, a bez ní
   * odpoví 404 na kontakt, který existuje.
   */
  workspaceId: string;
  contact: ContactDetailData;
  /**
   * Smí přihlášený člověk sáhnout na omezení zpracování? Rozhoduje `suppressions:write`,
   * tedy oprávnění admina a vlastníka. Stejné oprávnění platí pro zapnutí i zrušení
   * schválně: kdyby zapnutí zvládl editor a zrušení jen admin, editor by uměl vyrobit
   * stav, ze kterého sám nemá cestu ven, a kontakt by mezitím vypadl ze všech kampaní.
   */
  canManageRestriction: boolean;
}) {
  const t = useTranslations('contacts');
  const format = useFormatter();
  const router = useRouter();
  const toast = useToast();
  const confirmLabels = useConfirmDialogLabels();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const contactExport = useContactExport(workspaceId);

  const state = describeContactState(contact);
  const displayName = contact.name ?? contact.email;

  /**
   * Export jednoho kontaktu do CSV.
   *
   * Obě tlačítka, „Exportovat" i „Stáhnout data kontaktu" v dialogu mazání, dřív
   * volala `exportContactAction`, která posílala `{ ids, format: 'both' }`. Klíč
   * `ids` schéma nezná a `both` není platný formát, takže obojí skončilo na 422
   * a nikdy nic nestáhlo. Kontakt se do publika vyjmenuje adresou, protože id
   * do podmínek publika nepatří.
   */
  function startExport() {
    void contactExport.start({
      title: t('detail.actionExport'),
      fileName: contact.email,
      outcome: emailsToAudience([contact.email]),
    });
  }

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
        {/* Potvrzení jednoho kontaktu. Nabídne se u každého stavu kromě `active`
            a `deleted`; u odhlášeného a stěžujícího si se komponenta napřed zeptá
            jedním oknem. Podmínku si drží sama, aby se nemusela opakovat i v seznamu. */}
        <ConfirmContactButton
          workspaceId={workspaceId}
          contactId={contact.id}
          status={contact.status}
          email={contact.email}
        />
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
          {/* Datum se ukazuje JEN když je odkud vzít, tedy z auditního záznamu o zapnutí
              omezení. Dřív se sem dosazovalo `updated_at`, takže věta tvrdila, že člověk
              požádal o omezení v den, kdy mu někdo opravil překlep v příjmení. */}
          <p>
            {contact.restriction === null
              ? t('restricted.bodyNoDate', { name: displayName })
              : t('restricted.body', {
                  name: displayName,
                  date: format.dateTime(new Date(contact.restriction.restricted_at), 'short'),
                })}
          </p>
          {contact.restriction?.note ? (
            <p data-testid="restriction-note">
              {t('restricted.noteShown', { note: contact.restriction.note })}
            </p>
          ) : null}
          {/* Věta o segmentech je tam schválně: uživatel jinak vidí kontakt v seznamu,
              vidí, že splňuje podmínky segmentu, a nechápe, proč se počet nesejde. */}
          <p>{t('restricted.consequence')}</p>
          {/*
            ODKAZ „Zobrazit žádost" TU NENÍ, PROTOŽE TA OBRAZOVKA NEEXISTUJE.

            Kdysi tu byl odkaz na `${workspacePath}/settings/privacy?contact={id}`.
            Adresář `app/[locale]/w/[workspaceSlug]/settings/privacy` v projektu není
            (nastavení má account, ai, api-keys, audit, backups, brand, general, members,
            senders, sending, system-mail a webhooks), takže odkaz vracel 404. Obrazovky
            pro souhlasy a žádosti podle GDPR se stavět nebudou, novou stránku tedy
            nevyrábíme. Odkaz na skutečnou žádost sem patří teprve tehdy, až taková
            obrazovka opravdu vznikne. Do té doby ho sem nevracet.

            MÍSTO VĚTY „POŽÁDEJTE SPRÁVCE SYSTÉMU" JE TU TLAČÍTKO. Zrušení omezení do
            téhle chvíle nešlo nikde v produktu: `liftProcessingRestriction` v doméně
            existovala, ale nevolala ji žádná trasa ani obrazovka. Teď na ni míří
            `DELETE /contacts/{id}/processing-restriction` a tlačítko níž.

            Kdo oprávnění nemá, vidí místo tlačítka větu, koho požádat. Skrýt ho úplně by
            znamenalo, že uživatel neví, jestli akce neexistuje, nebo na ni nemá právo.

            Odkaz do auditu zůstává: `settings/audit` umí filtr `target_id` a ukáže
            záznam `contact.processing_restricted`, tedy kdo a kdy omezení nastavil,
            včetně poznámky v metadatech.
          */}
          {canManageRestriction ? (
            <ProcessingRestrictionButton
              workspaceId={workspaceId}
              contactId={contact.id}
              name={displayName}
              mode="lift"
            />
          ) : (
            <p>{t('restricted.liftForbidden')}</p>
          )}
          {/* Podtržení tu není kosmetika: na barevném podkladu bloku byl odkaz bez něj
              k nerozeznání od okolních vět a vypadal jako další řádek textu. */}
          <Link
            href={`${workspacePath}/settings/audit?target_id=${contact.id}`}
            className="w-fit underline"
          >
            {t('restricted.auditAction')}
          </Link>
        </section>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="flex flex-col gap-6">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            {/* Celý blok oslovení zmizí, když projekt oslovení a 5. pád neřeší.
                Uložená data se tím nemažou: po zapnutí zpátky je řádek přesně
                takový, jaký byl, včetně ručně potvrzeného tvaru. */}
            {greetingEnabled ? (
              <>
                <dt className="text-sm font-medium text-text">{t('detail.addressing')}</dt>
                <dd className="flex flex-col gap-2 text-sm text-text">
                  {/* Hotová věta, tvar, odznak původu a ruční přepis jsou v jedné komponentě.
                      Visací zámek sám o sobě nestačil: říkal jen „někdo to potvrdil", ne
                      „tvar je odhadnutý" ani „jazyk kontaktu 5. pád nemá", což jsou stavy,
                      kvůli kterým uživatel v náhledu šablony vidí 1. pád. */}
                  <GreetingField
                    workspaceId={workspaceId}
                    contactId={contact.id}
                    contact={contact.greeting_status}
                    reviewHref={`${basePath}/vocative-review`}
                    workspaceLocale={workspaceLocale}
                    localeSettingsHref={`${workspacePath}/settings/general`}
                  />
                  {/* Míří na editaci, ne na `/greeting`. Obrazovka `/greeting` v aplikaci
                      NEEXISTUJE (v `app/.../contacts/[id]/` je jen `page.tsx` a `timeline/`),
                      takže tenhle odkaz do téhle chvíle vracel 404. Jméno a rod, ze kterých
                      se oslovení počítá, se mění právě ve formuláři. */}
                  <Link href={`${basePath}/${contact.id}/edit`}>
                    {t('detail.addressingChange')}
                  </Link>
                </dd>
              </>
            ) : null}

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
            {/* Jedno tlačítko, ne jedno na každý seznam.
                Vracení se dělá cestou pro výslovné rozhodnutí správce
                (`POST /contacts/{id}/confirm`), a ta pracuje s kontaktem jako
                celkem: potvrdí ho ve všech seznamech a udělá ho aktivním. Deset
                tlačítek dělajících totéž by jen předstíralo výběr, který neexistuje.
                Kolik seznamů se tím dotkne, řekne okno. */}
            {state.actions.includes('resubscribe') ? (
              <ResubscribeButton
                workspaceId={workspaceId}
                contactId={contact.id}
                listCount={unsubscribedLists.length}
              />
            ) : null}
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
            <Button variant="secondary" onClick={() => startExport()}>
              {t('detail.actionExport')}
            </Button>
            {/* Omezit zpracování se nabízí jen tam, kde to má smysl: u kontaktu, který
                omezený není, není smazaný ani anonymizovaný, a jen tomu, kdo na to má
                oprávnění. U omezeného kontaktu je opačná akce ve žlutém bloku nahoře,
                takže dvě tlačítka k témuž tématu nejsou na obrazovce dvakrát. */}
            {!state.restricted && !state.readOnly && canManageRestriction ? (
              <ProcessingRestrictionButton
                workspaceId={workspaceId}
                contactId={contact.id}
                name={displayName}
                mode="restrict"
              />
            ) : null}
          </div>
        </section>

        {/*
          Časová osa se DOOPRAVDY ČTE, místo aby se kreslilo prázdno.

          Naměřená vada z třídy „napsané, otestované, nezapojené": tohle místo
          vykreslovalo natvrdo prázdný stav a data nikdy nenačetlo, přestože
          doména i endpoint osu umějí a samostatná stránka
          `/contacts/{id}/timeline` ji celou dobu ukazovala. Zdejší komentář to
          i přiznával větou „položky do osy dodá plán P14", jenže ten mezitím
          osu dodal a tohle jediné místo zůstalo viset na zástupném textu.
          Uživatel tedy na detailu viděl „zatím se nic nestalo" u kontaktu,
          který otevřel tři kampaně.

          Komponenta si nadpis, filtry, načítání i vlastní prázdný stav řeší
          sama, takže tady zůstává jen místo pro ni. Vlastní nadpis by byl
          druhý stejný nadpis nad tímtéž obsahem.
        */}
        <section data-testid="contact-timeline" className="flex flex-col gap-2">
          <ContactTimeline contactId={contact.id} />
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
          <Button variant="secondary" onClick={() => startExport()}>
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

      <ContactExportDialog
        state={contactExport.state}
        onDownload={(href, fileName) => void contactExport.download(href, fileName)}
        onClose={contactExport.close}
      />
    </article>
  );
}
