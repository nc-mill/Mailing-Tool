import { getConfig } from '@/lib/runtime';

/**
 * Jediné místo, kde se bere základ adresy vlastního API. Vlastní modul proto,
 * aby ho testy mohly nahradit, aniž by musely sestavit celou konfiguraci.
 *
 * ODCHYLKA OD PLÁNU: plán psal `import { config } from '@mlain/core/config'`.
 * Takový export neexistuje, `@mlain/core/config` vydává továrnu `loadConfig()`.
 * Konfiguraci `apps/web` drží `@/lib/runtime`, který ji načte jednou a nese
 * i ošetření pořadí (viz komentář v tom souboru). Chování je stejné.
 *
 * SERVER A PROHLÍŽEČ POUŽÍVAJÍ JINOU ADRESU, a je to oprava produkční vady.
 *
 * Dřív se vracelo `APP_URL` pro obojí. `APP_URL` je ale adresa, na kterou chodí
 * PROHLÍŽEČ, kdežto serverová akce běží uvnitř kontejneru, kde ta adresa
 * neplatí. Aplikace tam poslouchá na `PORT` (v image 3000), zatímco `APP_URL`
 * nese port namapovaný na hostiteli, nebo rovnou veřejnou doménu za reverzní
 * proxy. Spojení tedy nikam nevedlo:
 *
 *   POST /setup -> 503 service_unavailable, instance: "/api/v1/setup"
 *   Uživatel viděl „Server neodpovídá. Nepodařilo se nám spojit se serverem."
 *
 * Lokálně to procházelo jen náhodou, protože se vnější a vnitřní port shodou
 * okolností shodovaly. V běžném produkčním nasazení, tedy na HTTPS doméně za
 * reverzní proxy, by se **žádná serverová akce nedovolala do vlastního API**
 * a instalace by vypadala živě, ale první obrazovka by nešla dokončit.
 * Odhaleno teprve tím, že E2E jelo na jiném vnějším portu (4600) než vnitřním.
 */
export function getApiBaseUrl(): string {
  // V prohlížeči je nejlepší adresa žádná: relativní cesta jde vždycky na tentýž
  // původ, ze kterého se stránka načetla. Tím se to nemůže rozejít s tím, co
  // uživatel skutečně vidí v adresním řádku, ani za reverzní proxy.
  if (typeof window !== 'undefined') return '';

  // Na serveru loopback s VNITŘNÍM portem. Nejde ven z kontejneru, takže se
  // nedotýká DNS, TLS ani reverzní proxy, a je to nejkratší možná cesta
  // k procesu, který je stejně tentýž.
  return `http://127.0.0.1:${getConfig().PORT}`;
}
