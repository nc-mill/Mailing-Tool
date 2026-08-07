'use client';

import { useActionState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@mlain/i18n/navigation';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { passwordManagerOptOut } from '@mlain/ui/lib/password-manager';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import { SubmitButton } from '@/lib/forms/submit-button';
import { useFormErrorFocus } from '@/lib/forms/use-form-error-focus';
import { IDLE } from '@/lib/feedback/action-result';
import { formLevelErrors } from '@/lib/errors/field-errors';
import { ContactsProblem } from './contacts-problem';
import { changeContactEmailAction } from './edit-actions';

/**
 * Změna adresy kontaktu. Vlastní obrazovka, ne pole v editačním formuláři, a to
 * ze dvou důvodů.
 *
 * Za prvé adresa je klíč kontaktu: pravidlo 1 ze 4.1.2 části 2 říká, že se běžným
 * zápisem nemění, protože se na ni váže deduplikace, otisky pro seznam blokovaných
 * adres a historie. Změna je samostatná operace s vlastní kontrolou kolize.
 *
 * Za druhé má následky, které musí být vidět dřív, než uživatel klikne. Vypsané
 * důsledky NEJSOU obecná opatrnost, jsou to zjištěné vlastnosti `changeContactEmail`
 * v `packages/core/src/contacts/repo/contacts.ts`: funkce mění adresu, otisky
 * a vyhledávací klíč, a NESAHÁ na stav kontaktu, na přihlášení do seznamů ani na
 * zaznamenané souhlasy. Kontakt tedy zůstane potvrzený i na adrese, kterou nikdo
 * nepotvrdil, a to je věc, kterou musí uživatel vědět předem.
 */
export function ChangeEmailForm({
  workspaceId,
  workspaceSlug,
  basePath,
  contact,
}: {
  workspaceId: string;
  workspaceSlug: string;
  basePath: string;
  contact: { id: string; email: string };
}) {
  const t = useTranslations('contacts');
  const [state, formAction] = useActionState(changeContactEmailAction, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};
  useFormErrorFocus(fieldErrors, formRef);

  const formErrors = formLevelErrors(fieldErrors);

  return (
    <article className="flex max-w-xl flex-col gap-6">
      <Link href={`${basePath}/${contact.id}`}>{t('detail.back')}</Link>
      <h1 className="text-xl font-semibold text-text">{t('form.changeEmailTitle')}</h1>

      {state.status === 'error' && formErrors.length === 0 ? (
        <ContactsProblem problem={state.problem} />
      ) : null}
      {formErrors.length > 0 ? (
        <p role="alert" className="text-sm text-danger-text">
          {formErrors.join(' ')}
        </p>
      ) : null}
      {state.status === 'success' ? (
        <p role="status" className="text-sm text-success-text">
          {t('form.emailChanged')}
        </p>
      ) : null}

      <section
        data-testid="change-email-consequences"
        className="flex flex-col gap-2 rounded-[var(--radius-surface)] border border-warning-text bg-warning-surface p-4"
      >
        <h2 className="font-semibold text-text">{t('form.changeEmailWhatHappens')}</h2>
        <ul className="list-disc pl-5 text-sm text-text">
          <li>{t('form.changeEmailConsequenceHistory')}</li>
          <li>{t('form.changeEmailConsequenceConsent')}</li>
          <li>{t('form.changeEmailConsequenceSuppression')}</li>
          <li>{t('form.changeEmailConsequenceCollision')}</li>
        </ul>
      </section>

      <form ref={formRef} action={formAction} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="workspace_id" value={workspaceId} readOnly />
        <input type="hidden" name="workspace_slug" value={workspaceSlug} readOnly />
        <input type="hidden" name="contact_id" value={contact.id} readOnly />

        <div>
          <span className="block text-sm font-medium text-text">{t('form.currentEmail')}</span>
          <p className="text-sm text-text">{contact.email}</p>
        </div>

        <div>
          <Label htmlFor="email">{t('form.newEmail')}</Label>
          {/* Nová adresa KONTAKTU, ne přihlašovací. Nabídka správce hesel by sem
              tlačila adresu přihlášeného uživatele, a to je poslední věc, kterou
              chce mít člověk na obrazovce, kde mění klíč cizího kontaktu.
              Podrobnosti v `@mlain/ui/lib/password-manager`. */}
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="off"
            {...passwordManagerOptOut}
            {...fieldAria('email', fieldErrors)}
          />
          <FieldError name="email" errors={fieldErrors} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton label={t('form.changeEmailSubmit')} pendingLabel={t('form.saving')} />
          <Link href={`${basePath}/${contact.id}`}>{t('form.cancel')}</Link>
        </div>
      </form>
    </article>
  );
}
