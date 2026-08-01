/**
 * Přidá parametr do adresy se zachováním query i fragmentu.
 * Cíl přesměrování se skládá výhradně z uložené adresy plus tohohle parametru,
 * nic z příchozího požadavku se do něj nikdy nedostane.
 */
export function appendQueryParam(rawUrl: string, name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  url.searchParams.set(name, value);
  return url.toString();
}
