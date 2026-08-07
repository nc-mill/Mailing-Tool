import { canonicalJson } from '@mlain/emails/document/canonical';
import { DocumentSchemaTooNewError, loadDocument } from '@mlain/emails/document/migrate';
import { validateDocumentSchema } from '@mlain/emails/document/schema';
import { checkSemantics } from '@mlain/emails/document/semantic';
import type { Document } from '@mlain/emails/document/types';
import type { ValidationProfile } from '@mlain/emails/document/profile';
import type { Issue } from '@mlain/emails/issue';
import type { FieldCatalog } from '../contacts/fields/catalog';

export type ValidateContext = {
  /**
   * Je to PROFIL, ne `templates.kind`, i když se to jmenuje stejně jako sloupec.
   * Volající sem posílá výsledek `validationProfileFor`, takže sem `system`
   * nikdy nedorazí a `page` (veřejná stránka) ano. Typ je proto ten z emitoru,
   * ne ručně opsaný výčet: druhá kopie by se při přidání profilu rozešla.
   */
  templateKind: ValidationProfile;
  fields: FieldCatalog;
  assetIds: Set<string>;
};

export type ValidationResult = {
  state: 'valid' | 'invalid';
  issues: Issue[];
  document?: Document;
};

/**
 * Tři vrstvy v pevném pořadí: migrace a verze schématu, JSON Schema, sémantika.
 * Vyšší vrstva se nespouští, když nižší selhala, jinak by editor dostal hlášky
 * o vnořených sloupcích u dokumentu, který není ani objekt.
 */
export function validateTemplateDocument(raw: unknown, ctx: ValidateContext): ValidationResult {
  let document: Document;
  try {
    document = loadDocument(raw);
  } catch (error) {
    const code =
      error instanceof DocumentSchemaTooNewError
        ? 'template_schema_too_new'
        : 'template_document_invalid';
    return {
      state: 'invalid',
      issues: [
        { code, severity: 'error', pointer: '', path: '', params: { message: String(error) } },
      ],
    };
  }

  const schema = validateDocumentSchema(document);
  if (!schema.ok) {
    return {
      state: 'invalid',
      issues: schema.issues.map((issue) => ({
        code: issue.code,
        severity: 'error' as const,
        pointer: issue.pointer,
        path: issue.pointer.replace(/^\//, '').split('/').join('.'),
        params: { message: issue.message },
      })),
    };
  }

  // Odhad velikosti HTML pro pravidlo S9. Přesné číslo zná až kompilace
  // a předodesílací kontrola ho z ní bere; tady jde jen o včasné varování.
  const estimatedHtmlBytes = Buffer.byteLength(canonicalJson(document), 'utf8') * 3;

  const issues = checkSemantics(document, {
    templateKind: ctx.templateKind,
    fields: ctx.fields,
    assetIds: ctx.assetIds,
    estimatedHtmlBytes,
  });

  return {
    state: issues.some((issue) => issue.severity === 'error') ? 'invalid' : 'valid',
    issues,
    document,
  };
}
