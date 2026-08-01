const BROWSERS = ['Firefox', 'Edg', 'Chrome', 'Safari'] as const;
const PLATFORMS = [
  'Macintosh',
  'Windows NT 10.0',
  'Windows NT 11.0',
  'X11',
  'iPhone',
  'iPad',
  'Android',
] as const;

/**
 * Řetězec user agenta se uživateli neukazuje syrový: podle 10.4 části 6 se
 * technické detaily do rozhraní nepouštějí. Jméno prohlížeče a systému stačí
 * k tomu, aby své zařízení poznal.
 *
 * Pořadí v `BROWSERS` je záměrné: Chrome i Edge nesou v řetězci `Safari/`,
 * takže se hledá od nejspecifičtějšího. `X11` se ukazuje jako `X11`, protože
 * distribuci z user agenta stejně nepoznáme a hádat ji je horší než ji neuvádět.
 */
export function describeDevice(userAgent: string, fallback: string): string {
  const value = userAgent.trim();
  if (value === '') return fallback;

  const browser = BROWSERS.find((name) => value.includes(`${name}/`));
  const platform = PLATFORMS.find((name) => value.includes(name));

  // Predikát nemůže zužovat na `string`: prvky pole jsou literálové typy
  // z `BROWSERS` a `PLATFORMS`, takže `string` by nebyl přiřaditelný zpět.
  const parts = [browser, platform].filter(
    (part): part is NonNullable<typeof part> => part !== undefined,
  );
  return parts.length === 0 ? fallback : parts.join(', ');
}
