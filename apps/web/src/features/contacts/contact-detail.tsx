'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Card, CardHeader, CardTitle } from '@mlain/ui/components/card';
import { IconButton } from '@mlain/ui/components/icon-button';
import { PageHeader } from '@mlain/ui/components/page-header';
import { Tooltip } from '@mlain/ui/components/tooltip';
import {
  ChevronRight,
  Download,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
  UserMinus,
} from '@mlain/ui/icons';
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
import { offersManualConfirm } from './confirm-state';
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

/**
 * Popisek údaje v kartě. Mřížka `120px` je z návrhu: v tom sloupci stojí
 * všechny popisky pod sebou a hodnoty vedle nich začínají na jedné svislici
 * napříč všemi třemi kartami levého sloupce.
 */
const DEFINITION_GRID = 'grid grid-cols-[120px_minmax(0,1fr)] gap-x-[var(--spacing-gutter)]';

/**
 * Zařazení kontaktu: seznam nebo štítek jako plocha se jménem.
 *
 * NENÍ TO `Badge` ANI `Tag`. Odznak nese stav položky a štítek je 11px doplněk
 * k údaji vedle sebe; tohle je 14px jméno věci, do které kontakt patří, a v
 * návrhu má vlastní vzhled (plná plocha, rádius jako u tlačítka). Barva nese
 * stav přihlášení, ne libovůli: čekající a odhlášené se od potvrzeného musí
 * poznat, jinak karta tvrdí, že kontakt seznam odebírá, i když se odhlásil.
 */
