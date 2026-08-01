import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { acceptInvitationAction } from '@/features/auth/actions';
import {
  AcceptInvitationPanel,
  type InvitationView,
} from '@/features/auth/accept-invitation-panel';
import { ROLE_LABEL_KEYS, isRole } from '@/features/members/role-label';
import { getCurrentUser } from '@/lib/identity/current-user';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('invitation.loading') };
}

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; workspace?: string; role?: string; email?: string }>;
}) {
  const params = await searchParams;
  const t = await getTranslations('settings');

  if (!params.token) {
    return (
      <AcceptInvitationPanel view={{ kind: 'invalid' }} action={acceptInvitationAction} token="" />
    );
  }

  const me = await getCurrentUser();
  const view: InvitationView = me.ok
    ? {
        kind: 'signedIn',
        email: me.data.user.email,
        invitedEmail: params.email,
        workspaceName: params.workspace ?? '',
        // Klíč se NIKDY neskládá za běhu (kritérium 71 části 6). Navíc sem
        // `role` chodí z parametru URL, takže by skládání pustilo do překladače
        // libovolnou hodnotu od návštěvníka. `isRole` ji nejdřív ověří.
        roleLabel: isRole(params.role) ? t(ROLE_LABEL_KEYS[params.role]) : '',
      }
    : { kind: 'signedOut' };

  return <AcceptInvitationPanel view={view} action={acceptInvitationAction} token={params.token} />;
}
