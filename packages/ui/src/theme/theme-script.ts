/**
 * Vrací text skriptu, který se vkládá do <head> před obsahem.
 * Nastaví data-theme podle uložené předvolby, jinak podle systému.
 */
export function themeScript(preference: 'light' | 'dark' | 'system'): string {
  return `(function(){var p=${JSON.stringify(preference)};var d=p==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;document.documentElement.dataset.theme=d;})();`;
}
