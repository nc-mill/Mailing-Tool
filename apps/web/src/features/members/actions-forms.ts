'use server';

import { IDLE } from '@/lib/feedback/action-result';
import { changeMemberRoleAction, removeMemberAction, revokeInvitationAction } from './actions';

/**
 * ODCHYLKA OD PLÁNU, oprava chyby ve výpisu: plán posílal akce se stavem rovnou
 * do `<form action=...>` přes `as never`. React takové akci předá `FormData`
 * jako první argument, takže by se četlo z předchozího stavu a akce by spadla.
 * Řádkové akce tabulky proto mají obálku se správným tvarem.
 */
export async function changeMemberRoleFormAction(formData: FormData): Promise<void> {
  await changeMemberRoleAction(IDLE, formData);
}

export async function removeMemberFormAction(formData: FormData): Promise<void> {
  await removeMemberAction(IDLE, formData);
}

export async function revokeInvitationFormAction(formData: FormData): Promise<void> {
  await revokeInvitationAction(IDLE, formData);
}
