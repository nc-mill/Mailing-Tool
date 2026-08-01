import { CURRENT_SCHEMA_VERSION, type Document } from './types';

export type Migration = { from: number; to: number; apply: (doc: unknown) => unknown };

/**
 * Řetězí se od nejnižší verze. Zpětné migrace neexistují: obousměrné migrace jsou
 * dvakrát tolik kódu a testují se prakticky nikdy (3.1.7).
 */
export const MIGRATIONS: Migration[] = [];

export class DocumentSchemaTooNewError extends Error {
  readonly code = 'template_schema_too_new';
  constructor(
    readonly documentVersion: number,
    readonly supportedVersion: number,
  ) {
    super(
      `Document schema version ${documentVersion} is newer than the supported version ${supportedVersion}.`,
    );
    this.name = 'DocumentSchemaTooNewError';
  }
}

export class DocumentMigrationError extends Error {
  readonly code = 'template_document_invalid';
  constructor(message: string) {
    super(message);
    this.name = 'DocumentMigrationError';
  }
}

export function loadDocument(raw: unknown): Document {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new DocumentMigrationError('Document must be an object with a numeric schemaVersion.');
  }
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new DocumentMigrationError('Document must be an object with a numeric schemaVersion.');
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new DocumentSchemaTooNewError(version, CURRENT_SCHEMA_VERSION);
  }
  let current: unknown = structuredClone(raw);
  let at = version;
  while (at < CURRENT_SCHEMA_VERSION) {
    const migration = MIGRATIONS.find((m) => m.from === at);
    if (!migration) {
      throw new DocumentMigrationError(`No migration registered from schema version ${at}.`);
    }
    current = migration.apply(current);
    at = migration.to;
  }
  return current as Document;
}
