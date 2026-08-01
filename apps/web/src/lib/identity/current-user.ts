import 'server-only';
import { cache } from 'react';
import { apiFetch } from '@/lib/api-client/fetch';
import type { Result } from '@/lib/api-client/result';
import type { Role } from './permissions';

/**
 * ODCHYLKA OD DOSLOVNÉHO ZNĚNÍ ÚKOLU 9, kterou nařizuje kapitola 2.1 téhož
 * plánu: „Členství se jmenuje `name` a `slug`, ne `workspace_name`
 * a `workspace_slug`." Ověřeno čtením obsluhy `GET /api/v1/auth/me`
 * v `packages/core/src/identity/api/auth.routes.ts`, která vrací
 * `{ workspace_id, name, slug, role }`. Jména polí API vlastní P04.
 */
export type Membership = {
  workspace_id: string;
  name: string;
  slug: string;
  role: Role;
};

export type CurrentUser = {
  user: {
    id: string;
    email: string;
    name: string;
    locale: string;
    timezone: string;
  };
  memberships: Membership[];
  /**
   * Double submit token pro Server Actions, viz 3.2 části 1 a předpoklad E1.
   * P04 ho zatím nevydává (požadavek P06→P04.1), proto je za běhu ošetřený
   * v `getCsrfToken`, který v takovém případě vrátí `undefined`.
   */
  csrf_token: string;
};

/**
 * Jeden dotaz na požadavek. `cache` z Reactu drží výsledek po dobu jednoho
 * vykreslení, takže layout i stránka volají tutéž odpověď.
 */
export const getCurrentUser = cache(async (): Promise<Result<CurrentUser>> => {
  return apiFetch<CurrentUser>('/api/v1/auth/me');
});

/** Double submit token pro Server Actions, viz 3.2 části 1 a předpoklad E1. */
export async function getCsrfToken(): Promise<string | undefined> {
  const result = await getCurrentUser();
  return result.ok ? result.data.csrf_token : undefined;
}
