'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@mlain/ui/components/input';
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
    <section aria-labelledby="members-create">
      <h2 id="members-create" className="text-xl font-semibold">
        {t('members.create.title')}
      </h2>
      <p className="mt-1 text-sm text-text-muted">{t('members.create.lead')}</p>

      {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
        <div className="mt-4">
          <SettingsProblem problem={state.problem} />
        </div>
      ) : null}

      {created ? (
        <p role="status" className="mt-4 text-sm">
          {created.password_set
            ? t('members.create.done', { email: created.email })
            : t('members.create.existing', { email: created.email })}
        </p>
      ) : null}

      <form action={formAction} className="mt-4 max-w-xl space-y-4" noValidate>
        <input type="hidden" name="workspace_id" value={workspaceId} readOnly />
        <input type="hidden" name="slug" value={slug} readOnly />

        <div>
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

        <fieldset>
          <legend className="mb-1 text-sm font-medium text-text">
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
            <label className="flex items-center gap-2">
              <RadioGroupItem value="generated" />
              <span>{t('members.create.passwordGenerated')}</span>
            </label>
            <label className="flex items-center gap-2">
              <RadioGroupItem value="manual" />
              <span>{t('members.create.passwordManual')}</span>
            </label>
          </RadioGroup>
        </fieldset>

        {mode === 'manual' ? (
          <div>
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
            <p className="mt-1 text-sm text-text-muted">{t('members.create.passwordHint')}</p>
            <FieldError name="password" errors={fieldErrors} />
          </div>
        ) : null}

        <SubmitButton
          label={t('members.create.submit')}
          pendingLabel={t('members.create.submitting')}
        />
      </form>
    </section>
  );
}
