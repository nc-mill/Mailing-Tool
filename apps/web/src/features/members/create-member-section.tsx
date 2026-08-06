'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@mlain/ui/components/input';
import { CardTitle } from '@mlain/ui/components/card';
import { Alert } from '@mlain/ui/patterns/states';
import { Label } from '@mlain/ui/components/label';
import { RadioGroup, RadioGroupItem } from '@mlain/ui/components/radio-group';
import { SelectField } from '@/lib/forms/select-field';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import { SubmitButton } from '@/lib/forms/submit-button';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { SecretReveal } from '@/features/api-keys/secret-reveal';
import { ROLES, type Role } from '@/lib/identity/permissions';
import { ROLE_LABEL_KEYS } from './role-label';
import { createMemberAction, type CreatedMemberResult } from './actions';

export type CreateMemberSectionProps = {
  workspaceId: string;
  slug: string;
  action?:
    | ((
        previous: ActionState<CreatedMemberResult>,
        formData: FormData,
      ) => Promise<ActionState<CreatedMemberResult>>)
    | undefined;
  initialState?: ActionState<CreatedMemberResult> | undefined;
};

/**
 * Založení člena rovnou, s heslem, bez pozvánky e-mailem.
 *
 * PROČ TO TU JE. Pozvánka byla jediná cesta, jak někoho do projektu dostat,
 * a odchází systémovým e-mailem. Instalace, která systémovou poštu odeslat neumí
 * (typicky ta s jediným účtem typu SES), tedy nemohla přidat člověka VŮBEC.
 * U samohostovaného nástroje, kde správce sedí u serveru, je nastavení hesla
 * rukou legitimní cesta; pozvánka e-mailem zůstává a je pořád první volbou tam,
 * kde pošta funguje.
 *
 * Vygenerované heslo se ukazuje PRÁVĚ JEDNOU, stejným způsobem jako sekret
 * klíče k API: jednou zavřené se už nikde nedozví, ani my ho neuchováváme.
 */
export function CreateMemberSection({
  workspaceId,
  slug,
  action,
  initialState,
}: CreateMemberSectionProps) {
  const t = useTranslations('settings');
  const [state, formAction] = useActionState(action ?? createMemberAction, initialState ?? IDLE);
  const [mode, setMode] = useState<'generated' | 'manual'>('generated');
  const [dismissed, setDismissed] = useState(false);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};

  const created = state.status === 'success' ? state.data : undefined;

  // Heslo vygeneroval server. Ukáže se jednou a pak už nikdy.
  if (created?.generated_password && !dismissed) {
    return (
      <SecretReveal
        secret={created.generated_password}
        titleKey="members.password.title"
        warningKey="members.password.warning"
        hintKey="members.create.changeHint"
        acknowledgeKey="members.password.acknowledge"
        closeKey="members.password.close"
        onClose={() => setDismissed(true)}
      />
    );
  }

  return (
    <section aria-labelledby="members-create" className="flex flex-col gap-[var(--spacing-gutter)]">
      <div className="flex flex-col gap-[var(--spacing-hairline)]">
        <CardTitle>
          <span id="members-create">{t('members.create.title')}</span>
        </CardTitle>
        <p className="text-meta text-text-muted">{t('members.create.lead')}</p>
      </div>

      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <SettingsProblem problem={state.problem} />
      ) : null}

      {created ? (
        <Alert tone="success" role="status">
          {created.password_set
            ? t('members.create.done', { email: created.email })
            : t('members.create.existing', { email: created.email })}
        </Alert>
      ) : null}

      <form
        action={formAction}
        className="flex max-w-[var(--size-text-column)] flex-col gap-[var(--spacing-gutter)]"
        noValidate
      >
        <input type="hidden" name="workspace_id" value={workspaceId} readOnly />
        <input type="hidden" name="slug" value={slug} readOnly />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="create-member-email">{t('members.create.email')}</Label>
          <Input
            id="create-member-email"
            name="email"
            type="email"
            defaultValue={state.status === 'error' ? (state.values?.email ?? '') : ''}
            {...fieldAria('email', fieldErrors)}
          />
          <FieldError name="email" errors={fieldErrors} />
        </div>

        <SelectField
          name="role"
          label={t('members.create.role')}
          placeholder={t('shared.selectPlaceholder')}
          defaultValue="viewer"
          options={ROLES.map((role: Role) => ({ value: role, label: t(ROLE_LABEL_KEYS[role]) }))}
          errors={fieldErrors}
        />

        <fieldset className="flex flex-col gap-[var(--spacing-hairline)]">
          <legend className="text-sm font-semibold text-text">
            {t('members.create.passwordMode')}
          </legend>
          {/* Hodnota jde do formuláře skrytým polem: RadioGroup stojí na Radixu
              a ten `name` do formuláře nepropisuje, stejně jako Select. */}
          <input type="hidden" name="password_mode" value={mode} readOnly />
          <RadioGroup
            value={mode}
            onValueChange={(next: string) => setMode(next === 'manual' ? 'manual' : 'generated')}
            aria-label={t('members.create.passwordMode')}
          >
            {/* 44 px je nejmenší klikací plocha, i u volby v seznamu. */}
            <label className="flex min-h-[var(--size-target-min)] cursor-pointer items-center gap-[var(--spacing-inline)]">
              <RadioGroupItem value="generated" />
              <span className="text-ui text-text">{t('members.create.passwordGenerated')}</span>
            </label>
            <label className="flex min-h-[var(--size-target-min)] cursor-pointer items-center gap-[var(--spacing-inline)]">
              <RadioGroupItem value="manual" />
              <span className="text-ui text-text">{t('members.create.passwordManual')}</span>
            </label>
          </RadioGroup>
        </fieldset>

        {mode === 'manual' ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-member-password">{t('members.create.password')}</Label>
            {/* Heslo se po chybě NEVRACÍ do pole: prošlo by serializované do
                klientského stavu, viz komentář v `action-result.ts`. */}
            <Input
              id="create-member-password"
              name="password"
              type="password"
              autoComplete="new-password"
              {...fieldAria('password', fieldErrors)}
            />
            <p className="text-meta text-text-muted">{t('members.create.passwordHint')}</p>
            <FieldError name="password" errors={fieldErrors} />
          </div>
        ) : null}

        {/* Obal `flex`, aby se tlačítko neroztáhlo přes celou šířku formuláře:
            ve sloupci `flex-col` je výchozí `align-items: stretch`. */}
        <div className="flex">
          <SubmitButton
            label={t('members.create.submit')}
            pendingLabel={t('members.create.submitting')}
          />
        </div>
      </form>
    </section>
  );
}
