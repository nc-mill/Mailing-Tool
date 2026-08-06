'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { PageHeader } from '@mlain/ui/components/page-header';
import { Select, SelectItem } from '@mlain/ui/components/select';
import { Switch } from '@mlain/ui/components/switch';
import { Textarea } from '@mlain/ui/components/textarea';
import { ChevronRight, CodeXml, ExternalLink, Mail, SquarePen, Trash2 } from '@mlain/ui/icons';
import { ConfirmDialog, type ConfirmDialogLabels } from '@mlain/ui/patterns/feedback';
import { Alert } from '@mlain/ui/patterns/states';
import { emptyDocument } from '@/features/editor/model/document-types';
import { FieldBuilder } from './field-builder';
import { createDeliveryTemplateAction, deleteFormAction, updateFormAction } from './actions';
import type { ContactFieldOption, FormView, ListOption, TemplateOption } from './types';

const NO_LIST = 'none';
/** Sentinel „žádný e-mail". Prázdnou hodnotu si `Select` z radix-ui drží pro „nevybráno". */
const NO_TEMPLATE = 'none';

/** Popisky potvrzovacího dialogu z obecného katalogu, ne z domény formulářů. */
function useConfirmLabels(identifier: string): ConfirmDialogLabels {
  const t = useTranslations('common.confirm');
  return {
    irreversible: t('irreversible'),
    whatHappens: t('whatHappens'),
    notYetConfirmed: t('notYetConfirmed'),
    notYetTyped: t('notYetTyped', { identifier }),
    typeToConfirmMismatch: t('typeToConfirmMismatch'),
    filterInWords: (filter: string) => t('filterInWords', { filter }),
  };
}

/**
 * Karta s jedním přepínačem: název tématu nahoře, přepínač a vysvětlení pod ním.
 *
 * VYSVĚTLENÍ JE POVINNÉ. Ze slov „Formulář sbírá přihlášení" nikdo nepozná, co
 * se stane s formulářem, který už je vložený na cizím webu. Rozvržení je z karet
 * „Nabízet příjemcům" a „Potvrzení přihlášení" na detailu seznamu, aby se dvě
 * obrazovky téhož systému nelišily v tom, jak vypadá tatáž věc.
 *
 * Přístupný název přepínače nese `aria-label`, ne viditelný popisek: nadpis karty
 * a popisek by byly totéž slovo dvakrát pod sebou. Seznam si na tomtéž místě
 * ukazuje stav („Seznam se nabízí" / „Seznam se nenabízí"), formuláře takovou
 * dvojici textů v katalogu nemají a vymýšlet ji do návrhu nepatří.
 */
