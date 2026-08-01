import { getConfig } from '@/lib/runtime';

/**
 * Jediné místo, kde se bere základ adresy vlastního API. Vlastní modul proto,
 * aby ho testy mohly nahradit, aniž by musely sestavit celou konfiguraci.
 *
 * ODCHYLKA OD PLÁNU: plán psal `import { config } from '@mlain/core/config'`.
 * Takový export neexistuje, `@mlain/core/config` vydává továrnu `loadConfig()`.
 * Konfiguraci `apps/web` drží `@/lib/runtime`, který ji načte jednou a nese
 * i ošetření pořadí (viz komentář v tom souboru). Chování je stejné.
 */
export function getApiBaseUrl(): string {
  return getConfig().APP_URL.replace(/\/+$/, '');
}
