'use server';

import { revalidatePath } from 'next/cache';
import { apiMutate } from '@/lib/api-client/mutate';

const SEGMENTS_PATH = '/[locale]/w/[workspaceSlug]/segments';

/**
 * Přepočet segmentu.
 *
 * PROČ VZNIKLA. Na kartě segmentu byla tlačítka „Spočítat" a „Přepočítat" BEZ
 * `onClick`, tedy dvě mrtvá tlačítka. „Přepočítat" se navíc objevuje právě ve
 * chvíli, kdy je uložený počet starší než šest hodin, tedy přesně tehdy, když
 * ho člověk potřebuje. Endpoint `POST /segments/{id}/recount` přitom existoval
 * celou dobu.
 *
 * Server odpovídá 202, ale počítá SYNCHRONNĚ (`recountSegment` volá `countSegment`
 * s vlastním časovým stropem 60 s) a vrací už aktualizovaný segment. Obrazovka
 * proto po návratu jen obnoví data, nemusí se na nic doptávat.
 *
 * `workspaceId` je povinný, jinak požadavku chybí hlavička `X-Workspace-Id`,
 * běží mimo kontext projektu a RLS vrátí 404 na segment, který je na obrazovce.
 */
export async function recountSegmentAction(input: {
  workspaceId: string;
  id: string;
}): Promise<{ status: 'success' } | { status: 'error'; code: string }> {
  const result = await apiMutate<{ id: string }>(`/api/v1/segments/${input.id}/recount`, {
    method: 'POST',
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(SEGMENTS_PATH, 'page');
  revalidatePath(`${SEGMENTS_PATH}/[id]`, 'page');
  return { status: 'success' };
}

/**
 * Smazání segmentu.
 *
 * ZAVÁDÍ FUNKCI, KTERÁ V PRODUKTU NEBYLA. `DELETE /api/v1/segments/{id}` je
 * v jádru od začátku (`segments.routes.ts:507`), ale rozhraní ho do 6. 8. 2026
 * nevolalo odnikud: segment, který si někdo omylem založil, se z aplikace nedal
 * odstranit vůbec a jediná cesta vedla přes API.
 *
 * Je to MĚKKÉ smazání (`deleteSegment` v `segments/service.ts:137` nastaví
 * `deleted_at`), jenže obnova z koše v API neexistuje, takže se uživateli
 * v okně neslibuje.
 *
 * `workspaceId` je povinný, jinak požadavku chybí hlavička `X-Workspace-Id`,
 * běží mimo kontext projektu a RLS vrátí 404 na segment, který je na obrazovce.
 */
export async function deleteSegmentAction(input: {
  workspaceId: string;
  id: string;
}): Promise<{ status: 'success' } | { status: 'error'; code: string }> {
  const result = await apiMutate<undefined>(`/api/v1/segments/${input.id}`, {
    method: 'DELETE',
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(SEGMENTS_PATH, 'page');
  revalidatePath(`${SEGMENTS_PATH}/[id]`, 'page');
  return { status: 'success' };
}

/**
 * Založení segmentu z hotového presetu.
 *
 * Tlačítko „Použít" na kartě presetu volalo nepovinnou propu `onUse`, kterou mu
 * seznam segmentů nikdy nepředal, takže kliknutí nedělalo nic. Endpoint
 * `POST /segments/presets/{key}` přitom existoval celou dobu.
 *
 * Vzniká VLASTNÍ KOPIE s klíčem presetu, ne odkaz na sdílenou definici, jak
 * vysvětluje komentář na kartě: jinak by úprava presetu v kódu tiše změnila
 * segment, který si uživatel pojmenoval po svém.
 */
export async function createSegmentFromPresetAction(input: {
  workspaceId: string;
  key: string;
  name: string;
}): Promise<{ status: 'success'; id: string } | { status: 'error'; code: string }> {
  const result = await apiMutate<{ id: string }>(`/api/v1/segments/presets/${input.key}`, {
    method: 'POST',
    body: { name: input.name.trim() },
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(SEGMENTS_PATH, 'page');
  return { status: 'success', id: result.data.id };
}