function SwitchCard({
  id,
  title,
  hint,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  title: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  return (
    <Card gap="gutter">
      <CardTitle>{title}</CardTitle>
      <div className="flex items-start gap-3">
        <Switch
          id={id}
          checked={checked}
          disabled={disabled}
          aria-label={title}
          onCheckedChange={onCheckedChange}
        />
        <span className="text-meta text-text-muted">{hint}</span>
      </div>
    </Card>
  );
}

/**
 * Detail formuláře: nastavení, která uživatel opravdu mění.
 *
 * VZHLED JE ODVOZENÝ Z DETAILU SEZNAMU (`Mlain Mailer - Seznamy.dc.html`,
 * větev `isDetail`). Formuláře návrh nemají a detail seznamu je jim nejblíž:
 * je to taky pojmenovaná věc s hrstkou nastavení, u kterých je vysvětlení
 * důležitější než samotný přepínač. Přebírá se odtud drobečková navigace,
 * hlavička s mono meta řádkem, dva sloupce od 360 px na sloupec a rozdělení
 * nastavení do karet po tématech místo jedné dlouhé formulářové stěny.
 *
 * Ukládá se PO POLÍCH, ne jedním tlačítkem „Uložit" dole. Formulář je sada
 * nezávislých přepínačů a jméno; jedno velké uložení by znamenalo, že přepnutí
 * potvrzování e-mailem čeká na to, až uživatel doklikne zbytek obrazovky.
 * Textová pole se ukládají při opuštění pole, přepínače hned. Proto v hlavičce
 * NENÍ „Uložit údaje" jako u seznamu a hlavní akcí je „Vložit na web": to je
 * důvod, proč formulář vůbec vzniká.
 */
export function FormEditor({
  form,
  lists,
  templates,
  contactFields,
  workspaceId,
  workspaceSlug,
  basePath,
  canEdit,
}: {
  form: FormView;
  lists: ListOption[];
  /** Šablony, ze kterých jde vybrat e-mail po vyplnění. */
  templates: TemplateOption[];
  /** Katalog vlastních polí kontaktu pro stavitele polí. */
  contactFields: ContactFieldOption[];
  workspaceId: string;
  /** Slug projektu. Odkaz do editoru e-mailů leží mimo sekci formulářů. */
  workspaceSlug: string;
  /** Cesta k sekci formulářů bez slugu projektu, například `/w/muj-projekt/forms`. */
  basePath: string;
  canEdit: boolean;
}) {
  const t = useTranslations('contacts');
  const tf = useTranslations('forms.editor');
  const tn = useTranslations('forms.create');
  const te = useTranslations('forms.email');
  const tc = useTranslations('common.actions');
  const ta = useTranslations('common.a11y');
  const locale = useLocale();
  const router = useRouter();
  const confirmLabels = useConfirmLabels(form.name);

  const [name, setName] = useState(form.name);
  const [consentText, setConsentText] = useState(form.consent_text ?? '');
  const [doubleOptIn, setDoubleOptIn] = useState(form.double_opt_in);
  const [active, setActive] = useState(form.active);
  const [listId, setListId] = useState(form.list_ids[0] ?? NO_LIST);
  const [templateId, setTemplateId] = useState(form.delivery_template_id ?? NO_TEMPLATE);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  /*
   * Co se stane po odeslání. Obojí je v API i ve schématu od začátku a do
   * 5. 8. 2026 to v editoru nebylo vůbec, takže se to nedalo nastavit odnikud.
   *
   * Zpráva se drží PRO AKTUÁLNÍ JAZYK rozhraní, protože sloupec je mapa jazyků.
   * Ukládá se sloučením, ne přepsáním celé mapy: jinak by úprava v češtině
   * smazala anglickou verzi, kterou nikdo neviděl.
   */
  const [redirectUrl, setRedirectUrl] = useState(form.redirect_url ?? '');
  const [successMessage, setSuccessMessage] = useState(form.success_message[locale] ?? '');

  /**
   * Založí e-mail, naváže ho na formulář a rovnou otevře editor. Uživatel klikl
   * „vytvořit e-mail", takže dalším krokem je psaní, ne návrat na tuhle obrazovku.
   */
  async function createEmail() {
    setCreating(true);
    setFailure(null);
    try {
      const name = te('newName', { name: form.name });
      const result = await createDeliveryTemplateAction({
        workspaceId,
        formId: form.id,
        name,
        document: emptyDocument(locale, name),
      });
      if (result.status === 'error') {
        setFailure(result.detail === '' ? te('createFailed') : result.detail);
        return;
      }
      router.push(`/w/${workspaceSlug}/templates/${result.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function save(body: Parameters<typeof updateFormAction>[0]['body']): Promise<boolean> {
    setBusy(true);
    setFailure(null);
    try {
      const result = await updateFormAction({ workspaceId, id: form.id, body });
      if (result.status === 'error') {
        setFailure(result.detail === '' ? tf('failed') : result.detail);
        return false;
      }
      // `revalidatePath` v serverové akci sám obrazovku nepřekreslí, protože akci
      // voláme imperativně, ne přes `<form action>`. Musí následovat `refresh`.
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setFailure(null);
    try {
      const result = await deleteFormAction({ workspaceId, id: form.id });
      if (result.status === 'error') {
        setFailure(result.detail === '' ? tf('failed') : result.detail);
        return;
      }
      setConfirmDelete(false);
      router.push(basePath);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeaderBlock
        basePath={basePath}
        breadcrumbsLabel={ta('breadcrumbs')}
        sectionLabel={t('forms.title')}
        name={form.name}
        meta={tf('signups', { count: form.submission_count })}
        actions={
          <>
            {/* Veřejná stránka leží mimo routování s jazykem (`/f/{slug}`), takže
                se na ni odkazuje obyčejným <a>, ne obálkou z `@mlain/i18n`. */}
            <Button asChild variant="secondary">
              <a
                href={form.hosted_url}
                target="_blank"
                rel="noreferrer"
                data-testid="open-public-form"
              >
                <ExternalLink aria-hidden className="icon-md" />
                {tf('openPublic')}
              </a>
            </Button>
            {/* Hlavní akce je poslední, tedy nejblíž kraji. */}
            <Button asChild variant="primary">
              <Link href={`${basePath}/${form.id}/embed`}>
                <CodeXml aria-hidden className="icon-md" />
                {tf('openEmbed')}
              </Link>
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-[var(--spacing-gutter)]">
        {failure !== null && (
          <Alert tone="error" data-testid="form-editor-error">
            {failure}
          </Alert>
        )}

        {/* Dva sloupce od 360 px na sloupec. `items-start` je podstatné: bez něj by se
            karty v jednom sloupci roztáhly na výšku toho druhého. */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(360px,1fr))] items-start gap-[var(--spacing-gutter)]">
          <div className="flex flex-col gap-[var(--spacing-gutter)]">
            <Card gap="gutter">
              <CardTitle>{tf('settings')}</CardTitle>

              <Field label={t('forms.name')}>
                <Input
                  data-testid="form-name"
                  value={name}
                  disabled={!canEdit}
                  onChange={(event) => setName(event.target.value)}
                  onBlur={() => {
                    if (name.trim() !== '' && name !== form.name) void save({ name: name.trim() });
                  }}
                />
              </Field>

              <div data-testid="form-list-select" className="flex flex-col gap-1.5">
                <span aria-hidden className="text-sm font-semibold text-text">
                  {t('forms.targetList')}
                </span>
                <Select
                  value={listId}
                  onValueChange={(next) => {
                    setListId(next);
                    void save({ list_ids: next === NO_LIST ? [] : [next] });
                  }}
                  placeholder={tn('listNone')}
                  aria-label={t('forms.targetList')}
                >
                  <SelectItem value={NO_LIST}>{tn('listNone')}</SelectItem>
                  {lists.map((list) => (
                    <SelectItem key={list.id} value={list.id}>
                      {list.name}
                    </SelectItem>
                  ))}
                </Select>
              </div>

              <Field label={tf('successMessage')} hint={tf('successMessageHint')}>
                <Textarea
                  data-testid="form-success-message"
                  rows={2}
                  value={successMessage}
                  maxLength={200}
                  disabled={!canEdit}
                  onChange={(event) => setSuccessMessage(event.target.value)}
                  onBlur={() => {
                    const next = successMessage.trim();
                    if (next === (form.success_message[locale] ?? '')) return;
                    // Sloučení, ne přepis: ostatní jazyky se tímhle polem needitují.
                    void save({ success_message: { ...form.success_message, [locale]: next } });
                  }}
                />
              </Field>

              <Field label={tf('redirectUrl')} hint={tf('redirectUrlHint')}>
                <Input
                  data-testid="form-redirect-url"
                  type="url"
                  value={redirectUrl}
                  placeholder="https://"
                  // Adresa se čte po znacích, proto mono. Stejně jako přesměrování
                  // na detailu seznamu.
                  className="font-mono"
                  disabled={!canEdit}
                  onChange={(event) => setRedirectUrl(event.target.value)}
                  onBlur={() => {
                    // Prázdné pole je „zůstane naše stránka", tedy `null`, ne prázdný
                    // řetězec: `redirect_url` je v API validované jako URL a prázdný
                    // řetězec by skončil čtyřistadvacítkou.
                    const next = redirectUrl.trim() === '' ? null : redirectUrl.trim();
                    if (next !== form.redirect_url) void save({ redirect_url: next });
                  }}
                />
              </Field>

              <Field label={tf('consent')} hint={tf('consentHint')}>
                <Textarea
                  data-testid="form-consent"
                  rows={3}
                  value={consentText}
                  disabled={!canEdit}
                  onChange={(event) => setConsentText(event.target.value)}
                  onBlur={() => {
                    const next = consentText.trim() === '' ? null : consentText;
                    if (next !== form.consent_text) void save({ consent_text: next });
                  }}
                />
              </Field>
            </Card>
          </div>

          <div className="flex flex-col gap-[var(--spacing-gutter)]">
            {/* Zapnutí a vypnutí sběru. Vlastní karta, protože to není údaj mezi
                údaji: pozastavený formulář se navenek tváří jako neexistující. */}
            <SwitchCard
              id="form-active"
              title={tf('active')}
              hint={tf('activeHint')}
              checked={active}
              disabled={!canEdit}
              onCheckedChange={(next) => {
                setActive(next);
                void save({ active: next });
              }}
            />

            <SwitchCard
              id="form-doi"
              title={t('forms.doubleOptIn')}
              hint={t('forms.doubleOptInHint')}
              checked={doubleOptIn}
              disabled={!canEdit}
              onCheckedChange={(next) => {
                // Vypnutí je krok k horšímu a vyžaduje potvrzení. Zapnutí zpátky ne:
                // potvrzovat bezpečnější volbu je jen tření navíc.
                if (next) {
                  setDoubleOptIn(true);
                  void save({ double_opt_in: true });
                  return;
                }
                setConfirmDisable(true);
              }}
            />

            {/*
             * Krok „co člověku přijde". Je to důvod, proč si většina lidí formulář
             * na web dává: nech mi adresu a já ti pošlu e-book. Obsah se skládá
             * v editoru e-mailů, tady se jen vybírá a otevírá.
             */}
            <Card gap="gutter" data-testid="form-email-section">
              <CardTitle>{te('title')}</CardTitle>

              <div className="flex flex-col gap-[var(--spacing-hairline)]">
                <p className="text-meta text-text-muted">{te('ebookHint')}</p>
                {/* Kdy e-mail odejde, závisí na potvrzování adresy. Uživatel to musí
                    vědět dřív, než bude hledat, proč nic nedorazilo. */}
                <p className="text-meta text-text-muted" data-testid="form-email-timing">
                  {doubleOptIn ? te('hintDoubleOptIn') : te('hintDirect')}
                </p>
                {/*
                  Rozdíl mezi potvrzovacím a uvítacím e-mailem patří NA OBRAZOVKU, ne do
                  nápovědy: kdo si myslí, že tady nastavuje potvrzovací e-mail, dá odkaz
                  ke stažení tomu, kdo teprve ověřuje adresu.
                */}
                <p className="text-meta text-text-muted" data-testid="form-email-kind">
                  {te('confirmVsWelcome')}
                </p>
                <p className="text-meta text-text-muted">{te('sharedWithList')}</p>
              </div>

              <div data-testid="form-template-select" className="flex flex-col gap-1.5">
                <span aria-hidden className="text-sm font-semibold text-text">
                  {te('select')}
                </span>
                <Select
                  value={templateId}
                  onValueChange={(next) => {
                    setTemplateId(next);
                    void save({ delivery_template_id: next === NO_TEMPLATE ? null : next });
                  }}
                  placeholder={te('none')}
                  aria-label={te('select')}
                >
                  <SelectItem value={NO_TEMPLATE}>{te('none')}</SelectItem>
                  {templates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </Select>
              </div>

              <div className="flex flex-wrap items-center gap-[var(--spacing-inline)]">
                {templateId !== NO_TEMPLATE && (
                  <Link
                    href={`/w/${workspaceSlug}/templates/${templateId}`}
                    className="inline-flex items-center gap-[var(--spacing-inline)] text-ui"
                    data-testid="edit-delivery-template"
                  >
                    <SquarePen aria-hidden className="icon-sm shrink-0" />
                    {te('edit')}
                  </Link>
                )}
                {canEdit && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="ml-auto"
                    data-testid="create-delivery-template"
                    pending={creating}
                    pendingLabel={te('creating')}
                    onClick={() => void createEmail()}
                  >
                    <Mail aria-hidden className="icon-sm" />
                    {te('create')}
                  </Button>
                )}
              </div>
            </Card>
          </div>
        </div>

        {/* Stavitel polí stojí přes celou šířku pod dvěma sloupci: má vlastní
            dvousloupcové rozvržení (pole vlevo, náhled vpravo) a v úzkém sloupci
            by náhled nebyl k ničemu. */}
        <FieldBuilder
          formId={form.id}
          workspaceId={workspaceId}
          fields={form.fields}
          contactFields={contactFields}
          locale={locale}
          canEdit={canEdit}
        />

        {canEdit && (
          <div>
            <Button
              variant="destructive"
              data-testid="delete-form"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 aria-hidden className="icon-md" />
              {tf('delete')}
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDisable}
        onOpenChange={setConfirmDisable}
        level="N2"
        title={t('forms.doubleOptInDisableTitle')}
        consequences={[t('forms.doubleOptInDisableBody')]}
        confirmLabel={t('forms.doubleOptInDisableConfirm')}
        cancelLabel={t('forms.doubleOptInDisableCancel')}
        // Vypnout a zase zapnout jde kdykoliv, takže věta „tohle nejde vzít zpět"
        // by tu byla lež. Váha rozhodnutí je ve formulaci následku, ne v nálepce.
        irreversible={false}
        labels={confirmLabels}
        onConfirm={async () => {
          setConfirmDisable(false);
          setDoubleOptIn(false);
          await save({ double_opt_in: false });
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        level="N2"
        title={tf('deleteTitle', { name: form.name })}
        consequences={[
          tf('deleteConsequenceForm'),
          tf('deleteConsequenceSubmissions'),
          tf('deleteConsequenceAlternative'),
        ]}
        confirmLabel={tf('deleteConfirm')}
        cancelLabel={tc('cancel')}
        labels={confirmLabels}
        onConfirm={() => void remove()}
      />

      {busy && (
        <p role="status" className="sr-only">
          {tc('save')}
        </p>
      )}
    </>
  );
}

/**
 * Hlavička detailu formuláře. Vlastní obálka nad `PageHeader` jen proto, aby
 * drobečková navigace nebyla uprostřed sedmdesátiřádkového JSX; vzhled i pořadí
 * prvků jsou z `PageHeader` a z detailu seznamu.
 */
function PageHeaderBlock({
  basePath,
  breadcrumbsLabel,
  sectionLabel,
  name,
  meta,
  actions,
}: {
  basePath: string;
  breadcrumbsLabel: string;
  sectionLabel: string;
  name: string;
  meta: string;
  actions: React.ReactNode;
}) {
  return (
    <PageHeader
      title={name}
      meta={meta}
      breadcrumbs={
        <nav aria-label={breadcrumbsLabel} className="flex items-center gap-2">
          <Link href={basePath} className="text-sm underline-offset-[3px]">
            {sectionLabel}
          </Link>
          <ChevronRight aria-hidden className="icon-xs shrink-0 text-border-strong" />
          <span className="min-w-0 truncate font-mono text-meta text-text-muted">{name}</span>
        </nav>
      }
      actions={actions}
    />
  );
}
