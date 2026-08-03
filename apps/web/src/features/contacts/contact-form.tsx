'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@mlain/i18n/navigation';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { Textarea } from '@mlain/ui/components/textarea';
import { SelectField } from '@/lib/forms/select-field';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import { SubmitButton } from '@/lib/forms/submit-button';
import { useFormErrorFocus } from '@/lib/forms/use-form-error-focus';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { formLevelErrors } from '@/lib/errors/field-errors';
import { ContactsProblem } from './contacts-problem';
import { previewGreetingAction, type GreetingPreview } from './edit-actions';

export type ContactFormField = {
  key: string;
  label: string;
  type:
    | 'text'
    | 'long_text'
    | 'number'
    | 'boolean'
    | 'date'
    | 'datetime'
    | 'enum'
    | 'multi_enum'
    | 'url'
    | 'email'
    | 'phone';
  value: string;
};

export type ContactFormValues = {
  id: string | null;
  email: string;
  first_name: string;
  last_name: string;
  title_prefix: string;
  title_suffix: string;
  gender: 'female' | 'male' | 'unknown';
  /** Oslovení uložené v databázi. U založení null, protože ještě žádné není. */
  greeting: string | null;
  greeting_locked: boolean;
  fields: ContactFormField[];
  /** Jména štítků projektu a příznak, jestli je kontakt má. */
  tags: { name: string; selected: boolean }[];
  lists: { id: string; name: string; selected: boolean }[];
};

export type ContactFormProps = {
  mode: 'create' | 'edit';
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  workspaceId: string;
  workspaceSlug: string;
  basePath: string;
  values: ContactFormValues;
};

/**
 * Formulář kontaktu. Jeden pro založení i pro úpravu, protože je to týž formulář:
 * liší se jedním polem (adresa) a jednou větou nad seznamy.
 *
 * NÁHLED OSLOVENÍ JE HLAVNÍ VĚC NA TÉHLE OBRAZOVCE, ne ozdoba. Celý produkt stojí na
 * tom, že se česky oslovuje pátým pádem, a jestli z „Ondřej" vypadne „Ondřeji", se bez
 * náhledu pozná až v odeslané kampani. Počítá ho server, protože skloňování stojí na
 * slovníku, na přepisech projektu a na nastavení vykání, a nic z toho v prohlížeči není.
 */