function MembershipChip({
  tone,
  children,
}: {
  tone: 'success' | 'accent' | 'neutral';
  children: React.ReactNode;
}) {
  const TONE = {
    success: 'bg-success-surface text-success-text',
    accent: 'bg-accent-surface text-warning-text',
    neutral: 'bg-surface-muted text-text-muted',
  } as const;

  return (
    <span
      className={`inline-flex items-center rounded-[var(--radius-control)] px-2.5 py-0.5 text-sm ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * Žlutý blok nad obsahem: ikona, vysvětlení, akce vpravo.
 *
 * Je to `Card tone="highlight"`, ne `Alert`: hláška má v systému vlevo silnou
 * linku a zbytek papírový, kdežto tenhle blok je celý žlutý a nese vlastní
 * tlačítko. V návrhu detailu je to jediný prvek, který takhle vypadá, a stojí
 * v něm stav, kvůli kterému se kontaktu neposílá.
 */
function NoticeBanner({
  icon,
  actions,
  children,
  ...rest
}: {
  icon: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
} & Omit<React.ComponentPropsWithoutRef<'section'>, 'children' | 'className'>) {
  return (
    <Card
      tone="highlight"
      padding="none"
      gap="none"
      className="mb-[var(--spacing-gutter)] flex-row flex-wrap items-start gap-[var(--spacing-gutter)] px-[var(--spacing-card-tight)] py-[var(--spacing-gutter)]"
      {...rest}
    >
      <span
        aria-hidden
        className="inline-flex size-[var(--size-control-sm)] shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-panel text-primary"
      >
        {icon}
      </span>
      <div className="grid min-w-0 flex-1 gap-[var(--spacing-hairline)]">{children}</div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-[var(--spacing-inline)]">{actions}</div>
      ) : null}
    </Card>
  );
}

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
  const tCommon = useTranslations('common');
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

  /**
   * Akce vázané na STAV kontaktu, tedy ty, které stojí ve žlutém bloku vedle věty
   * o tom, proč se kontaktu neposílá. Do řady ikon v hlavičce nepatří: každá z nich
   * se nabízí jen v jednom stavu a bez té věty vedle sebe nedává smysl.
   */
  const statusActions = (
    <>
      {/* Potvrzení jednoho kontaktu. Nabídne se u každého stavu kromě `active`
          a `deleted`; u odhlášeného a stěžujícího si se komponenta napřed zeptá
          jedním oknem. Podmínku si drží sama, aby se nemusela opakovat i v seznamu. */}
      <ConfirmContactButton
        workspaceId={workspaceId}
        contactId={contact.id}
        status={contact.status}
        email={contact.email}
        variant="banner"
      />
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
    </>
  );

  const hasStatusActions =
    offersManualConfirm(contact.status) ||
    state.actions.includes('resendConfirmation') ||
    state.actions.includes('resubscribe') ||
    state.actions.includes('openSuppressions') ||
    state.actions.includes('cancelSnooze');

  return (
    <article>
      <PageHeader
        breadcrumbs={
          <nav aria-label={tCommon('a11y.breadcrumbs')} className="flex items-center gap-2">
            <Link href={basePath} className="text-sm">
              {t('detail.back')}
            </Link>
            <ChevronRight aria-hidden className="icon-xs text-border-strong" />
            <span className="font-mono text-meta text-text-muted">{contact.email}</span>
          </nav>
        }
        title={displayName}
        // Meta řádek nese odznak stavu, a ten je vyšší než text, takže se pod
        // nadpisem drží 10 px místo obvyklých 5 px. Přesně tak to má návrh.
        titleGap="lg"
        meta={
          <span className="flex flex-wrap items-center gap-3">
            <ContactStatusBadges badges={state.badges} />
            <span>{contact.email}</span>
            {contact.subscribed_at === null ? null : (
              <span>
                {'· '}
                {t('detail.added', {
                  date: format.dateTime(new Date(contact.subscribed_at), 'short'),
                })}
              </span>
            )}
          </span>
        }
        actions={
          <>
            {/* Bublina nese jméno akce; `title` by nad ní vykreslil druhou,
                prohlížečovou, takže se vypíná prázdnou hodnotou. */}
            <Tooltip content={t('detail.actionExport')}>
              <IconButton
                variant="solid"
                label={t('detail.actionExport')}
                title=""
                icon={<Download aria-hidden className="icon-md" />}
                onClick={() => startExport()}
              />
            </Tooltip>
            {state.actions.includes('unsubscribe') && subscribedLists.length > 0 ? (
              <Tooltip content={t('detail.actionUnsubscribe')}>
                <IconButton
                  variant="solid"
                  label={t('detail.actionUnsubscribe')}
                  title=""
                  icon={<UserMinus aria-hidden className="icon-md" />}
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
                />
              </Tooltip>
            ) : null}
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
                appearance="icon"
              />
            ) : null}
            {state.actions.includes('delete') ? (
              <Tooltip content={t('detail.actionDelete')}>
                <IconButton
                  variant="danger"
                  label={t('detail.actionDelete')}
                  title=""
                  icon={<Trash2 aria-hidden className="icon-md" />}
                  onClick={() => setDeleteOpen(true)}
                />
              </Tooltip>
            ) : null}
            {state.actions.includes('edit') ? (
              <Button
                variant="primary"
                onClick={() => router.push(`${basePath}/${contact.id}/edit`)}
              >
                <Pencil aria-hidden className="icon-md" />
                {t('detail.actionEdit')}
              </Button>
            ) : null}
          </>
        }
      />

      {state.readOnly ? (
        <ReadOnlyBanner reason={t('detail.readOnly')} className="mb-[var(--spacing-gutter)]" />
      ) : null}

      {/* Stav, kvůli kterému se kontaktu neposílá, a akce, které z něj vedou ven.
          U aktivního kontaktu bez příznaků tenhle blok není vůbec. */}
      {state.notes.length > 0 || hasStatusActions ? (
        <NoticeBanner
          data-testid="contact-status-notice"
          icon={<TriangleAlert className="icon-md" />}
          {...(hasStatusActions ? { actions: statusActions } : {})}
        >
          {state.notes.map((note) => (
            <p key={note.textKey} className="text-base font-semibold text-text">
              {t(note.textKey, { date: format.dateTime(new Date(note.values['date']!), 'short') })}
            </p>
          ))}
          {/* Vysvětlení ručního potvrzení stojí u věty, ne pod tlačítkem: v tomhle
              bloku je tlačítko vpravo a odstavec pod ním by blok roztáhl natřikrát. */}
          {offersManualConfirm(contact.status) ? (
            <p className="text-sm text-warning-text">{t('confirmState.hint')}</p>
          ) : null}
        </NoticeBanner>
      ) : null}

      {state.restricted ? (
        <NoticeBanner
          data-testid="contact-restricted"
          icon={<TriangleAlert className="icon-md" />}
          actions={
            /*
              MÍSTO VĚTY „POŽÁDEJTE SPRÁVCE SYSTÉMU" JE TU TLAČÍTKO. Zrušení omezení do
              téhle chvíle nešlo nikde v produktu: `liftProcessingRestriction` v doméně
              existovala, ale nevolala ji žádná trasa ani obrazovka. Teď na ni míří
              `DELETE /contacts/{id}/processing-restriction` a tlačítko níž.

              Kdo oprávnění nemá, vidí místo tlačítka větu, koho požádat. Skrýt ho úplně by
              znamenalo, že uživatel neví, jestli akce neexistuje, nebo na ni nemá právo.
            */
            canManageRestriction ? (
              <ProcessingRestrictionButton
                workspaceId={workspaceId}
                contactId={contact.id}
                name={displayName}
                mode="lift"
              />
            ) : null
          }
        >
          <CardTitle>{t('restricted.title')}</CardTitle>
          {/* Datum se ukazuje JEN když je odkud vzít, tedy z auditního záznamu o zapnutí
              omezení. Dřív se sem dosazovalo `updated_at`, takže věta tvrdila, že člověk
              požádal o omezení v den, kdy mu někdo opravil překlep v příjmení. */}
          <p className="text-ui text-text">
            {contact.restriction === null
              ? t('restricted.bodyNoDate', { name: displayName })
              : t('restricted.body', {
                  name: displayName,
                  date: format.dateTime(new Date(contact.restriction.restricted_at), 'short'),
                })}
          </p>
          {contact.restriction?.note ? (
            <p data-testid="restriction-note" className="text-ui text-text">
              {t('restricted.noteShown', { note: contact.restriction.note })}
            </p>
          ) : null}
          {/* Věta o segmentech je tam schválně: uživatel jinak vidí kontakt v seznamu,
              vidí, že splňuje podmínky segmentu, a nechápe, proč se počet nesejde. */}
          <p className="text-sm text-warning-text">{t('restricted.consequence')}</p>
          {canManageRestriction ? null : (
            <p className="text-sm text-warning-text">{t('restricted.liftForbidden')}</p>
          )}
          {/*
            ODKAZ „Zobrazit žádost" TU NENÍ, PROTOŽE TA OBRAZOVKA NEEXISTUJE.

            Kdysi tu byl odkaz na `${workspacePath}/settings/privacy?contact={id}`.
            Adresář `app/[locale]/w/[workspaceSlug]/settings/privacy` v projektu není
            (nastavení má account, ai, api-keys, audit, backups, brand, general, members,
            senders, sending, system-mail a webhooks), takže odkaz vracel 404. Obrazovky
            pro souhlasy a žádosti podle GDPR se stavět nebudou, novou stránku tedy
            nevyrábíme. Odkaz na skutečnou žádost sem patří teprve tehdy, až taková
            obrazovka opravdu vznikne. Do té doby ho sem nevracet.

            Odkaz do auditu zůstává: `settings/audit` umí filtr `target_id` a ukáže
            záznam `contact.processing_restricted`, tedy kdo a kdy omezení nastavil,
            včetně poznámky v metadatech.
          */}
          <Link
            href={`${workspacePath}/settings/audit?target_id=${contact.id}`}
            className="w-fit text-sm"
          >
            {t('restricted.auditAction')}
          </Link>
        </NoticeBanner>
      ) : null}

      {/* Levý sloupec je kdo to je, pravý co s ním proběhlo. Mřížka se při zúžení
          okna rozpadne pod sebe sama, proto `auto-fit` a ne dva pevné sloupce. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] items-start gap-[var(--spacing-gutter)]">
        <div className="grid gap-[var(--spacing-gutter)]">
          {/* Celý blok oslovení zmizí, když projekt oslovení a 5. pád neřeší.
              Uložená data se tím nemažou: po zapnutí zpátky je řádek přesně
              takový, jaký byl, včetně ručně potvrzeného tvaru. */}
          {greetingEnabled ? (
            <Card>
              <CardHeader title={t('detail.addressing')} />
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
              <dl
                className={`${DEFINITION_GRID} items-center gap-y-[var(--spacing-inline)] border-t border-border pt-[var(--spacing-stack)]`}
              >
                <dt className="meta-caps text-text-muted">{t('detail.gender')}</dt>
                <dd className="text-ui text-text">{t(GENDER_KEY[contact.gender])}</dd>
              </dl>
              {/* Míří na editaci, ne na `/greeting`. Obrazovka `/greeting` v aplikaci
                  NEEXISTUJE (v `app/.../contacts/[id]/` je jen `page.tsx` a `timeline/`),
                  takže tenhle odkaz do téhle chvíle vracel 404. Jméno a rod, ze kterých
                  se oslovení počítá, se mění právě ve formuláři. */}
              <Link href={`${basePath}/${contact.id}/edit`} className="w-fit text-sm">
                {t('detail.addressingChange')}
              </Link>
            </Card>
          ) : null}

          <Card>
            <CardHeader title={t('detail.sectionMembership')} />
            <dl className={`${DEFINITION_GRID} items-center gap-y-[var(--spacing-stack)]`}>
              <dt className="meta-caps text-text-muted">{t('detail.lists')}</dt>
              <dd className="flex flex-wrap items-center gap-2 text-ui text-text">
                {contact.lists.length === 0 ? (
                  <span className="text-border-strong">{t('detail.noLists')}</span>
                ) : (
                  contact.lists.map((list) => (
                    <MembershipChip
                      key={list.id}
                      tone={
                        list.status === 'unsubscribed'
                          ? 'neutral'
                          : list.status === 'pending'
                            ? 'accent'
                            : 'success'
                      }
                    >
                      {list.name}
                    </MembershipChip>
                  ))
                )}
              </dd>
              <dt className="meta-caps text-text-muted">{t('detail.tags')}</dt>
              <dd className="flex flex-wrap items-center gap-2 text-ui text-text">
                {contact.tags.length === 0 ? (
                  <span className="text-border-strong">{t('detail.noTags')}</span>
                ) : (
                  contact.tags.map((tag) => (
                    <MembershipChip key={tag.id} tone="neutral">
                      {tag.name}
                    </MembershipChip>
                  ))
                )}
                {/* Štítky se přidávají v úpravě kontaktu, ne odsud: samostatná cesta
                    „přidat štítek jednomu kontaktu" v API neexistuje a tlačítko, které
                    nemá co zavolat, je horší než odkaz tam, kde se to opravdu dělá. */}
                {state.readOnly ? null : (
                  <Link
                    href={`${basePath}/${contact.id}/edit`}
                    aria-label={t('detail.tagsAdd')}
                    className="inline-flex size-[var(--size-control-2xs)] items-center justify-center rounded-[var(--radius-control)] border border-border text-text-muted no-underline hover:bg-surface-muted hover:text-text"
                  >
                    <Plus aria-hidden className="icon-sm" />
                  </Link>
                )}
              </dd>
            </dl>
          </Card>

          {state.showsPersonalData && contact.attributes.length > 0 ? (
            <Card>
              <CardHeader title={t('detail.sectionData')} />
              <dl className={`${DEFINITION_GRID} items-center gap-y-[var(--spacing-stack)]`}>
                {contact.attributes.map((attribute) => (
                  <div key={attribute.key} className="contents">
                    <dt className="meta-caps text-text-muted">{attribute.label}</dt>
                    <dd className="text-ui text-text">{attribute.value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          ) : null}

          <Card>
            <CardHeader title={t('detail.sectionOrigin')} />
            <dl className={`${DEFINITION_GRID} items-center gap-y-3`}>
              <dt className="meta-caps text-text-muted">{t('detail.source')}</dt>
              <dd className="font-mono text-sm text-text">{contact.source}</dd>
              {contact.subscribed_at ? (
                <>
                  <dt className="meta-caps text-text-muted">{t('detail.subscribedAt')}</dt>
                  <dd className="text-ui text-text">
                    <time dateTime={contact.subscribed_at}>
                      {format.dateTime(new Date(contact.subscribed_at), 'short')}
                    </time>
                  </dd>
                </>
              ) : null}
              {contact.consent_summary ? (
                <>
                  <dt className="meta-caps text-text-muted">{t('detail.consent')}</dt>
                  <dd className="flex flex-wrap items-center gap-3 text-text">
                    <span className="font-mono text-sm">{contact.consent_summary}</span>
                    <Link href={`${basePath}/${contact.id}/consents`} className="text-sm">
                      {t('detail.consentHistory')}
                    </Link>
                  </dd>
                </>
              ) : null}
            </dl>
          </Card>
        </div>

        {/*
          Časová osa se DOOPRAVDY ČTE, místo aby se kreslilo prázdno.

          Naměřená vada z třídy „napsané, otestované, nezapojené": tohle místo
          vykreslovalo natvrdo prázdný stav a data nikdy nenačetlo, přestože
          doména i endpoint osu umějí a samostatná stránka
          `/contacts/{id}/timeline` ji celou dobu ukazovala.

          Komponenta si kartu, nadpis, filtry, počet, načítání i vlastní prázdný
          stav řeší sama, takže tady zůstává jen místo pro ni.
        */}
        <div data-testid="contact-timeline">
          <ContactTimeline contactId={contact.id} />
        </div>
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
