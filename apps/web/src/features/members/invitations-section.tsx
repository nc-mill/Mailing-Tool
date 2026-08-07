'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { CardTitle } from '@mlain/ui/components/card';
import { Input } from '@mlain/ui/components/input';
import { passwordManagerOptOut } from '@mlain/ui/lib/password-manager';
import { Label } from '@mlain/ui/components/label';
import { Alert, EmptyState, OverLimitState } from '@mlain/ui/patterns/states';
import { SelectField } from '@/lib/forms/select-field';
import type { Result } from '@/lib/api-client/result';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import { SubmitButton } from '@/lib/forms/submit-button';
import { IdempotencyField } from '@/lib/feedback/idempotency-field';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { ROLES, type Role } from '@/lib/identity/permissions';
import { ROLE_LABEL_KEYS } from './role-label';
import { inviteMemberAction } from './actions';
import { revokeInvitationFormAction } from './actions-forms';

/** Maximum čekajících pozvánek na projekt podle 3.3 části 1. */
export const PENDING_INVITATION_LIMIT = 100;

export type InvitationRow = {
  id: string;
  email: string;
  role: Role;
  invited_by_name: string;
  expires_at: string;
  created_at: string;
};

export type InvitationsSectionViewProps = {
  invitations: Result<{ data: InvitationRow[] }>;
  workspaceId: string;
  slug: string;
  inviteAction: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  revokeAction: (formData: FormData) => void;
  initialState?: ActionState | undefined;
  /**
   * Umí instalace odeslat systémový e-mail? Když ne, pozvánka se NENABÍZÍ.
   *
   * Není to kosmetika. Pozvánka odchází systémovým e-mailem a instalace
   * s jediným odesílacím účtem typu SES ho odeslat neumí. Formulář se dřív
   * odeslal, pozvánka se zapsala a e-mail nikam nedošel; zvoucí viděl „čeká
   * na přijetí" a pozvaný nedostal nic. API to teď odmítne dřív, než pozvánka
   * vznikne, a obrazovka to musí říct dopředu, ne až chybou po odeslání.
   */
  systemMailAvailable: boolean;
};

