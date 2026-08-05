'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { Select, SelectItem } from '@mlain/ui/components/select';
import { Switch } from '@mlain/ui/components/switch';
import { Textarea } from '@mlain/ui/components/textarea';
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
 * Detail formuláře: nastavení, která uživatel opravdu mění.
 *
 * Ukládá se PO POLÍCH, ne jedním tlačítkem „Uložit" dole. Formulář je sada
 * nezávislých přepínačů a jméno; jedno velké uložení by znamenalo, že přepnutí
 * potvrzování e-mailem čeká na to, až uživatel doklikne zbytek obrazovky.
 * Textová pole se ukládají při opuštění pole, přepínače hned.
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
    <section className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={basePath} className="text-sm text-text-muted underline">
          {tf('back')}
        </Link>
        <h1 className="text-xl font-semibold text-text">{form.name}</h1>
        <p className="text-sm text-text-muted">{tf('signups', { count: form.submission_count })}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href={`${basePath}/${form.id}/embed`}
          className="inline-flex items-center rounded-[var(--radius-control)] border border-border-strong px-3 py-2 text-sm"
        >
          {tf('openEmbed')}
        </Link>
        {/* Veřejná stránka leží mimo routování s jazykem (`/f/{slug}`), takže
            se na ni odkazuje obyčejným <a>, ne obálkou z `@mlain/i18n`. */}
        <a
          href={form.hosted_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center rounded-[var(--radius-control)] border border-border-strong px-3 py-2 text-sm"
          data-testid="open-public-form"
        >
          {tf('openPublic')}
        </a>
      </div>

      {failure !== null && (
        <Alert tone="error" data-testid="form-editor-error">
          {failure}
        </Alert>
      )}

      <div className="flex flex-col gap-5 rounded-[var(--radius-surface)] border border-border p-5">
        <h2 className="text-lg font-medium text-text">{tf('settings')}</h2>

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

        <div data-testid="form-list-select">
          <span aria-hidden className="mb-1 block text-sm font-medium text-text">
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

        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="form-doi">{t('forms.doubleOptIn')}</Label>
            <p className="text-sm text-text-muted">{t('forms.doubleOptInHint')}</p>
          </div>
          <Switch
            id="form-doi"
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
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="form-active">{tf('active')}</Label>
            <p className="text-sm text-text-muted">{tf('activeHint')}</p>
          </div>
          <Switch
            id="form-active"
            checked={active}
            disabled={!canEdit}
            onCheckedChange={(next) => {
              setActive(next);
              void save({ active: next });
            }}
          />
        </div>

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
      </div>

      {/*
       * Krok „co člověku přijde". Je to důvod, proč si většina lidí formulář
       * na web dává: nech mi adresu a já ti pošlu e-book. Obsah se skládá
       * v editoru e-mailů, tady se jen vybírá a otevírá.
       */}
      <div
        className="flex flex-col gap-4 rounded-[var(--radius-surface)] border border-border p-5"
        data-testid="form-email-section"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-medium text-text">{te('title')}</h2>
          <p className="text-sm text-text-muted">{te('ebookHint')}</p>
          {/* Kdy e-mail odejde, závisí na potvrzování adresy. Uživatel to musí
              vědět dřív, než bude hledat, proč nic nedorazilo. */}
          <p className="text-sm text-text-muted" data-testid="form-email-timing">
            {doubleOptIn ? te('hintDoubleOptIn') : te('hintDirect')}
          </p>
          {/*
            Rozdíl mezi potvrzovacím a uvítacím e-mailem patří NA OBRAZOVKU, ne do
            nápovědy: kdo si myslí, že tady nastavuje potvrzovací e-mail, dá odkaz
            ke stažení tomu, kdo teprve ověřuje adresu.
          */}
          <p className="text-sm text-text-muted" data-testid="form-email-kind">
            {te('confirmVsWelcome')}
          </p>
          <p className="text-sm text-text-muted">{te('sharedWithList')}</p>
        </div>

        <div data-testid="form-template-select">
          <span aria-hidden className="mb-1 block text-sm font-medium text-text">
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

        <div className="flex flex-wrap items-center gap-3">
          {templateId !== NO_TEMPLATE && (
            <Link
              href={`/w/${workspaceSlug}/templates/${templateId}`}
              className="inline-flex items-center rounded-[var(--radius-control)] border border-border-strong px-3 py-2 text-sm"
              data-testid="edit-delivery-template"
            >
              {te('edit')}
            </Link>
          )}
          {canEdit && (
            <Button
              variant="secondary"
              data-testid="create-delivery-template"
              pending={creating}
              pendingLabel={te('creating')}
              onClick={() => void createEmail()}
            >
              {te('create')}
            </Button>
          )}
        </div>
      </div>

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
          <Button variant="ghost" data-testid="delete-form" onClick={() => setConfirmDelete(true)}>
            {tf('delete')}
          </Button>
        </div>
      )}

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
    </section>
  );
}
