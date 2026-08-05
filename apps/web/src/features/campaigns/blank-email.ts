import { emptyDocument, type EditorDocument } from '@/features/editor/model/document-types';

/**
 * Prázdný e-mail pro první krok zakládání kampaně.
 *
 * Dokument se tu NESKLÁDÁ znovu. „Nejmenší dokument, který projde schématem"
 * je netriviální pravidlo: kořen vyžaduje osm klíčů motivu, `meta.name` nesmí
 * být prázdný řetězec a patička s odhlašovacím odkazem je podmínka platnosti,
 * ne kontrola před odesláním. Obojí se v minulosti zjistilo až tím, že server
 * odpověděl 422 a tlačítko bylo mrtvé. Druhá kopie téhle znalosti by se s tou
 * první rozešla a chyba by se vrátila.
 *
 * Je to JEDINÉ místo, kde kampaně sahají do modelu editoru, a schválně: až se
 * editor přepíše, mění se jeden import tady, ne kód rozprostřený po feature.
 */
export function blankEmailDocument(language: string, name: string): EditorDocument {
  return emptyDocument(language, name);
}

/**
 * Jméno ŘÁDKU pracovního obsahu kampaně.
 *
 * Uživatel ho nikdy nevidí: pracovní obsah se nevypisuje v knihovně a editor
 * bere popisek z `meta.name` dokumentu, ne z názvu řádku. Přesto nesmí být
 * libovolné, protože `uq_templates__workspace_name` je unikátní index nad
 * `lower(name)` a dvě kampaně se stejným jménem jsou úplně běžná věc. Bez
 * identifikátoru kampaně skončilo zakládání druhé takové kampaně chybou 23505
 * a uživatel dostal jen „nepodařilo se"; v databázi po tom zůstala kampaň
 * bez obsahu. Ověřeno na datech: kampaň „Vytvořit kampaň" bez `template_id`
 * a bez `design` je právě tenhle případ.
 *
 * Identifikátor kampaně je unikátní sám o sobě, takže kolize vzniknout nemůže.
 * Jméno se před ním zkracuje na 80 znaků, aby se celek vešel do
 * `ck_templates__name_len` (nejvýš 120 znaků): 80 + 3 + 36 = 119.
 */
export function workingCopyName(campaignName: string, campaignId: string): string {
  return `${campaignName.slice(0, 80)} · ${campaignId}`;
}
