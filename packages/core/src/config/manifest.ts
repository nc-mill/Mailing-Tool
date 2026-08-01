import { configShape, configVariableNames } from './schema';

export interface ManifestEntry {
  readonly name: string;
  readonly optional: boolean;
  readonly hasDefault: boolean;
}

/**
 * Strojově čitelný popis konfigurace. Slouží jako podklad pro paritu s Go
 * strukturou senderu (test config-parity) a pro generování dokumentace.
 *
 * ROZHODNUTÍ D5: manifest žije tady, ne v packages/contracts/config.json.
 * packages/contracts je podle uzávěru S2 výhradní vlastnictví plánu P02;
 * ten manifest do kontraktů zrcadlí, až balíček bude existovat.
 */
export function buildConfigManifest(): { version: 1; variables: ManifestEntry[] } {
  const variables = configVariableNames().map((name) => {
    const field = configShape[name as keyof typeof configShape];
    const definition = field as { safeParse: (value: unknown) => { success: boolean } };
    const withoutValue = definition.safeParse(undefined);
    return {
      name,
      optional: withoutValue.success,
      hasDefault: withoutValue.success,
    };
  });
  return { version: 1, variables };
}
