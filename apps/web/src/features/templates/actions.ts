'use server';

import { revalidatePath } from 'next/cache';
import { emptyDocument } from '@/features/editor/model/document-types';
import { apiMutate } from '@/lib/api-client/mutate';

/**
 * `workspaceId` je povinný, ne pohodlí: `apiMutate` z něj skládá hlavičku
 * `X-Workspace-Id` a bez ní běží požadavek mimo kontext projektu. RLS pak
 * nevrátí ani řádek a rozhraní dostane 404 na šablonu, kterou má uživatel
 * otevřenou na obrazovce. Týž důvod je popsaný v `features/contacts/actions.ts`.
 */
type WithWorkspace = { workspaceId: string };

const TEMPLATES_PATH = '/[locale]/w/[workspaceSlug]/templates';
const TEMPLATE_DETAIL_PATH = '/[locale]/w/[workspaceSlug]/templates/[templateId]';

export type TemplateActionResult = { status: 'success' } | { status: 'error'; code: string };

export type CreateTemplateResult =
  { status: 'success'; id: string } | { status: 'error'; code: string };

/**
 * Kolikrát se zkusí jiné jméno, než to akce vzdá. Dvacet je hodně: knihovna
 * s dvaceti nepojmenovanými šablonami je jiný problém než tenhle.
 */
const NAME_ATTEMPTS = 20;

/**
 * Založení šablony ROVNOU S KATEGORIÍ.
 *
 * Dřív šlo zakládání přes klientský port editoru, který posílal natvrdo
 * `kind: 'campaign'`. S filtrem knihovny by to znamenalo, že transakční e-mail
 * nejde založit jinak než přes formulář, a filtr by byl do měsíce k ničemu:
 * všechno by leželo v jedné kategorii bez ohledu na to, co to je.
 *
 * Dokument se skládá TADY, na serveru. `emptyDocument` je čistá funkce, takže
 * po klientovi není třeba chtít celý JSON jen proto, aby ho poslal zpátky.
 *
 * OBSAZENÉ JMÉNO SE ŘEŠÍ, NE HLÁSÍ. Výchozí jméno je pro každou kategorii
 * jedno a totéž, takže druhé zmáčknutí tlačítka narazí na
 * `uq_templates__workspace_name` a uživatel by dostal technickou hlášku za něco,
 * co neudělal. Pořadové číslo je stejné řešení, jaké má `copyName` u duplikátů.
 */
export async function createTemplateAction(
  input: WithWorkspace & {
    name: string;
    kind: 'campaign' | 'transactional';
    language: string;
  },
): Promise<CreateTemplateResult> {
  for (let ordinal = 1; ordinal <= NAME_ATTEMPTS; ordinal += 1) {
    const name = ordinal === 1 ? input.name : `${input.name} ${ordinal}`;
    const result = await apiMutate<{ id: string }>('/api/v1/templates', {
      method: 'POST',
      workspaceId: input.workspaceId,
      // `meta.name` dokumentu musí sedět na jméno šablony, jinak by editor
      // v hlavičce ukazoval jiné jméno, než pod jakým šablona leží v knihovně.
      body: { name, kind: input.kind, document: emptyDocument(input.language, name) },
    });
    if (result.ok) {
      revalidatePath(TEMPLATES_PATH, 'page');
      return { status: 'success', id: result.data.id };
    }
    if (result.problem.code !== 'template_name_conflict') {
      return { status: 'error', code: result.problem.code };
    }
  }
  return { status: 'error', code: 'template_name_conflict' };
}

/**
 * Smazání šablony. Server ho dělá měkce (`templates.deleted_at`), takže se dá
 * vzít zpět; proto k němu patří `restoreTemplateAction` a ne věta o nevratnosti.
 */
export async function deleteTemplateAction(
  input: WithWorkspace & { id: string },
): Promise<TemplateActionResult> {
  const result = await apiMutate<void>(`/api/v1/templates/${input.id}`, {
    method: 'DELETE',
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  // Obě cesty: knihovna už šablonu nesmí ukazovat a detail smazané šablony
  // musí odpovědět stavem „neexistuje", ne cachovanou kopií editoru.
  revalidatePath(TEMPLATES_PATH, 'page');
  revalidatePath(TEMPLATE_DETAIL_PATH, 'page');
  return { status: 'success' };
}

/**
 * Kopie šablony.
 *
 * ENDPOINT EXISTOVAL BEZ VOLAJÍCÍHO. `POST /templates/{id}/duplicate` je v jádru
 * od začátku a jméno kopie si řeší sám (`copyName` v `templates/service.ts:257`
 * hledá první volné pořadové číslo), takže tudy konflikt jména nechodí a akce
 * ho na rozdíl od zakládání nemusí obcházet. V rozhraní pro něj do 6. 8. 2026
 * neexistovalo jediné tlačítko: kdo chtěl vyjít z hotové šablony, musel ji
 * naklikat znovu.
 *
 * Vrací id KOPIE, aby knihovna měla kam přejít. Bez toho by se uživatel po
 * duplikaci nedozvěděl, že něco vzniklo: kopie se ve výpisu objeví mezi
 * ostatními a nic ji neoznačuje.
 */
export async function duplicateTemplateAction(
  input: WithWorkspace & { id: string },
): Promise<CreateTemplateResult> {
  const result = await apiMutate<{ id: string }>(`/api/v1/templates/${input.id}/duplicate`, {
    method: 'POST',
    workspaceId: input.workspaceId,
    // Prázdné tělo je tu schválně: kostra API kontroluje `Content-Type` u každého
    // POST a `apiMutate` hlavičku posílá jen tehdy, když nějaké tělo dostane.
    // Bez toho vrací požadavek 415 `unsupported_media_type` a obrazovka mlčí.
    body: {},
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(TEMPLATES_PATH, 'page');
  return { status: 'success', id: result.data.id };
}

/** Vrácení smazané šablony zpět. Selže konfliktem, když jméno mezitím někdo zabral. */
export async function restoreTemplateAction(
  input: WithWorkspace & { id: string },
): Promise<TemplateActionResult> {
  const result = await apiMutate<{ id: string }>(`/api/v1/templates/${input.id}/restore`, {
    method: 'POST',
    workspaceId: input.workspaceId,
  });
  if (!result.ok) return { status: 'error', code: result.problem.code };
  revalidatePath(TEMPLATES_PATH, 'page');
  revalidatePath(TEMPLATE_DETAIL_PATH, 'page');
  return { status: 'success' };
}
