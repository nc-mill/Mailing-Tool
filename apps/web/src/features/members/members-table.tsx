'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { EmptyState } from '@mlain/ui/patterns/states';
import { useToast } from '@mlain/ui/patterns/toast';
import { SelectField } from '@/lib/forms/select-field';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import type { Result } from '@/lib/api-client/result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { ROLES, type Role } from '@/lib/identity/permissions';
import { ROLE_LABEL_KEYS } from './role-label';

export type MemberRow = {
  user_id: string;
  email: string;
  name: string;
  role: Role;
  created_at: string;
};

export type MembersTableProps = {
  members: Result<{ data: MemberRow[] }>;
  canManage: boolean;
  currentUserId: string;
  changeRoleAction: (formData: FormData) => void;
  removeAction: (formData: FormData) => void;
  workspaceId?: string | undefined;
  slug?: string | undefined;
  onInvite?: (() => void) | undefined;
};

const ROLE_DESCRIPTION_KEYS = {
  owner: 'members.roleDescription.owner',
  admin: 'members.roleDescription.admin',
  editor: 'members.roleDescription.editor',
  viewer: 'members.roleDescription.viewer',
} as const satisfies Record<Role, string>;

export function MembersTable(props: MembersTableProps) {
  const t = useTranslations('settings');
  const toast = useToast();
  const router = useRouter();
  const confirmLabels = useConfirmDialogLabels();
  const removeFormRef = useRef<HTMLFormElement>(null);
  // Každý řádek má vlastní formulář, protože výběr role se odesílá hned po
  // volbě. Bez mapy referencí by `requestSubmit` neměl co odeslat; plán tuhle
  // proměnnou používal, ale nikde ji nezaložil.
  const roleFormRefs = useRef<Record<string, HTMLFormElement | null>>({});
  const [pendingRemoval, setPendingRemoval] = useState<MemberRow | null>(null);

  if (!props.members.ok) {
    return (
      <SettingsProblem
        problem={props.members.problem}
        onRetry={() => {
          window.location.reload();
        }}
      />
    );
  }

  const rows = props.members.data.data;

  if (rows.length === 0) {
    return (
      <EmptyState
        variant="first"
        title={t('members.title')}
        explanation={t('members.empty')}
        // `actions` je povinné a nesmí být prázdné: prázdný stav bez akce
        // porušuje kritérium 20 a `EmptyState` na něj hodí výjimku.
        // Kdo pozvat nesmí, dostane akci, která funguje, a vysvětlení proč.
        actions={
          props.onInvite
            ? [{ label: t('members.emptyAction'), onClick: props.onInvite }]
            : [
                {
                  label: t('shared.backToOverview'),
                  onClick: () => router.push(`/w/${props.slug ?? ''}`),
                  description: t('members.emptyNoPermission'),
                },
              ]
        }
      />
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-ui">
          <caption className="sr-only">{t('members.title')}</caption>
          {/* Hlavička tabulky ze základu: tlumená plocha, mono verzálky
              v tlumeném textu, okraj 12/20. Dřív `pb-2 pr-6` bez plochy,
              takže hlavička splývala s prvním řádkem. */}
          <thead>
            <tr className="bg-surface-muted">
              <th scope="col" className="meta-caps px-[var(--spacing-row-x)] py-3 text-text-muted">
                {t('members.table.person')}
              </th>
              <th scope="col" className="meta-caps px-[var(--spacing-row-x)] py-3 text-text-muted">
                {t('members.table.role')}
              </th>
              <th scope="col" className="meta-caps px-[var(--spacing-row-x)] py-3 text-text-muted">
                {t('members.table.actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((member) => {
              const isSelf = member.user_id === props.currentUserId;
              return (
                <tr key={member.user_id} className="border-b border-border hover:bg-surface-muted">
                  <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)]">
                    <p className="font-semibold whitespace-nowrap text-text">
                      {member.name === '' ? member.email : member.name}
                    </p>
                    {/* Adresa se čte po znacích, takže mono. */}
                    <p className="font-mono text-meta whitespace-nowrap text-text-muted">
                      {member.email}
                    </p>
                  </td>
                  <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)]">
                    {props.canManage && !isSelf ? (
                      <form
                        ref={(node) => {
                          roleFormRefs.current[member.user_id] = node;
                        }}
                        action={props.changeRoleAction}
                      >
                        <input
                          type="hidden"
                          name="workspace_id"
                          value={props.workspaceId ?? ''}
                          readOnly
                        />
                        <input type="hidden" name="slug" value={props.slug ?? ''} readOnly />
                        <input type="hidden" name="user_id" value={member.user_id} readOnly />
                        <SelectField
                          name="role"
                          label={t('members.changeRole.label', { name: member.name })}
                          placeholder={t('shared.selectPlaceholder')}
                          defaultValue={member.role}
                          options={ROLES.map((role) => ({
                            value: role,
                            label: t(ROLE_LABEL_KEYS[role]),
                          }))}
                          onSelected={(next) => {
                            roleFormRefs.current[member.user_id]?.requestSubmit();
                            toast.info(
                              t('members.changeRole.done', {
                                name: member.name,
                                role: t(ROLE_LABEL_KEYS[next as Role]),
                              }),
                            );
                          }}
                        />
                      </form>
                    ) : (
                      <span className="text-ui text-text">{t(ROLE_LABEL_KEYS[member.role])}</span>
                    )}
                    <p className="mt-1 text-meta text-text-muted">
                      {t(ROLE_DESCRIPTION_KEYS[member.role])}
                    </p>
                  </td>
                  <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)] whitespace-nowrap">
                    {props.canManage && !isSelf ? (
                      // `size="sm"` (36 px): tlačítko v řádku tabulky je
                      // v návrhu nižší než tlačítko v hlavičce obrazovky.
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setPendingRemoval(member)}
                      >
                        {t('members.remove.button')}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pendingRemoval ? (
        <form ref={removeFormRef} action={props.removeAction}>
          <input type="hidden" name="workspace_id" value={props.workspaceId ?? ''} readOnly />
          <input type="hidden" name="slug" value={props.slug ?? ''} readOnly />
          <input type="hidden" name="user_id" value={pendingRemoval.user_id} readOnly />
          <ConfirmDialog
            open
            onOpenChange={(open: boolean) => {
              if (!open) setPendingRemoval(null);
            }}
            level="N2"
            // Odebrání přístupu, ne ztráta dat: kolegu jde pozvat zpátky a jeho
            // práce v projektu zůstává. Podle os z 6.1 vnější dopad 1, ne 2.
            destructive={false}
            // Věta „Tuhle akci nejde vzít zpět" tu byla ze zapomenuté výchozí
            // hodnoty a protiřečila třetímu následku, který cestu zpět popisuje
            // (nová pozvánka). Nepravdivá věta o nevratnosti učí lidi ignorovat
            // i okna, kde pravdivá je.
            irreversible={false}
            title={t('members.remove.dialogTitle', { name: pendingRemoval.name })}
            consequences={[
              t('members.remove.consequence1'),
              t('members.remove.consequence2'),
              t('members.remove.consequence3'),
            ]}
            confirmLabel={t('members.remove.confirm', { name: pendingRemoval.name })}
            cancelLabel={t('members.remove.cancel')}
            // `onConfirm` nedostává událost, jeho podpis je `() => void | Promise<void>`.
            // Formulář se proto adresuje přes ref, stejně jako na ostatních obrazovkách.
            onConfirm={() => removeFormRef.current?.requestSubmit()}
            labels={confirmLabels}
          />
        </form>
      ) : null}
    </>
  );
}
