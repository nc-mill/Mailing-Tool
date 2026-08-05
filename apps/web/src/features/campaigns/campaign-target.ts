/**
 * Kam vede kliknutí na řádek kampaně.
 *
 * Dřív to byla dvojice „rozepsaná do nastavení, všechno ostatní na průběh".
 * Report kampaně tím pádem NEMĚL ze seznamu jedinou cestu: existoval jen na
 * ručně napsané adrese `/campaigns/{id}/report` a zadavatel na něj nemohl
 * trefit. Odeslaná kampaň navíc končila na obrazovce průběhu, kde je pruh
 * s procenty a tlačítko „Pozastavit", tedy přesně to, co u dojeté kampaně
 * nikoho nezajímá.
 *
 * Rozlišují se TŘI cíle podle toho, co se u daného stavu dá dělat:
 *
 *   - NASTAVENÍ (`''`) u kampaně, která se ještě chystá. Tam se dá dopsat
 *     obsah a doplnit publikum. U naplánované je formulář jen ke čtení, ale
 *     patří tam: je na ní tlačítko „Zrušit plán a upravit".
 *   - PRŮBĚH (`progress`) u kampaně, která právě běží. Jen tam dává smysl
 *     pruh postupu, pozastavení a zrušení zbytku rozesílky.
 *   - REPORT (`report`) u kampaně, která doběhla, ať dobře nebo špatně.
 *     Doručenost, odrazy, otevření a prokliky jsou jediné, co u ní zbývá.
 *
 * Soubor je bez `'use client'` a bez komponent schválně: sahá na něj i
 * serverová stránka, když se rozhoduje, jestli má adresu přesměrovat.
 */

export type CampaignTarget = 'settings' | 'progress' | 'report';

/** Stavy, ve kterých se kampaň ještě chystá k odeslání. */
const SETTINGS_STATUSES = new Set(['draft', 'schedule_missed', 'scheduled']);

/**
 * Stavy, ze kterých už není kam pokračovat: kampaň skončila.
 *
 * `partially_sent`, `cancelled` i `failed` sem patří stejně jako `sent`.
 * U všech tří platí, že část zpráv odešla a jediná zajímavá otázka zní,
 * jak dopadly; zastavená rozesílka má o tom v reportu i vlastní pruh
 * (`report.banner.stopped`).
 */
const REPORT_STATUSES = new Set(['sent', 'partially_sent', 'cancelled', 'failed']);

/**
 * Cíl pro daný stav.
 *
 * Výčet stavů je OTEVŘENÝ, nová hodnota smí přijít v rámci v1. Cokoli
 * neznámého padá na PRŮBĚH, protože ten se vykreslí pro kampaň v jakémkoli
 * stavu a nic neslibuje; report by u nezačaté kampaně ukázal prázdno.
 */
export function campaignTarget(status: string): CampaignTarget {
  if (SETTINGS_STATUSES.has(status)) return 'settings';
  if (REPORT_STATUSES.has(status)) return 'report';
  return 'progress';
}

/** Je kampaň dojetá, tedy patří na report? */
export function isFinishedCampaign(status: string): boolean {
  return REPORT_STATUSES.has(status);
}

/**
 * Celá adresa řádku. `basePath` je `/w/{slug}/campaigns`, bez jazyka:
 * jazyk doplní `Link` a `useRouter` z `@mlain/i18n/navigation`.
 */
export function campaignHref(basePath: string, id: string, status: string): string {
  const target = campaignTarget(status);
  if (target === 'settings') return `${basePath}/${id}`;
  return `${basePath}/${id}/${target}`;
}
