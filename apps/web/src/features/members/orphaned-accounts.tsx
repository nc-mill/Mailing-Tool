'use client';

import { useActionState, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { CardTitle } from '@mlain/ui/components/card';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { useToast } from '@mlain/ui/patterns/toast';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import type { Result } from '@/lib/api-client/result';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { deleteUserAccountAction } from './actions';

export type OrphanedAccountRow = {
  user_id: string;
  email: string;
  name: string;
  created_at: string;
  last_login_at: string | null;
};

export type OrphanedAccountsProps = {
  accounts: Result<{ data: OrphanedAccountRow[] }>;
  workspaceId: string;
  slug: string;
  action?: ((previous: ActionState, formData: FormData) => Promise<ActionState>) | undefined;
  initialState?: ActionState | undefined;
};

/**
 * Účty, které v instalaci existují, ale nepatří do žádného projektu.
 *
 * PROČ TO TU JE. Odebrání z projektu ruší členství, ne účet. Odebraný člověk se
 * tedy dál přihlásí, skončí na `/no-workspace`, a v rozhraní ho nikdo neuvidí:
 * obrazovka Tým vypisuje členy projektu a on v žádném není. Vznikl neviditelný
 * účet, na který se dalo přijít jedině dotazem do databáze. Totéž se stane po
 * smazání projektu, protože ten se maže měkce a členství po něm zůstane.
 *
 * Sekce je vidět jen s oprávněním odebírat členy, tedy Správce a Vlastník,
 * a stojí až za týmem projektu, protože je to správa instalace, ne projektu.
 */
export function OrphanedAccounts(props: OrphanedAccountsProps) {
  const t = useTranslations('settings');
  const format = useFormatter();
  const confirmLabels = useConfirmDialogLabels();
  const toast = useToast();
  const [state, formAction] = useActionState(
    props.action ?? deleteUserAccountAction,
    props.initialState ?? IDLE,
  );
  const [pending, setPending] = useState<OrphanedAccountRow | null>(null);

  const rows = props.accounts.ok ? props.accounts.data.data : [];

  return (
    <section
      aria-labelledby="members-orphaned"
      className="flex flex-col gap-[var(--spacing-gutter)]"
    >
      <CardTitle>
        <span id="members-orphaned">{t('members.orphaned.title')}</span>
      </CardTitle>
      <p className="text-meta text-text-muted">{t('members.orphaned.lead')}</p>

      {!props.accounts.ok ? (
        <div>
          <SettingsProblem problem={props.accounts.problem} />
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div>
          <SettingsProblem problem={state.problem} />
        </div>
      ) : null}

      {state.status === 'success' ? (
        <p role="status" className="text-meta">
          {t('members.orphaned.done', { email: String(state.values?.email ?? '') })}
        </p>
      ) : null}

      {props.accounts.ok && rows.length === 0 ? (
        <p className="text-ui text-text-muted">{t('members.orphaned.empty')}</p>
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-ui">
            <caption className="sr-only">{t('members.orphaned.title')}</caption>
            <thead>
              <tr className="bg-surface-muted">
                <th
                  scope="col"
                  className="meta-caps px-[var(--spacing-row-x)] py-3 text-text-muted"
                >
                  {t('members.orphaned.email')}
                </th>
                <th
                  scope="col"
                  className="meta-caps px-[var(--spacing-row-x)] py-3 text-text-muted"
                >
                  {t('members.orphaned.createdAt')}
                </th>
                <th
                  scope="col"
                  className="meta-caps px-[var(--spacing-row-x)] py-3 text-text-muted"
                >
                  {t('members.orphaned.lastLoginAt')}
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
              {rows.map((account) => (
                <tr key={account.user_id} className="border-b border-border hover:bg-surface-muted">
                  <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)]">
                    <p>{account.email}</p>
                    {account.name ? (
                      <p className="text-meta text-text-muted">{account.name}</p>
                    ) : null}
                  </td>
                  <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)]">
                    <time dateTime={account.created_at} title={account.created_at}>
                      {format.dateTime(new Date(account.created_at), 'short')}
                    </time>
                  </td>
                  <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)]">
                    {account.last_login_at ? (
                      <time dateTime={account.last_login_at} title={account.last_login_at}>
                        {format.dateTime(new Date(account.last_login_at), 'short')}
                      </time>
                    ) : (
                      t('members.orphaned.never')
                    )}
                  </td>
                  <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)]">
                    <Button type="button" variant="secondary" onClick={() => setPending(account)}>
                      {t('members.orphaned.delete')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {pending ? (
        // Formulář obaluje dialog stejně jako u odebrání člena: `onConfirm`
        // nedostává událost, takže se odesílá přes `requestSubmit` na formuláři.
        <form action={formAction} id="delete-account-form">
          <input type="hidden" name="workspace_id" value={props.workspaceId} readOnly />
          <input type="hidden" name="slug" value={props.slug} readOnly />
          <input type="hidden" name="user_id" value={pending.user_id} readOnly />
          <input type="hidden" name="email" value={pending.email} readOnly />
          <ConfirmDialog
            open
            onOpenChange={(open: boolean) => {
              if (!open) setPending(null);
            }}
            level="N2"
            // Účet se smaže, ne odpojí. Zpátky ho rozhraní nedostane.
            destructive
            title={t('members.orphaned.dialogTitle', { email: pending.email })}
            consequences={[
              t('members.orphaned.consequence1'),
              t('members.orphaned.consequence2'),
              t('members.orphaned.consequence3'),
              t('members.orphaned.consequence4'),
            ]}
            confirmLabel={t('members.orphaned.confirm')}
            cancelLabel={t('members.orphaned.cancel')}
            onConfirm={() => {
              (
                document.getElementById('delete-account-form') as HTMLFormElement | null
              )?.requestSubmit();
              /**
               * Potvrzení se hlásí TADY, ne ze stavu akce.
               *
               * Dialog se po potvrzení zavře a odmontuje formulář, takže se
               * uživatel o výsledku dozvěděl jedině tím, že řádek zmizel.
               * Naměřeno v prohlížeči: účet se smazal, obrazovka se překreslila
               * a nikde nestálo, že se něco stalo. U nevratné operace to je
               * málo. Případné selhání se pak ukáže v bloku nad tabulkou.
               */
              toast.success(t('members.orphaned.done', { email: pending.email }));
            }}
            labels={confirmLabels}
          />
        </form>
      ) : null}
    </section>
  );
}
