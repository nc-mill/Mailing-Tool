import { checkSemantics } from '@mlain/emails/document/semantic';
import type { ValidationProfile } from '@mlain/emails/document/profile';
import type { EditorBlock, EditorDocument, EditorIssue } from './document-types';
import type { FieldCatalog } from './field-catalog';

// Typ nálezu je v `document-types.ts`, protože ho potřebuje store z úkolu 11,
// tedy dřív, než vznikne tenhle soubor. Odsud se jen reexportuje.
export type { EditorIssue } from './document-types';

/**
 * Kdo tuhle validaci píše.
 *
 * **Ne tenhle plán.** Pravidla S1 až S16 včetně neznámého pole a návrhu nejbližšího
 * existujícího vlastní P08 a jsou v `checkSemantics`, což je čistá funkce bez IO,
 * takže běží i v prohlížeči. Druhá sada pravidel v editoru by se s tou serverovou
 * rozešla a projevilo by se to nejhorším možným způsobem: editor by tvrdil, že je
 * šablona v pořádku, a uložení by ji odmítlo.
 *
 * Funkce `validateDocument` v `@mlain/contracts/liquid` **neexistuje a nebude**.
 * Kontrakty vystavují `validateLiquid(source, ctx)` nad jedním výrazem, ne nad
 * dokumentem; nad dokumentem ji volá právě `checkSemantics`.
 */
export function validateDocumentClient(
  document: EditorDocument,
  catalog: FieldCatalog,
  options: { assetIds: Set<string>; templateKind: ValidationProfile },
): EditorIssue[] {
  // Odhad velikosti stačí: přesné číslo zná až renderer a pravidlo S9 s tím počítá.
  const estimatedHtmlBytes = new TextEncoder().encode(JSON.stringify(document)).length * 3;

  return checkSemantics(document as never, {
    templateKind: options.templateKind,
    fields: catalog,
    assetIds: options.assetIds,
    estimatedHtmlBytes,
  }).map((issue) => {
    const blockId = blockIdAtPointer(document, issue.pointer);
    return {
      code: issue.code,
      severity: issue.severity,
      pointer: issue.pointer,
      ...(blockId ? { blockId } : {}),
      ...(issue.params ? { params: issue.params } : {}),
    };
  });
}

/**
 * Id assetů, na které dokument odkazuje.
 *
 * Pravidlo S8 hlásí `content_asset_not_found` u odkazu na asset, který v projektu
 * není. **To je serverová znalost**, prohlížeč seznam assetů nemá a stránkovaný
 * dotaz by ji nedal spolehlivě. Předá se proto množina id, na která dokument
 * odkazuje, takže se pravidlo na klientovi nikdy nespustí a smazaný obrázek
 * ohlásí až `POST /validate`. Je to vědomé zúžení, ne opomenutí: klientská
 * validace odpovídá do 20 ms a nesmí čekat na síť.
 *
 * `assetIdsInDocument` z `@mlain/core/templates` dělá totéž, ale ta doména sahá
 * na databázi a do prohlížeče nepatří.
 */
export function referencedAssetIds(document: EditorDocument): Set<string> {
  const ids = new Set<string>();
  const visit = (block: EditorBlock): void => {
    for (const key of ['assetId', 'backgroundImageAssetId', 'darkVariantAssetId']) {
      const value = block.props[key];
      if (typeof value === 'string' && value !== '') ids.add(value);
    }
    for (const child of block.children ?? []) visit(child);
  };
  for (const block of document.blocks) visit(block);
  return ids;
}

/**
 * Z JSON Pointeru na blok, kterého se nález týká.
 *
 * Nález nevede na znak v anonymním řetězci, ale na konkrétní blok, na který jde
 * skočit (část 3, 3.7.3). Pointer míří hlouběji než na blok, například na
 * `/props/alt`, takže se jde od kořene a pamatuje se poslední uzel, který má `id`.
 */
export function blockIdAtPointer(document: EditorDocument, pointer: string): string | undefined {
  if (!pointer.startsWith('/')) return undefined;
  let node: unknown = document;
  let lastId: string | undefined;
  for (const rawSegment of pointer.slice(1).split('/')) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === null || typeof node !== 'object') return lastId;
    node = Array.isArray(node) ? node[Number(segment)] : (node as Record<string, unknown>)[segment];
    const id = (node as EditorBlock | undefined)?.id;
    if (typeof id === 'string') lastId = id;
  }
  return lastId;
}