export function ContactForm({
  mode,
  action,
  workspaceId,
  workspaceSlug,
  basePath,
  values,
}: ContactFormProps) {
  const t = useTranslations('contacts');
  const [state, formAction] = useActionState(action, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};
  useFormErrorFocus(fieldErrors, formRef);

  const [firstName, setFirstName] = useState(values.first_name);
  const [lastName, setLastName] = useState(values.last_name);
  const [titlePrefix, setTitlePrefix] = useState(values.title_prefix);
  const [gender, setGender] = useState(values.gender);
  const [preview, setPreview] = useState<GreetingPreview | null>(null);
  const [, startPreview] = useTransition();

  /**
   * Náhled se přepočítává se zpožděním 400 ms po posledním úhozu. Bez zpoždění by
   * každé písmeno bylo jeden požadavek na server; se zpožděním je jich za napsané
   * jméno jeden.
   */
  useEffect(() => {
    if (firstName.trim() === '' && lastName.trim() === '') {
      setPreview(null);
      return;
    }
    const timer = window.setTimeout(() => {
      startPreview(async () => {
        setPreview(
          await previewGreetingAction({
            workspaceId,
            first_name: firstName.trim() === '' ? null : firstName.trim(),
            last_name: lastName.trim() === '' ? null : lastName.trim(),
            title_prefix: titlePrefix.trim() === '' ? null : titlePrefix.trim(),
            gender,
          }),
        );
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [firstName, lastName, titlePrefix, gender, workspaceId]);

  const formErrors = formLevelErrors(fieldErrors);

  return (
    <article className="flex flex-col gap-6">
      <Link href={mode === 'edit' && values.id ? `${basePath}/${values.id}` : basePath}>
        {t('detail.back')}
      </Link>

      <h1 className="text-xl font-semibold text-text">
        {mode === 'create' ? t('form.createTitle') : t('form.editTitle')}
      </h1>

      {state.status === 'error' && formErrors.length === 0 ? (
        <ContactsProblem problem={state.problem} />
      ) : null}
      {formErrors.length > 0 ? (
        <p role="alert" className="text-sm text-danger-text">
          {formErrors.join(' ')}
        </p>
      ) : null}

      <form ref={formRef} action={formAction} className="flex flex-col gap-8" noValidate>
        <input type="hidden" name="workspace_id" value={workspaceId} readOnly />
        <input type="hidden" name="workspace_slug" value={workspaceSlug} readOnly />
        {values.id ? <input type="hidden" name="contact_id" value={values.id} readOnly /> : null}

        <section className="flex flex-col gap-4">
          <h2 className="font-semibold text-text">{t('form.sectionIdentity')}</h2>

          {mode === 'create' ? (
            <div>
              <Label htmlFor="email">{t('form.email')}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="off"
                defaultValue={values.email}
                {...fieldAria('email', fieldErrors)}
              />
              <p className="mt-1 text-sm text-text-muted">{t('form.emailHint')}</p>
              <FieldError name="email" errors={fieldErrors} />
            </div>
          ) : (
            <>
              {/* Adresa je klíč kontaktu a zápisem se nemění (pravidlo 1 ze 4.1.2 části 2).
                  Na obrazovce je vidět, ale jako hodnota, ne jako pole: měnit ji smí jen
                  samostatná akce, která umí přepočítat otisky a odhalit kolizi. */}
              <input type="hidden" name="email" value={values.email} readOnly />
              <div>
                <span className="block text-sm font-medium text-text">{t('form.email')}</span>
                <p className="text-sm text-text">{values.email}</p>
                <Link href={`${basePath}/${values.id}/email`} className="text-sm">
                  {t('form.changeEmail')}
                </Link>
              </div>
            </>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="first_name">{t('form.firstName')}</Label>
              <Input
                id="first_name"
                name="first_name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                {...fieldAria('first_name', fieldErrors)}
              />
              <FieldError name="first_name" errors={fieldErrors} />
            </div>
            <div>
              <Label htmlFor="last_name">{t('form.lastName')}</Label>
              <Input
                id="last_name"
                name="last_name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                {...fieldAria('last_name', fieldErrors)}
              />
              <FieldError name="last_name" errors={fieldErrors} />
            </div>
            <div>
              <Label htmlFor="title_prefix">{t('form.titlePrefix')}</Label>
              <Input
                id="title_prefix"
                name="title_prefix"
                value={titlePrefix}
                onChange={(event) => setTitlePrefix(event.target.value)}
                {...fieldAria('title_prefix', fieldErrors)}
              />
              <p className="mt-1 text-sm text-text-muted">{t('form.titlePrefixHint')}</p>
            </div>
            <div>
              <Label htmlFor="title_suffix">{t('form.titleSuffix')}</Label>
              <Input
                id="title_suffix"
                name="title_suffix"
                defaultValue={values.title_suffix}
                {...fieldAria('title_suffix', fieldErrors)}
              />
            </div>
          </div>

          <SelectField
            name="gender"
            label={t('form.gender')}
            placeholder={t('detail.genderUnknown')}
            defaultValue={values.gender}
            options={[
              { value: 'female', label: t('detail.genderFemale') },
              { value: 'male', label: t('detail.genderMale') },
              { value: 'unknown', label: t('detail.genderUnknown') },
            ]}
            hint={t('form.genderHint')}
            errors={fieldErrors}
            onSelected={(next) => setGender(next as ContactFormValues['gender'])}
          />

          <div
            data-testid="greeting-preview"
            className="rounded-[var(--radius-surface)] border border-border bg-surface-muted p-4"
          >
            <h3 className="text-sm font-medium text-text">{t('form.greetingPreviewTitle')}</h3>
            {values.greeting_locked ? (
              <p className="mt-1 text-sm text-warning-text">{t('form.greetingLocked')}</p>
            ) : null}
            {preview === null ? (
              <p className="mt-1 text-sm text-text-muted">{t('form.greetingPreviewEmpty')}</p>
            ) : (
              <>
                <p className="mt-1 text-base text-text">
                  {t('form.greetingPreviewValue', { greeting: preview.greeting })}
                </p>
                {preview.vocative_confidence === 'low' ? (
                  <p className="mt-1 text-sm text-warning-text">{t('form.greetingUncertain')}</p>
                ) : null}
                {preview.gender === 'unknown' ? (
                  <p className="mt-1 text-sm text-text-muted">{t('form.greetingGenderUnknown')}</p>
                ) : null}
              </>
            )}
          </div>
        </section>

        {values.fields.length > 0 ? (
          <section className="flex flex-col gap-4">
            <h2 className="font-semibold text-text">{t('detail.sectionData')}</h2>
            {values.fields.map((field) => (
              <div key={field.key}>
                {/* Typ jde na server ve skrytém poli, protože formulář posílá všechno
                    jako text a JSONB si typ pamatuje. Kdyby se číslo uložilo jako "42",
                    segment s podmínkou nad číslem by kontakt nenašel a nic by nespadlo. */}
                <input type="hidden" name={`attrtype:${field.key}`} value={field.type} readOnly />
                <Label htmlFor={`attr-${field.key}`}>{field.label}</Label>
                {field.type === 'long_text' ? (
                  <Textarea
                    id={`attr-${field.key}`}
                    name={`attr:${field.key}`}
                    defaultValue={field.value}
                  />
                ) : (
                  <Input
                    id={`attr-${field.key}`}
                    name={`attr:${field.key}`}
                    defaultValue={field.value}
                    {...(field.type === 'number' ? { inputMode: 'decimal' as const } : {})}
                  />
                )}
                <FieldError name={`attributes.${field.key}`} errors={fieldErrors} />
              </div>
            ))}
          </section>
        ) : null}

        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-text">{t('detail.tags')}</h2>
          {values.tags.length === 0 ? (
            <p className="text-sm text-text-muted">{t('form.noTagsYet')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {values.tags.map((tag) => (
                <li key={tag.name}>
                  <label className="flex items-center gap-2 text-sm text-text">
                    <Checkbox name="tag" value={tag.name} defaultChecked={tag.selected} />
                    <span>{tag.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div>
            <Label htmlFor="new_tags">{t('form.newTags')}</Label>
            <Input id="new_tags" name="new_tags" />
            <p className="mt-1 text-sm text-text-muted">{t('form.newTagsHint')}</p>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-text">{t('detail.lists')}</h2>
          <p className="text-sm text-text-muted">
            {mode === 'create' ? t('form.listsHintCreate') : t('form.listsHintEdit')}
          </p>
          {values.lists.length === 0 ? (
            <p className="text-sm text-text-muted">{t('detail.noLists')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {values.lists.map((list) => (
                <li key={list.id}>
                  <label className="flex items-center gap-2 text-sm text-text">
                    <Checkbox name="list" value={list.id} defaultChecked={list.selected} />
                    <span>{list.name}</span>
                  </label>
                  {/* Stav při vykreslení. Bez něj by akce nepoznala rozdíl mezi
                      „uživatel seznam odškrtl" a „nikdy zaškrtnutý nebyl", a odhlašovala
                      by kontakt ze seznamů, ve kterých nikdy nebyl. */}
                  {list.selected ? (
                    <input type="hidden" name="list_before" value={list.id} readOnly />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton
            label={mode === 'create' ? t('form.create') : t('form.save')}
            pendingLabel={t('form.saving')}
          />
          <Link href={mode === 'edit' && values.id ? `${basePath}/${values.id}` : basePath}>
            {t('form.cancel')}
          </Link>
        </div>
      </form>
    </article>
  );
}
