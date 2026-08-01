import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ForbiddenState } from '@mlain/ui/patterns/states';
import { ROLE_LABEL_KEYS } from '@/features/members/role-label';
import type { Problem } from '@/lib/api-client/problem';
import { rolesGranting, type Permission, type Role } from '@/lib/identity/permissions';

export type ForbiddenSectionProps = {
  permission: Permission;
  currentRole: Role;
  workspaceSlug: string;
  /**
   * Když blokaci vrátil server, nese `params.contactableMembers[]` se jmény
   * lidí, kteří roli mohou změnit (předpoklad E8). Když blokuje rozhraní samo,
   * jméno nemáme a text se odkáže na roli, ne na osobu.
   */
  problem?: Problem | undefined;
};

/**
 * Stav S11 z 7.1 části 6. Říká, které oprávnění chybí, které role ho mají,
 * jakou roli má uživatel a kdo s tím může něco udělat.
 */
export async function ForbiddenSection({
  permission,
  currentRole,
  workspaceSlug,
  problem,
}: ForbiddenSectionProps) {
  const t = await getTranslations('settings');

  const granting = rolesGranting(permission)
    .map((role) => t(ROLE_LABEL_KEYS[role]))
    .join(', ');

  // P04 posílá `contactableMembers` jako pole objektů `{ name, email, role }`,
  // ne jako pole řetězců. Dřívější čtení jako `string[]` by vždycky vyhodnotilo
  // `undefined` a jméno kolegy by se nikdy nezobrazilo, aniž by cokoli spadlo.
  const contacts = problem?.params?.contactableMembers;
  const first = Array.isArray(contacts)
    ? (contacts[0] as { name?: string; email?: string } | undefined)
    : undefined;
  const contactName = first?.name !== undefined && first.name !== '' ? first.name : first?.email;

  return (
    <ForbiddenState
      code="forbidden"
      requestId={problem?.request_id ?? ''}
      title={t('states.forbiddenTitle')}
      body={t('states.forbiddenBody', {
        permission,
        roles: granting,
        currentRole: t(ROLE_LABEL_KEYS[currentRole]),
      })}
      whoCanHelp={
        contactName === undefined
          ? t('states.forbiddenWhoCanHelp')
          : t('states.forbiddenWhoCanHelpNamed', { name: contactName })
      }
      action={
        <Link href={`/w/${workspaceSlug}`} className="underline">
          {t('states.forbiddenBack')}
        </Link>
      }
    />
  );
}
