import type { z } from '@hono/zod-openapi';
import { validationFailed, type ValidationIssue } from '@mlain/core/errors/api-error';

/**
 * 4.2: `errors[].path` je JSON Pointer bez úvodního lomítka, tedy tečková notace.
 * Index pole se píše jako `.0`, protože v tečkové notaci hranatá závorka není.
 */
export function issuePathToDotted(path: ReadonlyArray<PropertyKey>): string {
  return path.map((p) => String(p)).join('.');
}

export function zodIssuesToValidationErrors(
  issues: ReadonlyArray<z.core.$ZodIssue>,
): ValidationIssue[] {
  return issues.map((issue) => ({
    path: issuePathToDotted(issue.path ?? []),
    code: issue.code ?? 'invalid_value',
    message: issue.message,
  }));
}

/**
 * 4.1: neznámé klíče v těle jsou odmítnuté, protože tiché ignorování překlepu
 * je nejhorší možná odpověď na {"emial": "..."}. Schéma proto musí být .strict().
 */
export function parseStrict<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw validationFailed(zodIssuesToValidationErrors(result.error.issues));
}
