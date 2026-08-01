/**
 * Barva projektu odvozená z `workspace_id` (část 1, kapitola 5.2).
 *
 * Mění se **jen odstín**. Světlost a sytost jsou pevné, jinak by kontrast
 * proužku závisel na náhodě hashe a někdy by byl nečitelný.
 *
 * Barva nikdy není jediný rozlišovací znak: vedle proužku je vždy
 * název projektu textem (pravidlo 11.3).
 */
/**
 * Odstín projektu. Nezávisí na motivu, takže vyjde stejně na serveru i v prohlížeči.
 */
export function workspaceAccentHue(workspaceId: string): number {
  // FNV-1a, 32 bitů. Krátká, deterministická a bez závislosti.
  let hash = 0x811c9dc5;
  for (let index = 0; index < workspaceId.length; index += 1) {
    hash ^= workspaceId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 360;
}

/**
 * Barva projektu jako CSS hodnota, jejíž SVĚTLOST dopočítá až motiv.
 *
 * Vrací `oklch(var(--workspace-accent-l) 0.16 <odstín>)`, kde proměnnou
 * `--workspace-accent-l` nastavuje `tokens.css` zvlášť pro světlý a tmavý režim.
 *
 * PROČ TAKHLE A NE PODLE PŘEDANÉHO MOTIVU:
 * dřívější verze brala motiv parametrem a světlost si vybírala v JavaScriptu.
 * Server ale motiv prohlížeče nezná, takže vykreslil světlou variantu
 * (`oklch(0.55 ...)`) a klient hydratoval tmavou (`oklch(0.72 ...)`).
 * React na to hlásil nesoulad hydratace s poznámkou „This won't be patched up",
 * tedy rozdíl, který sám neopraví: proužek projektu i levý okraj navigace
 * zůstaly ve špatné barvě až do dalšího vykreslení. Naměřeno v prohlížeči.
 *
 * Odstín na motivu nezávisí, takže vyjde na obou stranách stejně, a světlost
 * řeší CSS, které o motivu ví. Tím nesoulad zmizí z principu, ne opravou hodnoty.
 */
export function workspaceAccent(workspaceId: string): string {
  return `oklch(var(--workspace-accent-l) 0.16 ${workspaceAccentHue(workspaceId)})`;
}
