'use server';

import { revalidatePath } from 'next/cache';
import { apiMutate } from '@/lib/api-client/mutate';

/**
 * Zápisy panelu prvních kroků a pruhu ukázkových dat.
 *
 * VZNIKLO JAKO OPRAVA MRTVÝCH TLAČÍTEK. Panel i pruh volaly `fetch` přímo
 * z prohlížeče, tedy bez hlavičky `X-Workspace-Id`. Autentizace skládá projekt
 * ze segmentu `/w/{slug}` v cestě, nebo z té hlavičky (`lib/api/authenticate.ts`),
 * a cesta `/api/v1/onboarding/hide` žádný takový segment nemá. Každé kliknutí
 * proto končilo na 404:
 *
 *   route:"/api/v1/onboarding/hide", status:404, workspace_id:null
 *
 * U panelu byl navíc výsledek zahozený přes `void`, takže se selhání nikde
 * neprojevilo a tlačítko „Zavřít" vypadalo jako by nic nedělalo.
 *
 * Zápis proto jde stejnou cestou jako všude jinde v aplikaci: serverovou akcí
 * přes `apiMutate`, který doplní relaci, projekt, hlavičku Origin i CSRF token,
 * a překreslí Přehled.
 *
 * `workspaceRef` je slug z adresy, ne UUID. `createWorkspaceContext` bere obojí
 * a Přehled má po ruce jen slug; stejně to dělá i čtení stavu v `page.tsx`.
 */

const DASHBOARD_PATH = '/[locale]/w/[workspaceSlug]';

export type OnboardingActionResult = { status: 'success' } | { status: 'error'; code: string };

/** Skrytí a znovuzobrazení seznamu kroků. Stav se drží v projektu, ne v prohlížeči. */
export async function setOnboardingHiddenAction(input: {
  workspaceRef: string;
  hidden: boolean;
}): Promise<OnboardingActionResult> {
  const result = await apiMutate<void>('/api/v1/onboarding/hide', {
    method: 'POST',
    body: { hidden: input.hidden },
    workspaceId: input.workspaceRef,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(DASHBOARD_PATH, 'page');
  return { status: 'success' };
}

/** Zavření jednorázové gratulace po odeslání první kampaně. Nadobro. */
export async function dismissOnboardingFinishedAction(input: {
  workspaceRef: string;
}): Promise<OnboardingActionResult> {
  const result = await apiMutate<void>('/api/v1/onboarding/hide', {
    method: 'POST',
    body: { dismissFinished: true },
    workspaceId: input.workspaceRef,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(DASHBOARD_PATH, 'page');
  return { status: 'success' };
}

/**
 * Odstranění ukázkových dat z pruhu na Přehledu.
 *
 * Táž vada jako u panelu: `fetch('/api/v1/demo-data', { method: 'DELETE' })`
 * z prohlížeče běželo bez projektu a vracelo 404, takže pruh po potvrzení
 * pokaždé jen ohlásil chybu a data zůstala. Tělo se neposílá, cesta žádné
 * nemá, a `apiMutate` bez `body` neposílá ani `Content-Type`.
 */
export async function removeDemoDataAction(input: {
  workspaceRef: string;
}): Promise<OnboardingActionResult> {
  const result = await apiMutate<unknown>('/api/v1/demo-data', {
    method: 'DELETE',
    workspaceId: input.workspaceRef,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(DASHBOARD_PATH, 'page');
  return { status: 'success' };
}
