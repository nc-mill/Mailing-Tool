/**
 * Seznam zón se bere z běhového prostředí, ne z natvrdo psaného výčtu.
 * `Intl.supportedValuesOf` je v Node 24 i ve všech cílových prohlížečích.
 * Náhrada je jediná dvojice hodnot, aby formulář neztratil pole ani ve starém běhu.
 */
export function supportedTimezones(): string[] {
  if (typeof Intl.supportedValuesOf === 'function') {
    return Intl.supportedValuesOf('timeZone');
  }
  return ['Europe/Prague', 'UTC'];
}
