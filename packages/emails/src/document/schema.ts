// Oba balíčky jsou CommonJS. Pod NodeNext je výchozí import jejich `module.exports`,
// ne default export, takže `new Ajv2020(...)` ani `addFormats(...)` by se z něj
// nedaly zavolat. Bereme proto pojmenovaný export a `.default`; obojí existuje
// i za běhu (ajv nastavuje exports.Ajv2020, ajv-formats exports.default).
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsCjs from 'ajv-formats';
import schema from '../../schema/document.v1.schema.json' with { type: 'json' };

const addFormats = addFormatsCjs.default;

export type SchemaIssue = { pointer: string; code: string; message: string };
export type SchemaResult = { ok: true } | { ok: false; issues: SchemaIssue[] };

const ajv = new Ajv2020({ strict: true, allErrors: true, removeAdditional: false });
addFormats(ajv, ['uuid', 'uri', 'email']);

const validate: ValidateFunction = ajv.compile(schema);

/** Sloučí chyby z anyOf větví na jednu srozumitelnou. Bez toho editor dostane devět hlášek na blok. */
function toIssue(error: ErrorObject): SchemaIssue {
  return {
    pointer: error.instancePath,
    code: `schema_${error.keyword}`,
    message: `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
  };
}

export function validateDocumentSchema(value: unknown): SchemaResult {
  if (validate(value)) return { ok: true };
  const errors = validate.errors ?? [];
  // Chyby uvnitř větve unknownBlock zahazujeme: když blok projde jako neznámý,
  // není chybou, že nevyhověl definici známého bloku.
  const meaningful = errors.filter((e) => !e.schemaPath.includes('unknownBlock'));
  const source = meaningful.length > 0 ? meaningful : errors;
  const seen = new Set<string>();
  const issues: SchemaIssue[] = [];
  for (const error of source) {
    const issue = toIssue(error);
    const key = `${issue.pointer}|${issue.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
  }
  return { ok: false, issues };
}

export const DOCUMENT_SCHEMA = schema;
