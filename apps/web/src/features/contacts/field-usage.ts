export type FieldUsageInput = {
  fields: { id: string; indexed: boolean; archived: boolean }[];
  /** Limity přicházejí z API, protože je lze změnit proměnnou prostředí (5.9 části 2). */
  limits: { fields: number; indexed: number };
};

export type FieldUsage = {
  used: number;
  limit: number;
  indexedUsed: number;
  indexedLimit: number;
  atLimit: boolean;
  atIndexedLimit: boolean;
};

/**
 * Využití limitu se ukazuje pořád, ne až v chybové hlášce. Uživatel, který se dozví
 * o stropu až po vyplnění formuláře, přijde o práci a nechápe, čím to je.
 */
export function fieldUsage(input: FieldUsageInput): FieldUsage {
  const active = input.fields.filter((field) => !field.archived);
  const indexedUsed = active.filter((field) => field.indexed).length;

  return {
    used: active.length,
    limit: input.limits.fields,
    indexedUsed,
    indexedLimit: input.limits.indexed,
    atLimit: active.length >= input.limits.fields,
    atIndexedLimit: indexedUsed >= input.limits.indexed,
  };
}
