import fs from 'node:fs';

export interface FileSecretIssue {
  readonly variable: string;
  readonly message: string;
}

/**
 * Podpora Docker secrets a Kubernetes: každá proměnná přijímá i variantu
 * se sufixem _FILE (SECRET_KEY_FILE=/run/secrets/secret_key). Když existují
 * obě, vyhrává _FILE (část 1, kapitola 4.9).
 *
 * Neexistující soubor je CHYBA, ne tiché ignorování. Tiché ignorování by
 * znamenalo, že instalace s překlepem v cestě nastartuje s výchozí hodnotou
 * a nikdo se to nedozví.
 */
export function applyFileSecrets(
  env: Record<string, string | undefined>,
  knownVariables: readonly string[],
): { env: Record<string, string | undefined>; issues: FileSecretIssue[] } {
  const result = { ...env };
  const issues: FileSecretIssue[] = [];

  for (const variable of knownVariables) {
    const fileKey = `${variable}_FILE`;
    const filePath = env[fileKey];
    if (filePath === undefined || filePath === '') continue;
    try {
      result[variable] = fs.readFileSync(filePath, 'utf8').replace(/\r?\n$/, '');
    } catch (error) {
      issues.push({
        variable: fileKey,
        message: `soubor se nepodařilo přečíst: ${(error as Error).message}`,
      });
    }
    delete result[fileKey];
  }

  return { env: result, issues };
}
