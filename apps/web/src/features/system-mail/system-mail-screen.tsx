'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { Alert } from '@mlain/ui/patterns/states';
import { SelectField } from '@/lib/forms/select-field';
import { FieldError, fieldAria } from '@/lib/forms/field-error';
import { SubmitButton } from '@/lib/forms/submit-button';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { AUTO_PROVIDER, type SystemMailStatus } from './types';
import { saveSystemMailSettingsAction } from './actions';

export type SystemMailScreenProps = {
  status: SystemMailStatus;
  workspaceId: string;
  slug: string;
  /** Smí aktér nastavení měnit? Prohlížející vidí stav, formulář ne. */
  canConfigure: boolean;
  action?: ((previous: ActionState, formData: FormData) => Promise<ActionState>) | undefined;
  initialState?: ActionState | undefined;
};

/**
 * Jedna obrazovka, ze které se dá poznat, jestli systémová pošta funguje.
 *
 * PROČ VZNIKLA. Stav systémové pošty nebyl nikde vidět. Instalace, která má
 * jediný odesílací účet typu SES, systémový e-mail odeslat neumí, takže z ní
 * neodejde pozvánka ani obnova hesla, a uživatel pro to neměl jediné vodítko:
 * pozvánka se tvářila jako odeslaná a obnova hesla skončila v logu. Obrazovka
 * proto říká čtyři věci naráz: jestli to funguje, čím se odesílá, z jaké adresy,
 * a co konkrétně nefunguje, když to nefunguje.
 *
 * Vysvětlení omezení je součástí obrazovky schválně. Uživatel, kterému nástroj
 * jen řekne „nejde to", hledá chybu u sebe. Tady se dozví, že klient SES existuje
 * pouze v odesílací službě kampaní, a že jde tedy o hranici nástroje.
 */
export function SystemMailScreen({
  status,
  workspaceId,
  slug,
  canConfigure,
  action,
  initialState,
}: SystemMailScreenProps) {
  const t = useTranslations('settings');
  const [state, formAction] = useActionState(
    action ?? saveSystemMailSettingsAction,
    initialState ?? IDLE,
  );
  const fieldErrors = state.status === 'error' ? state.fieldErrors : {};

  const selected = status.accounts.find((a) => a.id === status.provider_id);
  const accountName = selected?.name ?? '';
  const accountType = status.provider_type ?? '';

  return (
    <div className="space-y-10">
      <section aria-labelledby="system-mail-status">
        <h2 id="system-mail-status" className="sr-only">
          {t('systemMail.title')}
        </h2>

        {status.available ? (
          <Alert tone="success" title={t('systemMail.okTitle')}>
            <p>{t('systemMail.okBody', { account: accountName, type: accountType })}</p>
          </Alert>
        ) : (
          <Alert tone="warning" title={t('systemMail.failTitle')}>
            <p>
              {status.reason === 'provider_unsupported'
                ? t('systemMail.reason.provider_unsupported', {
                    account: accountName,
                    type: accountType,
                  })
                : status.reason === 'selected_account_missing'
                  ? t('systemMail.reason.selected_account_missing')
                  : t('systemMail.reason.no_account')}
            </p>
          </Alert>
        )}

        <p className="mt-4">{t('systemMail.fromCurrent', { address: status.from_address })}</p>
        <p className="mt-1 text-sm text-text-muted">
          {status.from_source === 'configured'
            ? t('systemMail.fromSource.configured')
            : status.from_source === 'verified_domain'
              ? t('systemMail.fromSource.verified_domain')
              : t('systemMail.fromSource.app_url')}
        </p>
      </section>

      {!status.available ? (
        <section aria-labelledby="system-mail-why" className="space-y-4">
          <div>
            <h2 id="system-mail-why" className="text-xl font-semibold">
              {t('systemMail.limitationTitle')}
            </h2>
            <p className="mt-2 text-text-muted">{t('systemMail.limitationBody')}</p>
          </div>

          <div>
            <h3 className="font-medium">{t('systemMail.blockedTitle')}</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-text-muted">
              <li>{t('systemMail.blocked1')}</li>
              <li>{t('systemMail.blocked2')}</li>
              <li>{t('systemMail.blocked3')}</li>
              <li>{t('systemMail.blocked4')}</li>
            </ul>
          </div>

          <div>
            <h3 className="font-medium">{t('systemMail.fixTitle')}</h3>
            <p className="mt-2 text-text-muted">{t('systemMail.fixBody')}</p>
            <Link
              href={`/w/${slug}/settings/sending`}
              className="mt-2 inline-block font-medium underline"
            >
              {t('systemMail.fixLink')}
            </Link>
          </div>
        </section>
      ) : null}

      {canConfigure ? (
        <section aria-labelledby="system-mail-form">
          <h2 id="system-mail-form" className="text-xl font-semibold">
            {t('systemMail.form.title')}
          </h2>

          {status.accounts.length === 0 ? (
            <p className="mt-2 text-text-muted">{t('systemMail.noAccounts')}</p>
          ) : null}

          {state.status === 'error' && Object.keys(fieldErrors).length === 0 ? (
            <div className="mt-4">
              <SettingsProblem problem={state.problem} />
            </div>
          ) : null}

          {state.status === 'success' ? (
            <p role="status" className="mt-4 text-sm">
              {t('systemMail.form.done')}
            </p>
          ) : null}

          <form action={formAction} className="mt-4 max-w-xl space-y-4" noValidate>
            <input type="hidden" name="workspace_id" value={workspaceId} readOnly />
            <input type="hidden" name="slug" value={slug} readOnly />

            <SelectField
              name="provider_id"
              label={t('systemMail.form.account')}
              placeholder={t('shared.selectPlaceholder')}
              hint={t('systemMail.form.accountHint')}
              defaultValue={status.settings.provider_id ?? AUTO_PROVIDER}
              options={[
                { value: AUTO_PROVIDER, label: t('systemMail.form.accountAuto') },
                ...status.accounts.map((a) => ({
                  value: a.id,
                  label: a.capable
                    ? t('systemMail.form.accountCapable', { name: a.name, type: a.type })
                    : t('systemMail.form.accountIncapable', { name: a.name, type: a.type }),
                })),
              ]}
              errors={fieldErrors}
            />

            <div>
              <Label htmlFor="system-mail-from">{t('systemMail.form.fromAddress')}</Label>
              <Input
                id="system-mail-from"
                name="from_address"
                type="email"
                defaultValue={
                  state.status === 'error'
                    ? (state.values?.from_address ?? '')
                    : (status.settings.from_address ?? '')
                }
                {...fieldAria('from_address', fieldErrors)}
              />
              <p className="mt-1 text-sm text-text-muted">{t('systemMail.form.fromAddressHint')}</p>
              <FieldError name="from_address" errors={fieldErrors} />
            </div>

            <SubmitButton
              label={t('systemMail.form.submit')}
              pendingLabel={t('systemMail.form.submitting')}
            />
          </form>
        </section>
      ) : (
        <p className="text-text-muted">{t('systemMail.noPermission')}</p>
      )}
    </div>
  );
}
