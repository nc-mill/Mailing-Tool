'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createWorkspaceContext } from '@mlain/core/identity/context';
import type { WorkspaceContext } from '@mlain/core/identity/types';
import { addTrackingDomain, removeTrackingDomain } from '@mlain/core/tracking';
import type { Problem } from '@/lib/api-client/problem';
import { failed, succeeded, type ActionState } from '@/lib/feedback/action-result';
import { requireUser } from '@/lib/identity/require-user';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';

/**
 * Akce obrazovky „Nastavení → Měření".
 *
 * Volají doménu PŘÍMO, ne přes `/api/v1`. Nová veřejná API cesta by znamenala
 * zápis do registru tras i do specifikace, tedy povrch, který nikdo zvenčí
 * nepotřebuje. Tentýž postup má obrazovka značky projektu (`brand-actions.ts`).
 *
 * Oprávnění se ověřuje TADY, ne jen na stránce. Server action je samostatný
 * vstupní bod: kdo zná její identifikátor, zavolá ji bez ohledu na to, co
 * viděl na obrazovce.
 */

const TRACKING_PAGE_PATH = '/[locale]/w/[workspaceSlug]/settings/tracking';

function problemOf(status: number, code: string): Problem {
  return {
    type: `https://docs.mlain.dev/errors/${code}`,
    title: code,
    status,
    detail: '',
    instance: '/settings/tracking',
    code,
    request_id: '',
  };
}

type Authorized = { ok: true; ctx: WorkspaceContext } | { ok: false; problem: Problem };

/**
 * Vrací KONTEXT, ne identifikátor projektu. Doménové funkce si samy otevírají
 * transakci, takže dokud braly řetězec, rozhodovaly o izolaci podle hodnoty,
 * které nikdo neručil. `createWorkspaceContext` je jediná legitimní továrna
 * a členství ověřuje ještě jednou proti relaci, nezávisle na `getWorkspaceAccess`.
 */
async function authorize(slug: string): Promise<Authorized> {
  const me = await requireUser(`/w/${slug}/settings/tracking`);
  if (!me.ok) return { ok: false, problem: me.problem };

  const access = await getWorkspaceAccess(slug);
  if (!access.ok) return { ok: false, problem: access.problem };

  if (!hasPermission(access.data, 'workspace:update')) {
    return { ok: false, problem: problemOf(403, 'forbidden') };
  }

  const ctx = await createWorkspaceContext({
    kind: 'session',
    userId: me.data.user.id,
    workspaceRef: slug,
  });
  return { ok: true, ctx };
}

const AddSchema = z.object({
  workspace_slug: z.string().min(1),
  host: z.string().trim().min(1).max(253),
  include_subdomains: z.boolean(),
});

export async function addTrackingDomainAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = AddSchema.safeParse({
    workspace_slug: formData.get('workspace_slug'),
    host: formData.get('host'),
    include_subdomains: formData.get('include_subdomains') === 'on',
  });
  if (!parsed.success) {
    return failed('inlineBlock', problemOf(422, 'tracking_domain_invalid'));
  }

  const auth = await authorize(parsed.data.workspace_slug);
  if (!auth.ok) return failed('inlineBlock', auth.problem);

  const result = await addTrackingDomain(
    auth.ctx,
    parsed.data.host,
    parsed.data.include_subdomains,
  );
  if (!result.ok) return failed('inlineBlock', problemOf(422, result.code));

  revalidatePath(TRACKING_PAGE_PATH, 'page');
  return succeeded({ channel: 'toast', messageKey: 'tracking.settings.saved' });
}

const RemoveSchema = z.object({
  workspace_slug: z.string().min(1),
  id: z.uuid(),
});

export async function removeTrackingDomainAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = RemoveSchema.safeParse({
    workspace_slug: formData.get('workspace_slug'),
    id: formData.get('id'),
  });
  if (!parsed.success) return failed('inlineBlock', problemOf(422, 'validation_failed'));

  const auth = await authorize(parsed.data.workspace_slug);
  if (!auth.ok) return failed('inlineBlock', auth.problem);

  await removeTrackingDomain(auth.ctx, parsed.data.id);

  revalidatePath(TRACKING_PAGE_PATH, 'page');
  return succeeded({ channel: 'toast', messageKey: 'tracking.settings.saved' });
}
