/**
 * Převod stavu importu ze serveru na stav výsledkové obrazovky.
 *
 * VLASTNÍ MODUL BEZ `'use client'`, a je to oprava konkrétní vady, ne úklid.
 * Funkce dřív bydlela v `import-result.tsx`, který je klientská komponenta,
 * jenže volá ji SERVEROVÁ stránka `contacts/import/[importId]/page.tsx`. Next
 * z takového importu udělá odkaz na klientskou funkci a vykreslení stránky
 * skončí výjimkou:
 *
 *   Error: Attempted to call resultStatusOf() from the server but
 *   resultStatusOf is on the client.
 *
 * Uživatel místo výsledku importu uviděl „Aplikace se neočekávaně zastavila"
 * s kódem chyby, tedy poslední obrazovku celého průvodce. Ověřeno na dev
 * serveru 5. 8. 2026 po dokončeném importu čtyř kontaktů.
 *
 * Výčty stavů zůstávají na JEDNOM místě: dvě kopie by se rozešly a rozdíl by
 * se projevil tím, že běžící import zase vypadá jako selhaný.
 */

/** Stavy, ve kterých import DOBĚHL. Jen o nich smí obrazovka tvrdit, jak dopadl. */
export const TERMINAL_STATUSES = [
  'completed',
  'completed_with_errors',
  'cancelled',
  'failed',
] as const;

/** Stavy, ve kterých import teprve běží, nebo ještě ani nezačal. */
export const RUNNING_STATUSES = ['pending', 'validating', 'previewing', 'importing'] as const;

export type ImportResultStatus = (typeof TERMINAL_STATUSES)[number] | 'running' | 'unknown';

/**
 * NEZNÁMÝ STAV NENÍ SELHÁNÍ a průběžný stav už vůbec ne. Dřív se sázelo
 * `KNOWN.includes(raw) ? raw : 'failed'`, takže běžící import (`importing`)
 * obrazovka vypsala jako „Import se nepodařilo dokončit. Do databáze se
 * nezapsal žádný kontakt." Změřeno na živých datech: import `api.csv` běžel
 * od 13:07:35 do 13:07:38, zapsal tři kontakty a skončil ve stavu `completed`;
 * kdo si mezitím stránku otevřel nebo obnovil, přečetl si, že se nezapsalo nic.
 */
export function resultStatusOf(raw: string): ImportResultStatus {
  if ((TERMINAL_STATUSES as readonly string[]).includes(raw)) {
    return raw as ImportResultStatus;
  }
  return (RUNNING_STATUSES as readonly string[]).includes(raw) ? 'running' : 'unknown';
}