export function InvitationsSectionView(props: InvitationsSectionViewProps) {
  const t = useTranslations('settings');
  const format = useFormatter();
  const [state, formAction] = useActionState(props.inviteAction, props.initialState ?? IDLE);
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};

  const rows = props.invitations.ok ? props.invitations.data.data : [];
  const atLimit = rows.length >= PENDING_INVITATION_LIMIT;

  return (
    <section
      aria-labelledby="members-invitations"
      className="flex flex-col gap-[var(--spacing-gutter)]"
    >
      <CardTitle>
        <span id="members-invitations">{t('members.invitations.title')}</span>
      </CardTitle>

      {!props.invitations.ok ? (
        <div>
          <SettingsProblem
            problem={props.invitations.problem}
            onRetry={() => {
              window.location.reload();
            }}
          />
        </div>
      ) : rows.length === 0 ? (
        <div>
          {/**
           * AKCE PRÁZDNÉHO STAVU SE ŘÍDÍ TÍM, CO INSTALACE OPRAVDU UMÍ.
           *
           * Do 5. 8. 2026 tu stálo natvrdo „Napsat e-mail kolegy" a kliknutí
           * zaostřilo pole `invite-email`. Když ale systémová pošta odeslat
           * neumí, formulář pozvánky se o kus níž **vůbec nevykreslí** (viz
           * větev `!systemMailAvailable`), takže `getElementById` vrátil
           * `null` a tlačítko nedělalo nic. Uživatel navíc pod ním četl
           * hlášku, že pozvánka e-mailem teď nejde: prvek sliboval něco, co
           * se nestane.
           *
           * Bez pošty proto akce vede na „Založit člena rovnou", tedy na tu
           * cestu, která v daném stavu funguje a stojí hned v další kartě.
           * `EmptyState` aspoň jednu akci vyžaduje, takže je to i jediné
           * správné řešení: nabídnout tu druhou, ne žádnou.
           */}
          <EmptyState
            variant="first"
            title={t('members.invitations.title')}
            explanation={t('members.invitations.empty')}
            actions={[
              props.systemMailAvailable
                ? {
                    label: t('members.invitations.emptyAction'),
                    onClick: () => document.getElementById('invite-email')?.focus(),
                  }
                : {
                    label: t('members.create.title'),
                    onClick: () => document.getElementById('create-member-email')?.focus(),
                  },
            ]}
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-ui">
            <caption className="sr-only">{t('members.invitations.title')}</caption>
            <thead>
              <tr className="bg-surface-muted">
                <th
                  scope="col"
                  className="meta-caps px-[var(--spacing-row-x)] py-3 text-text-muted"
                >
                  {t('members.invitations.email')}
                </th>
                <th
                  scope="col"
                  className="meta-caps px-[var(--spacing-row-x)] py-3 text-text-muted"
                >
                  {t('members.invitations.role')}
                </th>
                <th
                  scope="col"
                  className="meta-caps px-[var(--spacing-row-x)] py-3 text-text-muted"
                >
                  {t('members.invitations.invitedBy')}
                </th>
                <th
                  scope="col"
                  className="meta-caps px-[var(--spacing-row-x)] py-3 text-text-muted"
                >
                  {t('members.invitations.expiresAt')}
                </th>
                <th
                  scope="col"
                  className="meta-caps px-[var(--spacing-row-x)] py-3 text-text-muted"
                >
                  {t('members.table.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((invitation) => (
                <tr key={invitation.id} className="border-b border-border hover:bg-surface-muted">
                  <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)]">
                    {invitation.email}
                  </td>
                  <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)]">
                    {t(ROLE_LABEL_KEYS[invitation.role])}
                  </td>
                  <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)]">
                    {invitation.invited_by_name}
                  </td>
                  <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)]">
                    <time dateTime={invitation.expires_at} title={invitation.expires_at}>
                      {format.dateTime(new Date(invitation.expires_at), 'short')}
                    </time>
                  </td>
                  <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)]">
                    <form action={props.revokeAction}>
                      <input type="hidden" name="workspace_id" value={props.workspaceId} readOnly />
                      <input type="hidden" name="slug" value={props.slug} readOnly />
                      <input type="hidden" name="invitation_id" value={invitation.id} readOnly />
                      <input type="hidden" name="email" value={invitation.email} readOnly />
                      <Button type="submit" variant="secondary">
                        {t('members.invitations.revoke')}
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!props.systemMailAvailable ? (
        /**
         * Formulář se ani nevykreslí. Zašedlé tlačítko s vysvětlivkou by
         * uživatele nechalo vyplnit adresu a pak mu ji odmítlo; tady místo něj
         * stojí důvod, odkaz na nastavení a věta, že náhradní cesta je hned pod
         * tímhle blokem. Stav S14 (chybějící předpoklad) podle 15.2 části 6.
         */
        <div className="mt-[var(--spacing-gutter)]">
          <Alert tone="warning" title={t('members.invite.mailUnavailableTitle')}>
            <p>{t('members.invite.mailUnavailableBody')}</p>
            <Link href={`/w/${props.slug}/settings/system-mail`} className="text-ui font-semibold">
              {t('members.invite.mailUnavailableLink')}
            </Link>
          </Alert>
        </div>
      ) : atLimit ? (
        <div className="mt-[var(--spacing-gutter)]">
          <OverLimitState
            title={t('members.invitations.limitTitle')}
            body={t('members.invitations.limitBody')}
          />
        </div>
      ) : (
        <div className="mt-[var(--spacing-gutter)]">
          <h3 className="text-ui font-semibold text-text">{t('members.invite.title')}</h3>
          <p className="text-meta text-text-muted">{t('members.invite.lead')}</p>

          {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
            <div>
              <SettingsProblem problem={state.problem} />
            </div>
          ) : null}

          {state.status === 'success' ? (
            <p role="status" className="text-meta">
              {t('members.invite.done', { email: String(state.values?.email ?? '') })}
            </p>
          ) : null}

          <form
            action={formAction}
            className="flex flex-wrap items-end gap-[var(--spacing-inline)]"
            noValidate
          >
            <IdempotencyField />
            <input type="hidden" name="workspace_id" value={props.workspaceId} readOnly />
            <input type="hidden" name="slug" value={props.slug} readOnly />

            <div>
              <Label htmlFor="invite-email">{t('members.invite.email')}</Label>
              {/* Adresa ZVANÉHO, ne přihlašovací. Správce hesel sem nabízí adresu
                  toho, kdo pozvánku píše, a vyplnit ji je tu vždycky chyba.
                  Pole pro založení člena i s heslem (`create-member-section.tsx`)
                  značky schválně nemá: tam je nabídka správce hesel na místě.
                  Podrobnosti v `@mlain/ui/lib/password-manager`. */}
              <Input
                id="invite-email"
                name="email"
                type="email"
                autoComplete="off"
                {...passwordManagerOptOut}
                {...fieldAria('email', fieldErrors)}
              />
              <FieldError name="email" errors={fieldErrors} />
            </div>

            <div>
              <SelectField
                name="role"
                label={t('members.invite.role')}
                placeholder={t('shared.selectPlaceholder')}
                defaultValue="viewer"
                options={ROLES.map((role) => ({ value: role, label: t(ROLE_LABEL_KEYS[role]) }))}
                errors={fieldErrors}
              />
            </div>

            <SubmitButton
              label={t('members.invite.submit')}
              pendingLabel={t('members.invite.submitting')}
            />
          </form>
        </div>
      )}
    </section>
  );
}

/** Serverová obálka, aby stránka nemusela znát akce. */
export function InvitationsSection(props: {
  invitations: Result<{ data: InvitationRow[] }>;
  workspaceId: string;
  slug: string;
  systemMailAvailable: boolean;
}) {
  return (
    <InvitationsSectionView
      {...props}
      inviteAction={inviteMemberAction}
      revokeAction={revokeInvitationFormAction}
    />
  );
}
